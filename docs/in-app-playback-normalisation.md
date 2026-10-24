# In-App Playback — Effect on Audio Normalisation

*Written: 2026-08-09 · Against `main` @ `4c2e8cb` (v2.0.0, Expo SDK 55, RN 0.83.6)*

An exploration of what changes if Zibo plays media itself instead of handing it
to VLC/MX Player. **This does not supersede
[audio-normalisation-plan.md](./audio-normalisation-plan.md)** — that plan
remains the one written against the current architecture. This document asks a
different question and reaches a different recommendation for one content type.

---

## TL;DR

**Yes, it helps — substantially, and in one way that isn't obvious.**

| Question | Answer |
|---|---|
| **Does it make normalisation better?** | Yes. Exact per-item gain instead of device-volume steps, and none of the reference-volume tracking, restore-on-resume, or user-fights-the-rocker problems. |
| **What's the non-obvious win?** | **Measurement becomes free.** If you're decoding the audio anyway, a tap in the audio chain measures loudness during normal viewing. The entire background analysis pass — the most expensive part of the plan on low-powered devices — becomes an optional accelerator rather than a prerequisite. |
| **Does it remove the need to modify files?** | Completely. M6 (tagging, lossless gain patching) and M7 (`loudnorm` re-encode) all exist only because we can't control playback. They'd be unnecessary. |
| **What does it cost?** | Codec coverage (AC-3/DTS/TrueHD on phones), subtitle fidelity, and every player feature users currently get from VLC for free. Zibo becomes a player, with a player's maintenance surface. |
| **Is there a cheap version?** | Yes, and it's compelling: **audiobooks only**. MP3/AAC are universally supported, there are no subtitles or HDR, the player UI is simple, and it's the content where level consistency matters most. Near-zero codec risk. |
| **Recommendation** | **Hybrid.** In-app player for audiobooks now; opt-in in-app video player later; keep external handoff as the default for video. Don't force the choice on users. |

One thing to know before reading further: **HDMI bitstream passthrough defeats
normalisation entirely**, in-app or not. That constraint is independent of this
decision and is covered in §5.

---

## 1. Why the current plan is awkward, and what playback control fixes

The existing plan's primary mechanism (A1) is to set the device's `STREAM_MUSIC`
volume immediately before firing the play intent. It works, but look at what it
drags along:

- A reference-volume concept that has to be stored, tracked and re-learned when
  the user overrides it mid-playback.
- A restore-on-resume step, because we've left the device's volume somewhere the
  user didn't put it.
- Quantisation to whatever volume steps the device offers — the deadband in the
  plan is partly sized to *hide* this coarseness.
- Capability detection and a graceful-disable path for devices with too few
  steps or no `getStreamVolumeDb`.
- A whole destructive branch (M6/M7 — tagging, lossless gain patching, `loudnorm`
  re-encoding) whose only purpose is to bake gain into files *because we can't
  apply it at playback*.

Owning playback deletes every one of those. Gain becomes a float multiply on the
audio stream: exact, per-item, invisible, and with no side effects outside the
app. The system volume is never touched, so there is nothing to restore and
nothing to fight over.

---

## 2. How gain would actually be applied

Three tiers, in increasing order of native work.

### Tier 1 — `expo-video`, attenuation only *(no native code at all)*

`expo-video` is **already a dependency** (used for thumbnail generation) and
exposes `player.volume` as a float in `0…1`, plus `audioTrack` /
`availableAudioTracks` and `subtitleTrack` / `availableSubtitleTracks`.

The constraint is that `0…1` means **attenuation only — you cannot boost**. That
is not fatal, it just changes the target:

> Set the library target at or below the **10th percentile** of the measured
> distribution, so every computed gain is ≤ 0 dB and achievable by attenuation.

Everything ends up a little quieter than the loudest item, and the user raises
their device volume once, globally. This is exactly how ReplayGain's
prevent-clipping behaviour works, and it has a genuine advantage: **you can never
clip**, so §4.4's clip guard and the whole `clip-limited` status disappear.

