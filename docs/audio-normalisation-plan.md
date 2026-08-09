# Audio Normalisation — Implementation Plan

*Written: 2026-08-09 · Against `main` @ `4c2e8cb` (v2.0.0, Expo SDK 55, RN 0.83.6)*

---

## TL;DR

**Goal:** playing a quiet 2003 film after a loud modern one, or skipping between
audiobooks, should not require reaching for the volume rocker.

**Approach:** measure every item's perceived loudness (EBU R128 / ITU-R BS.1770
integrated LUFS), pick one target for the library, and only touch the items that
are genuinely off it. Most libraries will need adjusting for a **minority** of
items — the plan is built around finding that minority cheaply.

| Question | Short answer |
|---|---|
| **Can Zibo change the audio?** | Not during playback — Zibo hands files to VLC/MX Player and has no control once the intent fires (`src/scripts/openMedia.ts:51`). |
| **So what *can* it do?** | Set the **device media volume** to a per-item value immediately before firing the intent. Non-destructive, works with every external player, needs one small native module. |
| **How is loudness measured?** | A local Expo native module: `MediaCodec` audio-only decode → BS.1770-4 K-weighted gated loudness. No ffmpeg. |
| **Cost on a low-powered device?** | Full-file analysis of a 2h film ≈ 1–4 min on a cheap TV box. So we **don't** do that by default — a sampled estimate (~12×15 s windows) gets ±1 LU in **2–6 seconds** and is enough to triage. |
| **How many items get touched?** | Only those outside a ±2 LU deadband around the library target. On a typical mixed library expect **10–25 %**; the rest are marked "in tolerance" and cost nothing further. |
| **Does it modify the user's files?** | No, by default. M6 adds opt-in permanent normalisation for **audio-only** files, done losslessly and in place (§5.3). Rewriting video files is a non-goal — the objection is I/O and data-loss risk, not CPU. |
| **Why not just use ffmpeg's `loudnorm`?** | Its *measurement* pass is genuinely attractive and would delete most of M1. But the maintained successor (FFmpegKitNext) is source-only, so we'd own an NDK build. Deferred to M6 as a deliberate decision, not dismissed — see §3.1. |

---

## 1. The constraint that shapes everything

Zibo does not play media. `openMediaInExternalApp` fires an Android `ACTION_VIEW`
intent at the SAF `content://` URI and the OS hands the file to whichever player
the user picked. There is no supported intent extra for "play this at −4 dB", and
the two mainstream targets (VLC, MX Player) do not accept one.

That leaves five places gain can be applied, in ascending order of cost and risk:

| # | Mechanism | Works with external players? | Modifies files? | Precision | Verdict |
|---|---|---|---|---|---|
| **A1** | Set Android `STREAM_MUSIC` volume before firing the intent | ✅ Yes, all of them | No | Device volume step (~0.5–2 dB near the top of the curve) | **Primary mechanism.** |
| **A2** | Write ReplayGain / R128 tags into the file | Only players that honour them (VLC and most audiobook players do; MX Player does not) | Yes (metadata only) | Exact | **Opt-in, audio files only** (M6). |
| **A2b** | Patch the `global_gain` field in every MP3/AAC frame (the mp3gain technique) | ✅ Yes, all of them — the file genuinely *is* quieter | Yes, but **in place, losslessly, reversibly** | 1.5 dB steps (MP3) | **The cheap permanent option** — audio-only files, M6. See §5.3. |
| **A3** | Play in-app with `expo-video` and set `player.volume` | N/A — replaces the handoff | No | Exact, but **attenuation only** (0…1, no boost) | **Optional** (M6), changes the product. |
| **A4** | Re-encode the audio track with `loudnorm`, video stream-copied | ✅ | Yes, destructively | Exact | **Non-goal for video** — cheap in CPU, expensive in I/O. See §5.3. |

A1's coarseness is not the problem it looks like. The whole design already
accepts a ±2 LU deadband as inaudible-enough; a volume step landing within
~1 dB of the requested gain is comfortably inside that.

---

## 2. Design overview

Three separable stages. Each is independently useful and independently testable.

```
   ┌── MEASURE ────────────┐   ┌── DECIDE ──────────────┐   ┌── APPLY ─────────────┐
   │ per item:             │   │ per library, per type: │   │ at play time:        │
   │  integrated LUFS      │──▶│  target T              │──▶│  set device volume   │
   │  true/sample peak     │   │  deadband D            │   │  to base + gainDb    │
   │  confidence           │   │  gainDb (0 if inside)  │   │  restore afterwards  │
   └───────────────────────┘   └────────────────────────┘   └──────────────────────┘
       native module,              pure TypeScript,              tiny native module
       sampled → full              unit-testable                 + openMedia change
```

The middle stage is pure arithmetic over a list of numbers — it has no I/O, no
native code, and is where all the "close enough" logic lives. It is the only
part of this feature that can be fully covered by Jest, and it should be.

---

## 3. Stage 1 — Measuring loudness

### 3.1 Why a native module — and the ffmpeg fork in the road

- **Pure JS is impossible.** Decoding AC-3/E-AC-3/DTS/AAC/Opus in JS across a
  20 GB library is orders of magnitude too slow, and none of the installed
  dependencies expose raw PCM.
- **`MediaCodec` is already on the device**, hardware-accelerated, and handles
  every codec the external players can handle. Decoding *audio only* (via
  `MediaExtractor.selectTrack` on the audio track) skips the video bitstream
  entirely — the expensive part.

There is a real alternative, and it is worth stating plainly rather than
dismissing: **`ffmpeg -af ebur128` (or `loudnorm=print_format=json`) is the
reference implementation of the measurement this whole feature depends on.**
Taking an ffmpeg dependency would delete milestone M1 almost entirely — no
hand-written K-weighting, no gating bugs, no validation harness needed to prove
our numbers match ffmpeg's, because they *would* be ffmpeg's.

Against that:

| | MediaCodec + own meter (Path 1) | ffmpeg (Path 2) |
|---|---|---|
| M1 effort | 2–4 days + validation harness | ~0 — parse JSON from one command |
| Correctness risk | Ours to get wrong | Reference implementation |
| APK size | +0 | +10–25 MB **per ABI** (less with the `audio` build variant) |
| Decode | Hardware-offloaded | Software only |
| Supply chain | None | Self-built (see below) |
| Licensing | None | LGPL v3 (GPL if `--enable-gpl`) — needs dynamic linking + attribution |
| Unlocks file-level gain? | No | Yes (A4) |