The planner in the main plan already anticipates this — it takes the active
mechanism as an input and offsets the target down when only attenuation is
available. No new logic required.

Cost of large attenuations on 16-bit PCM is a bit of resolution (−6 dB ≈ 1 bit);
inaudible in practice, and avoidable entirely with float output.

### Tier 2 — custom Media3 module, with boost

Dropping to Media3 directly (a local Kotlin Expo module wrapping `ExoPlayer`)
gives two ways to exceed unity gain:

- **`LoudnessEnhancer`** (`android.media.audiofx`), attached to the player's
  audio session ID. Target gain in millibels (100 mB = 1 dB), and it
  *compresses rather than clips* signals pushed out of range — a built-in safety
  net, which is exactly what the clip guard was hand-rolling.
- **A custom `AudioProcessor`** in the `DefaultAudioSink` chain, applying an
  arbitrary float multiply. Total control, and it needs its own limiter.

`LoudnessEnhancer` is the pragmatic choice: less code, and its compression
behaviour is the correct response to a quiet-but-peaky film.

### Tier 3 — Media3 + the FFmpeg audio decoder extension

Needed only to close the codec gap (§4.1). Media3's `FfmpegAudioRenderer` covers
AC-3, E-AC-3, DTS, TrueHD, ALAC and more, but the module
**[must be built manually and is not published to Maven](https://developer.android.com/media/media3)**.
Community builds exist (e.g. [`vickyleu/decoder_ffmpeg`](https://github.com/vickyleu/decoder_ffmpeg))
covering `ac3 eac3 dca mlp truehd` among others.

Note the convergence with the main plan's §5.5: if an NDK FFmpeg build is
happening anyway, it can serve decoding for playback *and* measurement.

---

## 3. The big one: measurement stops costing anything

This is the argument that would actually change my mind, and it isn't about gain
at all.

The main plan spends most of its complexity on *affording* measurement on weak
hardware: two-tier sampled-then-full analysis, group probing, escalation
margins, session budgets, a persistent work queue, a `'analysing'` scan phase.
All of it exists because decoding audio to measure it is expensive when nobody
asked you to.

**If you're already decoding for playback, measurement is a tap in the audio
chain.** A custom `AudioProcessor` (Tier 2) that passes PCM through untouched
while accumulating BS.1770 blocks costs a few multiply-accumulates per sample —
nothing next to the decode already happening.

The consequences cascade:

- **First play of an item**: no gain applied (we don't know its loudness yet),
  but by the end we do.
- **Every subsequent play**: exact gain, no analysis ever scheduled.
- **The background pass becomes optional** — a "speed this up" button rather
  than a prerequisite. The 3.5-hour first-run analysis estimate in the main plan
  (§3.3) goes away for anyone willing to let it learn as they watch.
- **Partial views still count**, if you store accumulated gated-block statistics
  (running sum of mean-squares plus block count) rather than a final LUFS. Watch
  half a film today and half tomorrow and the measurement converges. Seeking and
  skipping bias the sample no more than the plan's existing window sampling does.
- **Group probing gets simpler** — watch three episodes of a season naturally and
  you have your probe set for free.

For the low-powered-device constraint that shaped the entire original plan, this
is the single largest available win.

---

## 4. What it costs — the playback consequences

This is the real substance of the question, and the answer is that Zibo stops
being a launcher and becomes a player.

### 4.1 Codec coverage — the biggest gap

The current model's quiet superpower is that VLC and MX Player will play
*anything*, with software fallbacks for everything exotic. Media3 depends on the
device's `MediaCodec` decoders plus its own extensions:

| Codec | Media3 out of the box |
|---|---|
| H.264 / H.265 / VP9 / AV1 video | Fine (hardware, device-dependent for AV1) |
| AAC, MP3, Opus, Vorbis, FLAC | Fine everywhere |
| **AC-3 / E-AC-3** | **Device-dependent.** Common on Android TV boxes (Dolby licensing), usually absent on phones. |
| **DTS / DTS-HD** | **Rarely present**, and [historically flaky in ExoPlayer](https://github.com/google/ExoPlayer/issues/10159). |
| **TrueHD** | Effectively absent. |

For a library of MKV rips — which is the realistic case for this app — AC-3 and
DTS are *extremely* common. On a phone, a Tier 1 or Tier 2 in-app player would
simply fail to play a large fraction of a typical library. Tier 3 (the FFmpeg
extension) fixes it, at the cost of an NDK build and roughly the same supply-chain
question the main plan wrestles with in §5.5.

**This is the single strongest argument against in-app video playback**, and the
single strongest argument *for* starting with audiobooks, which are MP3/AAC and
have no such gap.

### 4.2 Subtitles

Media3 handles SubRip, WebVTT, TTML, PGS and DVB, plus SSA/ASS with **basic**
styling. VLC uses libass and renders styled ASS properly. Anime and fansubbed
content would visibly regress. Subtitle *timing offset* adjustment — a feature
users of external players rely on constantly — would have to be built.

### 4.3 Everything else users currently get for free

Each of these is currently VLC's problem and would become Zibo's: resume
position, playback speed, audio delay, gesture seek/brightness/volume, aspect and
zoom controls, chapter navigation, picture-in-picture, background audio, sleep
timer, casting, network streaming, and a D-pad-navigable UI for Android TV.

Media3's `PlayerView` gives a default control surface, but "default ExoPlayer
controls" versus "MX Player" is a comparison users will make immediately and
unfavourably.

### 4.4 Hardware variability becomes your bug tracker

Every cheap TV box with an eccentric decoder currently produces a bug report
against VLC. In-app playback moves all of that to Zibo. For a project of this
size that is a meaningful ongoing cost, and it is the kind that doesn't show up
in a plan.

---

## 5. The passthrough conflict — which affects the current plan too

Worth stating separately because it is easy to miss and it is not specific to
in-app playback.

If a user sends audio as a **bitstream to an AVR over HDMI** (AC-3/DTS
passthrough, common on Android TV boxes wired to a receiver), the Android side
never decodes it. [Volume control stops working
entirely](https://github.com/google/ExoPlayer/issues/4841) — the AVR owns the
level. Consequences:

- **In-app playback**: normalisation requires decoding to PCM, which means giving
  up bitstream passthrough. That's a real trade users with surround setups will
  not want to make. The honest behaviour is to detect passthrough and disable
  normalisation with an explanation, or offer "decode for normalisation" as an
  explicit choice.
- **The current plan (A1)** has the *same* problem: setting `STREAM_MUSIC` volume
  does nothing when the stream is being passed through. This should be added to
  the main plan's capability-detection list — it is a case where the feature must
  disable itself, and it wasn't identified.

---

## 6. Side benefit worth noting: this is the iOS unblocker

[ios-port-feasibility.md](./ios-port-feasibility.md) identifies playback handoff
as one of the two hard blockers for an iOS port — "the current Android UX is
*point at any folder, hand the file to MX Player / VLC*. On iOS the handoff half
of that has no equivalent."

An in-app player is precisely what that port would need. If in-app playback is
built for normalisation, the iOS story changes materially as a by-product. That
doesn't justify the work on its own, but it changes the cost/benefit if an iOS
port is ever seriously considered.

---

## 7. Comparison

| | External handoff (current plan) | In-app playback |
|---|---|---|
| Gain precision | Device volume steps (~0.5–2 dB) | Exact |
| Side effects | Changes system volume; needs restore + reference tracking | None |
| Clipping risk | Needs an explicit clip guard | None (attenuation) or handled by `LoudnessEnhancer` |
| Cost of measurement | The dominant cost; needs sampling, grouping, budgets, a queue | **Free during playback** |
| Needs to modify files? | M6/M7 exist only to work around no playback control | Never |
| Codec coverage | Everything VLC/MX support | Gap at AC-3/DTS/TrueHD without an NDK build |
| Subtitle fidelity | VLC/libass | Basic ASS styling |
| Player features | Mature, free | Ours to build |
| Passthrough setups | Broken (§5) | Broken unless we force decode (§5) |
| Product identity | Library browser | Media player |
| Maintenance | Low | Substantial and ongoing |

---

## 8. Recommendation

**Hybrid, and start with audiobooks.**

### Phase A — in-app audiobook player *(genuinely low risk)*

Audiobooks dodge nearly every objection in §4:

- **No codec gap.** MP3, AAC/M4B, sometimes FLAC/Opus — all natively supported by
  Media3 on every device.
- **No subtitles, no HDR, no aspect controls.**
- **Simple player surface**: play/pause, seek, ±30 s, speed, sleep timer, resume.
  A day or two of UI, not a month — and resume-position tracking is something the
  library arguably wants regardless (today there is only `lastOpened`).
- **Highest normalisation value.** Long sessions and uniform spoken-word content
  are exactly where level inconsistency is most irritating; the main plan already
  gives audiobooks a tighter deadband for this reason.
- **Book-level gain** (the "album gain" behaviour in the main plan §3.4) is
  trivial to apply when we own the player.

Start at **Tier 1** — `expo-video`, attenuation-only, target at the 10th
percentile. That is a working normalised audiobook player with **no native code
whatsoever**, and it is the cheapest possible test of whether the whole idea
feels right in the hand. Move to Tier 2 only if boost or free measurement turn
out to matter.

### Phase B — opt-in in-app video player

Only if Phase A lands well and there's appetite for it. Requires Tier 2 plus
Tier 3 (the FFmpeg decoder extension) to be honest about codec coverage. Ship it
as a **per-source or global preference**, defaulting to the external handoff, so
nobody loses the VLC experience they chose this app for. Users who want exact
normalisation opt in; everyone else keeps A1's approximation.

### What stays from the main plan either way

The measurement and planning stages are unaffected — BS.1770 measurement, the
library target, the deadband, group cohesion, the override model and the Redux
schema are all mechanism-agnostic. That is the part of the main plan worth
building first regardless of how this question resolves. **Only Stage 3 (§5,
"Applying the gain") changes.**

---

## 9. What would change in the main plan if this is adopted

| Main plan section | Change |
|---|---|
| §3.3 two-tier measurement | Demoted from load-bearing to an optional accelerator for unwatched items |
| §5.1 volume preset (A1) | Retained only for external playback; the fallback, not the primary |
| §5.3 / M6 / M7 (file modification) | **Dropped entirely** for anything played in-app |
| §4.4 clip guard | Unnecessary under attenuation; replaced by `LoudnessEnhancer`'s compression under boost |
| §4.2 target modes | `minimise-work` and `library-median` become freely re-plannable again — the stickiness problem in §5.3 only exists for baked-in gain |
| M0 spike | Add: does the device decode AC-3/DTS via `MediaCodec`? Is the output path passthrough? |
| New | Resume-position tracking, player UI, track selection persistence |

---

## 10. Open questions

1. **What fraction of a typical Zibo library is AC-3/DTS?** Phase B's viability
   turns on this. Worth a one-off scan that reports codec distribution before
   committing to anything.
2. **Does `expo-video` expose enough for Phase A?** Volume, audio track and
   subtitle track are confirmed present; resume position, speed and background
   audio need checking against the SDK 55 API.
3. **Can free measurement work without a custom `AudioProcessor`?** If not,
   Phase A at Tier 1 gets exact gain but *not* free measurement, and still needs
   the background analysis pass. That materially affects the ordering.
4. **How common is HDMI passthrough among the actual user base?** If it's a large
   share of Android TV users, §5 caps the ceiling on this whole feature — for
   both approaches.
5. **Does the project want to be a media player?** The genuine question, and not
   a technical one. Everything above is affordable; the maintenance identity
   change is the part that isn't reversible.