**On the supply chain specifically:** the retirement of `ffmpeg-kit` (binaries
pulled from Maven Central, CocoaPods and npm on 1 April 2025) is no longer the
end of the story — development continues as
[`FFmpegKitNext`](https://github.com/arthenica/ffmpeg-kit-next), maintained by
the original author. The catch is that **FFmpegKitNext is distributed as source
only**. Prebuilt binaries would have to be produced and maintained by us — an
NDK build in CI producing an `.aar`, including 16 KB page alignment, which Google
Play has required since 1 November 2025 for apps targeting Android 15+ and which
the old artifacts never had. Several community forks publish binaries
(`ffmpeg-kit-16KB` and similar), but they are unofficial and of varying
provenance; for a feature that touches users' media files, that is not a
dependency to take casually.

**Recommendation: Path 1 for M1–M5.** The system-volume mechanism (A1) needs no
ffmpeg, the deadband means most items are never touched anyway, and MediaCodec's
hardware decode is an advantage on exactly the weak hardware this plan is built
around. Revisit Path 2 at M6 *if* users actually ask for permanent, file-level
normalisation — at which point the build pipeline earns its keep by enabling A4
as well as the measurement. This decision should be re-taken at M6, not now.

### 3.2 The module

Create a local Expo module (works fine with the managed/CNG workflow, since
`android/` is generated by prebuild and not committed):

```
modules/zibo-loudness/
├── expo-module.config.json
├── index.ts                       # requireNativeModule('ZiboLoudness') + TS types
└── android/src/main/java/.../
    ├── ZiboLoudnessModule.kt      # Expo Modules API surface
    ├── AudioDecoder.kt            # MediaExtractor + MediaCodec → Float PCM frames
    └── Bs1770Meter.kt             # K-weighting + gating (the actual measurement)
```

Public surface (async, cancellable, progress-reporting):

```ts
// modules/zibo-loudness/index.ts
export interface LoudnessResult {
  /** Gated integrated loudness, LUFS (ITU-R BS.1770-4). */
  integratedLufs: number;
  /** Highest sample peak seen, dBFS. Used as the clipping guard. */
  peakDbfs: number;
  /** Loudness range (LRA), LU — informational, used to spot wildly dynamic films. */
  loudnessRangeLu: number;
  /** Seconds of audio actually analysed. */
  analysedSeconds: number;
  /** Total duration of the audio track, seconds. */
  durationSeconds: number;
  /** 'sampled' | 'full' — how the number was obtained. */
  mode: LoudnessMode;
  /** Std-dev of per-window block loudness, LU. High ⇒ the sample is unreliable. */
  spreadLu: number;
}

export function analyse(
  contentUri: string,
  opts: { mode: 'sampled' | 'full'; windows?: number; windowSeconds?: number },
): Promise<LoudnessResult>;

export function cancel(): void;
```

`Bs1770Meter.kt` implements BS.1770-4 directly — it is a well-specified, ~200-line
algorithm with no external dependency:

1. Two biquad stages of K-weighting (high-shelf + high-pass) per channel, with
   coefficients derived for the stream's actual sample rate.
2. Mean-square over 400 ms blocks with 75 % overlap.
3. Channel weighting (L/R 1.0, C 1.0, Ls/Rs 1.41 — matters for 5.1 films).
4. Absolute gate at −70 LUFS, then relative gate at −10 LU below the
   ungated mean. **The relative gate is why dialogue-driven films with long quiet
   passages measure sensibly** and a naive RMS would not.
5. LRA from the 10th/95th percentiles of the short-term (3 s) loudness
   distribution.

### 3.3 Two-tier measurement — the low-powered-device answer

Full-file analysis is only ever done when it changes a decision.

**Tier 1 — sampled (default):** seek to `N` evenly spaced positions between 5 %
and 95 % of the track (skipping silent intros/credits) and decode `W` seconds at
each. Defaults `N = 12`, `W = 15 s` → 3 minutes of audio regardless of whether
the item is a 22-minute episode or a 3-hour film. Gating runs over the
concatenated windows; because BS.1770 gating is per-block, a sampled set of
blocks is an unbiased estimator of the gated mean.

**Tier 2 — full:** decode the whole audio track. Triggered only when:

- the Tier 1 estimate lands within `escalationMargin` (default 0.75 LU) of the
  deadband boundary — i.e. the "adjust or not" decision is genuinely close; **or**
- `spreadLu` exceeds `maxSpreadLu` (default 4 LU) — the item is too dynamic for
  a sample to be trusted; **or**
- the item is shorter than `N × W` (just measure it fully, it's cheaper); **or**
- the user explicitly asks for a re-analysis at full precision.

Expected escalation rate on a mixed library: **5–15 %** of items.

**Estimated cost** (audio-only AAC/AC-3 decode, measured against the assumption
of ~40× realtime on a modern phone and ~10× on a low-end Android TV box — to be
confirmed in M0):

| Item | Sampled (3 min audio) | Full (whole track) |
|---|---|---|
| 22 min episode, phone | ~4 s | ~33 s |
| 2 h film, phone | ~4 s | ~3 min |
| 2 h film, cheap TV box | ~18 s | ~12 min |
| 10 h audiobook (MP3), TV box | ~18 s | ~60 min |

A 600-item library, sampled, with 10 % escalation, on a cheap box:
**≈ 3.5 hours of background work, once.** That is why analysis must be
incremental, resumable, and scheduled (§6, M5) — never a blocking modal.

### 3.4 Grouping — measure fewer things

Items are not independent:

- **Episodes of a season** almost always share a master and measure within
  ~1 LU of each other.
- **Parts of an audiobook** always do.

So analysis works on **groups**, not files:

1. Analyse a **probe set** — for a season, 3 episodes (first, middle, last); for
   an audiobook, 2 parts.
2. If the probe spread ≤ `groupCohesionLu` (default 1.5 LU), assign the group's
   mean to every member and stop. **This is the single biggest cost saving** —
   a 9-season show with 200 episodes costs 27 analyses, not 200.
3. If the probe spread exceeds it, fall back to analysing every member
   individually (mixed-source rips, fan-dubs, etc.).

Audiobooks additionally always use a **single book-level gain** even if parts
differ — like ReplayGain's "album gain". Per-part gain would make a quiet
whispered chapter jump to match a loud one, destroying the author's dynamics.

---

## 4. Stage 2 — Deciding the target and what's "close enough"

Pure TypeScript, no I/O, in `src/scripts/LoudnessPlanner.ts`. Everything here
is unit-testable and should be tested.

### 4.1 Per-content-type targets

Films, TV and audiobooks have genuinely different natural loudness (broadcast TV
sits near −23 LUFS, film mixes far lower and more dynamic, spoken-word audiobooks
around −18 LUFS). Normalising them all to one number would make audiobooks
shout. **Targets are computed and stored per `contentTypes`** (`tv` | `movie` |
`audiobook`).

### 4.2 Choosing the target `T`

Four modes, user-selectable, defaulting to `minimise-work`:

| Mode | `T` | Rationale |
|---|---|---|
| `minimise-work` *(default)* | Centre of the **densest deadband-wide window** over the measured distribution | Literally maximises the number of items needing no adjustment. |
| `library-median` | Median of measured `integratedLufs` | Minimises total \|gain\| — the "existing average" of the library. Outlier-resistant (median, not mean). |
| `standard` | −23 LUFS (EBU R128), −18 (ReplayGain) or −16 (mobile), user-picked | For users who want their library to match broadcast/streaming levels. |
| `custom` | User-entered LUFS | Escape hatch. |

`minimise-work` is a single O(n log n) sweep:

```ts
/**
 * Returns the target that leaves the greatest number of items inside ±deadband.
 * Ties broken toward the value nearest the median, so a small dense cluster of
 * outliers can't drag the whole library.
 */
export function densestTarget(lufs: number[], deadbandLu: number): number;
```

Guard rail: if `|densestTarget − median| > maxTargetDriftLu` (default 3 LU), fall
back to the median and log it — a pathological distribution should not produce a
silly target.

Both modes need a **minimum sample** (`MIN_ITEMS_FOR_LIBRARY_TARGET = 8` per
content type). Below that, fall back to the `standard` preset; a library of three
films has no meaningful "average".

### 4.3 The deadband — the "close enough" rule

```ts
const DEFAULT_DEADBAND_LU: Record<contentTypes, number> = {
  movie: 2.0,
  tv: 2.0,
  audiobook: 1.5,   // spoken word, listened to for hours — tighter tolerance
};
```

Roughly 1 LU is the just-noticeable difference for programme loudness on
consumer gear, so ±2 LU is "you would not reach for the remote". Audiobooks get
a tighter band because the listening sessions are long and the content is
uniform, making level shifts more obvious.

An item with `|T − integratedLufs| ≤ deadband` is marked `in-tolerance`: gain 0,
no volume manipulation at play time, nothing written anywhere. **This is the
point of the whole design** — the feature should be invisible for the majority
of a library.

### 4.4 Computing the gain

```ts
export function computeGain(
  measurement: LoudnessMeasurement,
  target: number,
  deadbandLu: number,
  headroomDbfs = -1,          // never let a boost push peaks above this
): { gainDb: number; status: LoudnessStatus };
```

1. `raw = target − integratedLufs`.
2. If `|raw| ≤ deadband` → `{ gainDb: 0, status: 'in-tolerance' }`.
3. **Clip guard:** `maxBoost = headroomDbfs − peakDbfs`. If `raw > maxBoost`,
   clamp to `maxBoost`. If that costs more than 0.5 dB of the requested gain,
   status is `'clip-limited'` — the item is quiet *and* peaky (a dynamic film
   mix) and cannot be fully raised without a compressor. Surface it, don't hide it.
4. **Range clamp:** `|gainDb| ≤ maxGainDb` (default 12 dB) so a broken measurement
   can never blow someone's speakers or mute an item entirely.
5. Otherwise `{ gainDb: raw, status: 'adjusted' }`.

Note that when the *only* application mechanism available is attenuation
(A3, in-app player), positive gains are unachievable; in that configuration the
planner offsets `T` down to the 10th percentile so every gain is ≤ 0. The
planner takes the active mechanism as an input rather than assuming.

### 4.5 What the user sees

A one-line summary after analysis, e.g.:

> *Analysed 612 items. Target −22.4 LUFS. **71 items (12 %) need adjusting**;
> 8 are too dynamic to fully correct.*

---

## 5. Stage 3 — Applying the gain

### 5.1 Volume preset before handoff (A1)

Second small native module (or a second function on `zibo-loudness` — keep it
separate, it is unrelated: `modules/zibo-volume/`):

```ts
export function getVolumeTable(): { index: number; db: number }[]; // via AudioManager.getStreamVolumeDb
export function getVolumeIndex(): number;
export function setVolumeIndex(index: number): void;
```

`AudioManager.getStreamVolumeDb(STREAM_MUSIC, index, DEVICE_OUT_SPEAKER)` (API 28+)
returns the **actual dB** for each volume index, so the mapping from "I want
−4 dB" to "set index 11" is exact rather than guessed. On API < 28, or if the
call throws, fall back to a logarithmic approximation and widen the deadband to
3 LU (the mapping is less trustworthy, so touch fewer items).

Flow, in a new `src/scripts/PlaybackGain.ts` called from `openMedia.ts`:

1. On play, read the current index. If no adjustment is currently applied, store
   it as the user's **reference volume** (`referenceIndex`, in Redux, persisted).
2. Look up the item's `gainDb`. If 0 / `in-tolerance` → do nothing at all,
   don't even read the volume.
3. Otherwise pick the index whose dB is closest to
   `db(referenceIndex) + gainDb`, clamped to `[0, max]`, and set it.
4. Fire the intent.
5. On app resume (`AppState` → `active`), restore `referenceIndex`. If the user
   changed the volume *while* the external player was foregrounded, the value we
   read back won't be what we set — treat that as the user overriding us: adopt
   `db(observedIndex) − gainDb` as the new reference, log it, and don't fight them.

Requires `android.permission.MODIFY_AUDIO_SETTINGS` (a normal, install-time
permission — no runtime prompt) added to `app.json`'s `android.permissions`.

**Honest limitations, to be documented in-app:**

- Devices with few volume steps (some TV boxes have 15 or fewer, and some HDMI
  passthrough paths report a fixed volume) give coarse or no control. Detect
  `getStreamMaxVolume() < 10` or a flat dB table and disable the feature with an
  explanation rather than doing something useless.
- Bluetooth absolute-volume and external AVR volume are outside our control.
- If the user has a wildly different reference volume for headphones vs speakers,
  the reference tracking in step 5 handles it after one playback.

### 5.2 Per-item manual override

Users will disagree with the algorithm occasionally. Add `gainDbOverride?: number`
to `IMediaOverride` (`src/store/libraryReducer.ts:6`) — it slots naturally into
the existing additive-override model: setting it wins over the computed gain,
clearing it restores the computed value, and nothing measured is destroyed.
Exposed as a slider in `src/app/edititem.tsx`.

### 5.3 Permanent, file-level normalisation — what it actually costs

It is tempting to write off "re-encode with `loudnorm`" as ruinously expensive.
That is wrong, and the reason matters, because it changes which option is the
cheap one.

**`loudnorm` is two separable things.** Pass one —
`ffmpeg -i in.mkv -af loudnorm=print_format=json -f null -` — decodes and
measures, producing `input_i` / `input_tp` / `input_lra` / `input_thresh`. It
writes no file. That is *exactly* the Stage 1 measurement of this plan and costs
an audio decode, nothing more. Pass two applies the gain. **You only ever need
pass two if you want the change baked into the file**, and once pass one has
given you a number, pass two can be the far simpler `-af volume=-3.2dB`.

**Applying it to video is cheap in CPU and expensive in I/O.** With
`-map 0 -c copy -c:a:0 ac3 -af volume=…` the video bitstream is stream-copied,
not transcoded — only one audio track is decoded and re-encoded. For a 2-hour
film that is a couple of minutes of CPU on a phone, not hours. **My earlier
framing of this as "hours per film" was a full-transcode figure and simply
wrong.** The genuine objections are elsewhere:

- **A whole new file must be written.** An 8 GB film means reading 8 GB and
  writing 8 GB, then replacing the original. Over USB 2.0 that's ~10 minutes; over
  a Wi-Fi SMB share, closer to half an hour. CPU was never the bottleneck.
- **It needs 2× free space** during the operation, on storage the user may not
  control.
- **Lossy → lossy generation loss** on the re-encoded audio track.
- **A failure mid-write can destroy an irreplaceable file.** This is the one that
  actually settles it. An app whose job is *browsing* a library should not be
  rewriting multi-gigabyte files on a network share.

So A4 stays a non-goal for video — but for the right reason, and only for video.

**For audio-only files there is a genuinely cheap permanent option (A2b).** MP3
and AAC frames carry a `global_gain` field; patching it changes playback level
**without re-encoding anything**. This is the mp3gain/aacgain technique, and it
is qualitatively different from A4:

- **In place.** The file size does not change, so there is no second copy, no
  2× space requirement, and no rename-over-the-original step. On Android this is
  a SAF `ParcelFileDescriptor` opened `"rw"`.
- **Lossless and reversible.** No decode, no re-encode, no generation loss.
  Record the applied gain in a tag and it can be undone exactly.
- **Trivial CPU.** It is a frame walk with a few patched bytes per frame — the
  cost is one pass of disk I/O.
- **1.5 dB quantisation** on MP3 (the field's own step size). That is a neat fit:
  the whole design already treats sub-2 LU differences as inaudible, so the
  quantisation error lands inside the deadband by construction.

The reference implementation to work from is
[`mp3rgain`](https://github.com/M-Igashi/mp3rgain), a maintained Rust rewrite of
mp3gain that also covers AAC/M4A (the original `aacgain` has been unmaintained
since ~2009). Getting it onto Android means either an NDK cross-compile plus a
JNI shim, or a Kotlin reimplementation of the frame walk — a bounded, testable
piece of work, and far less risky than any remux.

**This makes audiobooks the strongest candidate for permanent normalisation** —
they are the content where level consistency matters most (long sessions, uniform
material), they are already MP3/M4B, and they are the one case where we can do it
losslessly and in place.

### 5.4 Media3 Transformer — the other "newer library"

[Media3 Transformer](https://developer.android.com/media/media3/transformer) is
first-party, actively maintained, and a plain Gradle dependency — usable directly
from a local Expo module with no React Native binding to maintain. It supports
custom `AudioProcessor` chains, and gain specifically via
`ChannelMixingAudioProcessor` with `ChannelMixingMatrix.scaleBy(float)`. It also
transmuxes (stream-copies) tracks whose format already matches the request, so
"copy the video, re-encode only the audio" is its natural mode.

On paper that is exactly what A4 wants, with none of ffmpeg's baggage. **The
blocker is containers.** Transformer's muxers write MP4, fragmented MP4, WebM,
AAC, Ogg and WAV — **not Matroska**. A library that is largely MKV carrying
AC-3/E-AC-3/DTS/TrueHD would come out the other side as MP4, silently changing
the user's files, and would fail outright on codecs `MediaMuxer` cannot carry.
MP3 audiobooks fare no better — they would come back as `.m4a`.

So Media3 Transformer is a good tool aimed slightly past this problem. Worth
re-checking at M6 in case Matroska output lands, but not something to build on
today.

---

## 6. Milestones

### M0 — Feasibility spike *(1–2 days, gating)*

Before building anything, prove the two assumptions this plan rests on.

1. Throwaway Kotlin harness: `MediaExtractor` + `MediaCodec` audio-only decode of
   an MKV/AC-3, an MP4/AAC and an MP3. Measure realtime factor on the lowest-spec
   device available.
2. Log `getStreamVolumeDb` across all indices on the same device; confirm a usable
   dB table and a step size ≲ 2 dB near the top of the range.
3. Manually set the media volume, fire the existing play intent at VLC and at
   MX Player, confirm the level actually changes and nothing resets it.

**Exit criteria:** ≥ 8× realtime audio decode on the slow device, and a working
volume table. **If (3) fails on both players, stop** — the primary application
mechanism does not exist and only A2/A3 remain, which is a materially different
(smaller) feature worth re-planning.

### M1 — Measurement engine

- Scaffold `modules/zibo-loudness/` (`npx create-expo-module@latest --local`).
- Implement `AudioDecoder.kt` (extractor + async `MediaCodec`, PCM 16/float
  normalisation, resample-free — K-weighting coefficients are computed for the
  stream's own rate).
- Implement `Bs1770Meter.kt` (K-weighting, 400 ms/75 % blocks, dual gating,
  channel weights, LRA, peak).
- Implement sampled mode (seek + decode `N × W`) and full mode.
- Cancellation + progress events (`sendEvent`, consumed later by the queue).
- Validate against known references: a −23 LUFS EBU test tone and 2–3 files
  measured with `ffmpeg -af ebur128` on a desktop. **Tolerance: ±0.3 LU for full
  mode, ±1.0 LU for sampled.**

**Exit criteria:** `analyse()` returns numbers matching ffmpeg within tolerance
on the reference set.

### M2 — Data model, persistence and cache

- `ILoudnessEntry` + `loudness: Record<string, ILoudnessEntry>` on `LibraryState`
  (`src/store/libraryReducer.ts`), keyed by the **existing namespaced override
  keys** (`movie:<parsedPath>`, `episode:<parsedPath>`, `audiobook:<folderKey>`,
  `show:<showName>` for group-level entries) so it lines up with `mediaOverrides`
  for free:

```ts
export interface ILoudnessEntry {
  /** Gated integrated loudness, LUFS. */
  lufs: number;
  /** Sample peak, dBFS — the clipping guard input. */
  peakDbfs: number;
  /** How it was measured. */
  mode: 'sampled' | 'full' | 'group-inherited';
  /** Std-dev across analysis windows, LU (0 for full/inherited). */
  spreadLu: number;
  /** Cache-invalidation fingerprint: `${size}:${lastModified}` when available, else `${size}`. */
  fingerprint: string;
  /** When it was measured (Date.now()). */
  measuredAt: number;
  /** Group key this value was inherited from, when mode === 'group-inherited'. */
  groupKey?: string;
}
```

- Reducers: `setLoudnessEntries` (batch), `clearLoudness`, `clearLoudnessForKey`;
  selectors `selectLoudness`, `selectLoudnessForKey`, matching the existing
  `select*` convention.
- **Cache invalidation** on the fingerprint. File size is reliably available for
  SAF entries; `lastModified` is not always — fall back to size alone and note
  the (rare) miss when a file is replaced by one of identical size.
- **Rescan carry-over**: extend the existing carry-over pass in
  `FileScanner.scanAllSources` (ARCHITECTURE.md §7 step 5) to copy forward
  loudness entries whose fingerprint still matches, exactly as it already does
  for posters and resolved titles. Without this, every rescan discards hours of
  analysis.
- **Sidecar**: additive optional fields on `SmbJsonShowData` / `SmbJsonMovieData`
  (`src/scripts/SmbTypes.ts`) — `loudness?: { lufs, peakDbfs, mode }` at
  movie/episode level. Purely additive, so `smbVersion` stays `1` and older
  readers ignore it. Write in `ImportExportService.exportToFilesystem`, read in
  `FileScanner`'s smb.json parse. Add an audiobook sidecar only if we introduce
  one for other reasons — audiobooks currently have no `smb.json` writer.

**Exit criteria:** analysis results survive an app restart and a full rescan.

### M3 — The planner *(pure TS — the well-tested bit)*

`src/scripts/LoudnessPlanner.ts`:

- `densestTarget(lufs, deadband)`, `medianTarget(lufs)`, `resolveTarget(...)`
- `computeGain(measurement, target, deadband, headroom)`
- `groupCohesion(members)` → `{ spreadLu, cohesive: boolean }`
- `planLibrary(entries, settings)` → per-key `{ gainDb, status }` + a summary
  (`{ total, inTolerance, adjusted, clipLimited, target }`)
- `selectProbeSet(members)` — first/middle/last selection for group probing.

**Exit criteria:** Jest suite green, covering: empty library, single item, all
items identical, bimodal distribution, the `maxTargetDriftLu` guard, clip-limited
items, the attenuation-only variant, and the `< MIN_ITEMS_FOR_LIBRARY_TARGET`
fallback. This is the first real test suite in the repo (AGENTS.md notes
`jest-expo` is configured and unused) — it is exactly the pure-logic case that
guidance asks for.

### M4 — Applying gain at playback

- `modules/zibo-volume/` native module (§5.1).
- `src/scripts/PlaybackGain.ts`: reference-volume tracking, index selection,
  restore-on-resume, capability detection (few steps / flat table → disabled).
- Wire into `openMediaInExternalApp` (`src/scripts/openMedia.ts:51`) — take an
  optional `gainDb` and apply before the intent. Both call sites
  (`src/components/MediaBrowserScreen.tsx:1056`, `src/components/ui/FileLink.tsx:12`)
  pass the planned gain for the item.
- `MODIFY_AUDIO_SETTINGS` in `app.json`.
- `gainDbOverride` on `IMediaOverride` + slider in `src/app/edititem.tsx`.

**Exit criteria:** on a device, playing a known-loud and a known-quiet film
back-to-back requires no manual volume change; the volume returns to the user's
reference on app resume.

### M5 — Orchestration and UX

- `src/scripts/LoudnessService.ts`, singleton (`getInstance()`), matching the
  `FileScanner`/`MetadataService` pattern:
  - a persistent work queue of unanalysed / stale keys, ordered by
    **likely-to-be-played-next** (recently added, then `lastOpened` recency, then
    alphabetical) so the benefit shows up early;
  - a `Semaphore(1)` — analysis is CPU- and IO-bound and must *not* contend with
    scanning or thumbnail generation (`MAX_CONCURRENT_THUMBNAILS = 3` already
    exists for the same reason);
  - group probing (§3.4), Tier-1 → Tier-2 escalation (§3.3);
  - cooperative cancellation mirroring `FileScanner.cancelScan()`;
  - **budgeting:** default "analyse while the app is open and idle, max N items
    per session, pause during a scan"; opt-in "analyse everything now" for users
    who want to sit through it.
  - all progress and failures through `logger` (`src/scripts/Logger.ts`) — release
    builds have no console.
- Extend `ScanProgress.phase` (`src/store/libraryReducer.ts:157`) with
  `'analysing'` plus `loudnessDone` / `loudnessTotal`, reusing the existing
  progress UI in `MediaBrowserScreen`.
- Settings (`src/app/(drawer)/settings.tsx` + `settingsReducer.ts`), new section
  **Audio normalisation**:
  - `enableAudioNormalisation: boolean` (default **false** — opt-in; it costs
    battery and touches system volume)
  - `normalisationTargetMode: 'minimise-work' | 'library-median' | 'standard' | 'custom'`
  - `normalisationStandard: 'ebu' | 'replaygain' | 'mobile'` and `normalisationCustomLufs: number`
  - `normalisationDeadbandLu: number` (slider, 0.5–4)
  - `normalisationAnalysisMode: 'sampled' | 'full'`
  - `normalisationBudgetPerSession: number`
  - buttons: **Analyse library now**, **Re-analyse everything**, **Clear loudness data**
  - a read-only summary line (§4.5) plus device capability status.
- Edit mode: show the measured LUFS and planned gain on an item; badge
  `clip-limited` items so the user knows why one is still quiet.

**Exit criteria:** a user can enable the feature, watch it work through the
library in the background without the UI stalling, and see how many items were
actually adjusted.

### M6 — Optional extensions *(only if M1–M5 land well)*

- **ReplayGain / R128 tagging for audio files** (audiobooks). `jaudiotagger`
  against a SAF `ParcelFileDescriptor` can write `REPLAYGAIN_TRACK_GAIN` /
  `R128_TRACK_GAIN` into MP3/M4B/FLAC/Opus without re-encoding. Benefit: VLC and
  most audiobook players then normalise natively, with no system-volume tricks
  and correct behaviour when Zibo isn't the launcher. Opt-in, with a clear "this
  modifies your files" confirmation and a "remove tags" action. **Not** attempted
  for MKV/MP4 — no maintained Android library and a moov rewrite of a multi-GB
  file over SAF is a corruption risk.
- **Lossless `global_gain` patching for audiobooks (A2b, §5.3).** The strongest
  version of the above: instead of a tag that only some players honour, patch the
  MP3/AAC frame gain in place so *every* player gets a correctly-levelled file.
  Lossless, reversible, no re-encode, no second copy. Steps: port the frame walk
  (from `mp3rgain`) via NDK+JNI or reimplement in Kotlin; open the SAF descriptor
  `"rw"`; write the applied gain to a tag so it can be undone; add an "undo
  normalisation" action. Ship behind the same explicit "this modifies your files"
  confirmation, and only after the analysis numbers have been trusted in the field
  for a release or two.
- **Re-open the ffmpeg decision (§3.1).** If users want permanent normalisation
  for *video* too, that is the point at which building FFmpegKitNext from source
  in CI earns its cost — it would serve both the measurement and A4. The I/O and
  data-loss objections in §5.3 still apply and would need a real answer (write to
  a temp file on internal storage, verify, then swap; refuse on network sources).
- **In-app player path** using the already-installed `expo-video`, applying exact
  attenuation via `player.volume`. Best precision available, but it changes the
  product from "launcher" to "player" and inherits codec limits — a product
  decision, not a technical one.
- **Export/import**: include loudness in `ImportExportService.exportJson` so a
  reinstall or a second device doesn't repeat hours of analysis.

---

## 7. Performance and battery guard rails

Non-negotiables for the low-powered-device case:

1. **Analysis never blocks the UI or a scan.** Single-slot semaphore, paused
   whenever `isScanning` is true.
2. **Sampled by default.** Full-file analysis only on escalation or explicit
   request.
3. **Groups before members.** A cohesive season costs 3 analyses, not 30.
4. **Deadband before work.** Anything in tolerance is never revisited.
5. **Fingerprint cache + rescan carry-over.** Analysis happens once per file
   version, ever.
6. **Session budget.** Default cap on items per app session; the queue is
   persistent, so it simply resumes next time.
7. **Bail out on hostile hardware.** If M0-style capability checks fail (too few
   volume steps, no `getStreamVolumeDb`, decode slower than ~4× realtime), the
   feature disables itself with an explanation instead of grinding.

---

## 8. Testing

Automated (`npx jest`) — all of M3, plus:

| Function | Cases |
|---|---|
| `densestTarget` | empty, single, uniform, bimodal, dense-outlier-cluster |
| `medianTarget` | even/odd counts, NaN rejection |
| `computeGain` | in-tolerance, boost, cut, clip-limited, range-clamped, attenuation-only mode |
| `groupCohesion` / `selectProbeSet` | cohesive season, mixed-source season, 1–2 member groups |
| `planLibrary` | summary counts, per-type targets, min-sample fallback |
| fingerprint/invalidation helpers | size-only fallback, changed size, unchanged |

Manual, on hardware (**cannot be verified in CI or in a sandbox** — SAF, native
decode and external players are all involved):

- Measurement accuracy vs `ffmpeg -af ebur128` on a reference set.
- Sampled-vs-full agreement across 20 real library items.
- Volume preset with VLC and MX Player, on a phone and on an Android TV box.
- Bluetooth / HDMI output paths.
- Battery and thermals during a bulk analysis run on a low-end device.

Per AGENTS.md, `npx tsc --noEmit` and `npm run lint` must pass for every
milestone.

---

## 9. Explicit non-goals

- **Re-encoding the audio track of video files (`loudnorm` / A4)** — *for v1*.
  Not because it is slow: with the video stream-copied it is a couple of minutes
  of CPU per film. Because it means rewriting a multi-gigabyte file over
  SAF/network storage, needing 2× free space, with a mid-write failure destroying
  something irreplaceable (§5.3). A browsing app should not carry that risk by
  default. Permanent normalisation of *audio-only* files is a different matter and
  is planned as A2b in M6. If a user wants it baked into their films, a desktop
  pass before the files reach the library remains the right answer.
- **Dynamic range compression / night mode.** Different feature, different
  problem (loud explosions vs quiet dialogue *within* one item). Related, worth
  considering later, out of scope here.
- **Real-time normalisation during playback.** Impossible without owning the
  playback path.
- **Per-audio-track handling for multi-track files.** v1 measures the default
  track. Files with a commentary track or a mismatched second language will be
  measured on whatever the extractor selects first, which is usually right.

---

## 10. Open questions

1. **Does `lastModified` come back for SAF `content://` entries reliably enough
   to use in the fingerprint?** Needs checking against the current
   `expo-file-system` API surface; the plan already degrades to size-only.
2. **Does MX Player reset media volume on launch?** M0 answers this; if it does,
   the primary mechanism loses one of the two mainstream players.
3. **Should analysis be offered during the first-run flow** (`src/app/firsttime.tsx`)
   or only discovered in settings? Leaning toward settings-only — the first scan
   is already long enough.
4. **Group cohesion threshold of 1.5 LU** is a guess informed by how episodes are
   usually mastered; worth validating against a real multi-season library during
   M5 and tuning.
5. **Is a MediaCodec-based meter actually faster than software ffmpeg decode for
   audio?** The Path 1 recommendation in §3.1 partly rests on hardware offload
   being a win on weak devices. Audio decode is cheap in software too, and
   MediaCodec carries per-buffer JNI overhead. M0 should measure both if the
   ffmpeg option is still live at that point — if software decode is comparable,
   the case for Path 1 rests on APK size and supply chain alone.
6. **What proportion of a real audiobook library is MP3 vs M4B?** A2b's value
   depends on it; the MP3 frame walk is well-trodden, the AAC one less so.
