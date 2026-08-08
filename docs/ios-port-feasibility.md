# iOS Port — Feasibility Study

*Investigation date: 2026-08-08 · Against `main` @ `40498f4` (v1.15.2, Expo SDK 55, RN 0.83.6)*

---

## TL;DR

**Yes, it's doable — roughly 3–4 weeks of work — but the result is a subtly
different product.**

| Question | Short answer |
|---|---|
| **Can it build for iOS?** | Almost immediately. Managed CNG workflow, no committed native folders, `npm run ios` already exists. Add a bundle identifier and `expo prebuild -p ios` produces a launching app in under a day. |
| **How expansive are the changes?** | The *build* is free; the *function* is the project. Two hard blockers (storage acquisition, playback) plus one data-model cleanup. Only **one** of 28 runtime dependencies is Android-only. |
| **Does iOS support the same capabilities?** | **Storage: yes, with a custom native module.** **Playback: no — not fully.** |
| **Can you store local content and browse it?** | Yes. iOS can grant persistent access to a user-chosen folder via security-scoped bookmarks, but Expo does not expose that API, so it requires ~200 lines of Swift. |

The honest caveat: the current Android UX is *"point at any folder, hand the
file to MX Player / VLC."* On iOS the handoff half of that has no equivalent.
Playback becomes in-app with real codec limits.

---

## 1. Can the app build for iOS?

**Yes, and the build side is genuinely close to free.**

The project is a **managed Expo workflow using on-demand prebuild**. Neither
`ios/` nor `android/` is committed — both are explicitly ignored:

```gitignore
# generated native folders
/ios
/android
```

So there is no "un-ejecting" work. `npx expo prebuild -p ios` generates a fresh
Xcode project. `package.json` already declares `"ios": "expo run:ios"`.

### What's missing from config

`app.json`'s `ios` block currently contains **only an icon**:

```json
"ios": {
  "icon": "./assets/images/icon.png"
}
```

To build you need to add at minimum `bundleIdentifier`, plus `buildNumber`
(because `eas.json` sets `"appVersionSource": "local"`) and `supportsTablet`.
`eas.json`'s three profiles are platform-agnostic, so
`eas build --platform ios` would resolve once credentials exist.

### What you'd get

A compiling, launching app — that is **functionally dead**. Navigation, drawer,
settings and theming would render, but the user cannot add a media source (the
picker throws on iOS) and nothing can be played.

### Dependency audit

Of 28 runtime dependencies, exactly **one** is Android-only:

| Package | Status |
|---|---|
| `expo-intent-launcher` | **Android-only.** No iOS implementation. Used solely in `src/scripts/openMedia.ts`. |

Two iOS-*only* packages are already installed and create a misleading impression
of prior iOS work:

- `expo-glass-effect` — declared in `package.json`, **never imported anywhere**.
- `expo-symbols` (SF Symbols) — imported only by unused Expo-template screens
  (`src/app/explore.tsx`, `src/components/ui/collapsible.tsx`) per
  ARCHITECTURE.md §15.

Everything else — `expo-video`, `expo-image`, `expo-document-picker`,
`expo-image-manipulator`, navigation, Redux, Reanimated — is cross-platform.

> **Housekeeping note:** `expo-file-system` is used heavily throughout the app
> but is **not a direct dependency** — it arrives transitively via `expo`
> (55.0.17). It should be promoted to an explicit dependency regardless of the
> port.

---

## 2. Does iOS support the same capabilities?

### 2a. Storing local content and browsing it — **yes, with a native module**

This is the question that decides the port, and the answer has a sharp edge.

Android's Storage Access Framework gives a **persistent** grant: the user picks a
tree once, Android calls `takePersistableUriPermission`, and the app can re-read
that folder forever. iOS has no direct equivalent.

**What Expo gives you today:** `Directory.pickDirectoryAsync()` *does* work on
iOS (added in `expo-file-system` 19.0.11, SDK 54 — the changelog entry reads
`[iOS] Add pickDirectoryAsync support`). But the access it grants is
**temporary and lost when the app restarts**, and Expo exposes **no bookmark
API** — searching the entire `expo-file-system` changelog for "bookmark" returns
zero entries. On its own this cannot back a persistent media library.

**What iOS actually supports:** persistent folder access via **security-scoped
bookmarks**:

1. Present `UIDocumentPickerViewController(forOpeningContentTypes: [.folder])`.
2. `startAccessingSecurityScopedResource()` on the returned URL.
3. `url.bookmarkData()` → an opaque blob you persist.
4. On next launch, `URL(resolvingBookmarkData:bookmarkDataIsStale:)` and
   re-activate.

This works on iOS and is the standard approach for file-manager-style apps. Note
the `.withSecurityScope` option is **macOS-only**; on iOS you create a plain
bookmark of an already-accessible URL.

Because Expo doesn't surface any of this, it needs a **local Expo module in
Swift**. That is the chosen path (see M2 below).

**Contingency worth knowing about:** a zero-native-code alternative exists — set
`UIFileSharingEnabled` and `LSSupportsOpeningDocumentsInPlace` in `Info.plist`
and the app's own Documents directory appears in the Files app under
*On My iPhone → Shelf*. Users then add media by Files drag-and-drop, Finder USB
sync, or AirDrop. This is the VLC / Infuse model. It gives full persistent
read/write with no Swift at all, but media must be **copied into** the app and
you can never point at an external drive or network share. Keep this in the back
pocket if M2 runs into trouble.

### 2b. Playback — **no, and this is the real loss**

The app never plays media itself. `src/scripts/openMedia.ts:52-60`:

```ts
if (Platform.OS === 'android') {
    await IntentLauncher.startActivityAsync('android.intent.action.VIEW', {
        data: contentUri,
        type: getMimeType(filename),
        flags: FLAG_GRANT_READ_URI_PERMISSION,
    });
} else {
    await Linking.openURL(contentUri);   // ← no-op in practice
}
```

An iOS branch already exists, but it hands a `content://` URI to
`Linking.openURL`, which does nothing useful. iOS has **no intent system** — no
way to say "open this file in whatever video player the user prefers."

The three available options, all compromised:

| Option | Problem |
|---|---|
| **In-app player** (`expo-video` / AVPlayer) | AVPlayer **cannot play MKV or AVI** — only MP4/M4V/MOV with H.264/HEVC/AV1. For a scanned media library that's a large share of files. |
| **Share sheet / "Open In"** | iOS **copies** the file to the target app. Painful-to-unusable for multi-GB videos. |
| **VLC's `vlc-x-callback://` URL scheme** | VLC on iOS **cannot read files inside another app's sandbox**, so this only helps for network URLs. |

**Recommended combination:** in-app `expo-video` player for natively supported
containers, share-sheet handoff as the fallback for MKV/AVI, routed by
extension. This covers the most files with an honest degradation path.

`expo-video` is already a dependency — currently used only for thumbnail
generation (`FileScanner.ts:1156`), not playback.

---

## 3. What actually needs to change

### Blocker 1 — storage acquisition is SAF-only

The *call surface* is small. Six call sites in total:

| File | Line | Call |
|---|---|---|
| `src/components/ui/AddMediaSource.tsx` | 52 | `requestDirectoryPermissionsAsync()` — the **only** place a library root is ever chosen |
| `src/scripts/FileScanner.ts` | 789, 887 | `readDirectoryAsync` — the core recursion primitive |
| `src/scripts/FileScanner.ts` | 278, 1001, 1034 | `readAsStringAsync` — poster fallback, `smb.json`, `smb_thumb_*.jpg` |

But the *design* is SAF-shaped, and that's the deeper cost. SAF returns a flat
list of URIs with no reliable is-directory flag, so the scanner infers
directory-ness from the file extension (`FileScanner.ts:797-798`):

```ts
// SAF entry metadata is unreliable; infer obvious file types by extension.
const isDirectory = !this.isMediaFile(filename) && !NON_DIRECTORY_EXTENSIONS.has(ext);
```

Anything unrecognised is speculatively recursed into, and a failed
`readDirectoryAsync` is caught and treated as "not a directory."
`NON_DIRECTORY_EXTENSIONS` exists purely to limit that always-fails probe.

**On a POSIX filesystem none of this is needed** — `Directory.list()` returns
typed `File` / `Directory` instances. The iOS adapter gets to be simpler and
more correct than the Android one.

### Blocker 2 — `content://` grammar is hand-parsed

`src/scripts/ImportExportService.ts:56-118` parses the SAF URI grammar with
literal regexes across three functions:

```ts
const treeMatch = source.uri.match(/^content:\/\/([^/]+)\/tree\/([^/]+)$/);
const expectedPrefix = `content://${authority}/tree/${encodedTreeDocId}/document/`;
```

`getSafParentDirUri`, `getShowFolderUri` and `getRelativeDepth` are pure Android
SAF grammar and are load-bearing for the entire filesystem-export feature. They
need to become a path abstraction.

### Not a blocker — persisted state

Redux persists raw SAF URIs as identity keys (`IMediaSource.uri`,
`IMediaObject.path`; see `libraryReducer.ts:74` — *"SAF content:// URI used to
open the file in an external player"*). This looks alarming but **is not a
migration problem**: an iOS install starts with an empty library and builds it
by scanning. The requirement is only that code stops *assuming* `content://`,
not that existing data be converted.

### Minor platform gaps

- `MediaBrowserScreen.tsx:711` — `BackHandler.addEventListener('hardwareBackPress')`
  intercepts the Android back button to pop the folder nav stack. A no-op on
  iOS; the equivalent swipe-back / drawer behaviour needs verifying.
- `Logger.ts` writes to `<documents>/smb_debug.log` and its doc comment
  describes Android-only `adb shell run-as` retrieval.
- Assets are Play-Store-shaped (`adaptiveIcon`, `assets/store/feature-graphic.png`);
  the splash screen plugin config supplies only an `android` image.
- All three CI workflows hardcode `--platform android` on `ubuntu-latest`.

---

## 4. Milestone plan

Target: **a working device / TestFlight build.** App Store submission is out of
scope here.

### M0 — Prove it builds · ~0.5 day · *no Mac needed for planning, Mac to run*

Add `ios.bundleIdentifier`, `buildNumber`, `supportsTablet` to `app.json`.
Run `npx expo prebuild -p ios` and launch on the simulator.

**Deliverable:** a concrete list of what renders vs. what breaks. This is cheap
and de-risks every later estimate.

### M1 — Storage abstraction layer · ~2–3 days · *no Mac needed*

Introduce `src/scripts/storage/` with an `IStorageAdapter` interface:

```ts
pickLibraryRoot(): Promise<LibraryRoot | null>
listDirectory(uri): Promise<{ uri, name, isDirectory }[]>
readText(uri) / readBase64(uri)
parentOf(uri) / joinChild(parent, name) / relativeDepth(root, uri)
writeFile(dirUri, name, content, mime, encoding)
```

Ship `SafStorageAdapter` first, wrapping today's calls **verbatim**. Refactor the
six SAF call sites, `AddMediaSource.tsx`, and the three grammar functions in
`ImportExportService.ts` to go through it.

Follow the existing `getInstance()` singleton convention used by `FileScanner`
and `MetadataService`.

> **This is a pure refactor — Android behaviour must be byte-identical.** It is
> also the milestone with the best standalone value: it pays down the
> `content://` coupling whether or not the port ever ships.

### M2 — Swift bookmark module · ~4–6 days · **critical path · Mac + Xcode required**

A local Expo module owning the whole access flow:

- `pickFolder()` → presents `UIDocumentPickerViewController(forOpeningContentTypes: [.folder])`,
  calls `startAccessingSecurityScopedResource()`, creates `url.bookmarkData()`,
  returns `{ uri, bookmark }`.
- `resolveBookmark(data)` → `{ uri, isStale }`.
- Explicit `startAccess(uri)` / `stopAccess(uri)`.

On launch, resolve and re-activate **all** stored bookmarks *before* any scan
runs.

**Risks to plan for:**
- NSURL bookmark resolution across volume mounts is known-buggy — external USB
  drives may resolve unreliably.
- Stale bookmarks require re-prompting the user; the UI needs a "reconnect this
  folder" path that doesn't exist today.
- There is a practical ceiling on simultaneously-open security-scoped resources.

### M3 — iOS storage adapter · ~2–3 days

POSIX adapter over `Directory` / `File` on the resolved `file://` URL, wired to
M2's bookmarks. Persist the bookmark blob alongside `IMediaSource.uri`.

Once this lands, **scanning, metadata enrichment, poster caching and `smb.json`
sidecars all work unchanged** — they already use the cross-platform
`File`/`Directory` API. Drop the extension-inference hack on this adapter and
use real `isDirectory`.

### M4 — Playback · ~2–4 days

In-app `expo-video` player screen for MP4/M4V/MOV. Share-sheet handoff for
MKV/AVI (`expo-sharing` needs adding — it is not currently a dependency).
Route by extension, reusing the existing `MEDIA_MIME_TYPES` map in
`openMedia.ts`. Replace the dead `Linking.openURL` branch.

Surface the codec limitation in the UI rather than letting playback fail
silently.

### M5 — Platform polish · ~1–2 days

Back-navigation behaviour without `BackHandler`; safe-area insets; iOS splash
image and icon assets; audit the `Platform.select` sites in `theme.ts` and
`firsttime.tsx`. Optionally put the already-installed `expo-glass-effect` to use.

### M6 — Device / TestFlight build · ~1–2 days

Add iOS EAS profiles including an `ios.simulator` variant; run on a physical
device; push an internal TestFlight build. iOS CI needs EAS cloud or a macOS
runner.

> **Cost note:** TestFlight requires a **paid Apple Developer Program
> membership ($99/yr)**. A free Apple account only allows 7-day device
> provisioning — enough to test on your own phone, not enough to distribute.

---

## 5. Summary of risk

| Risk | Severity | Notes |
|---|---|---|
| Bookmark module doesn't behave on external/network volumes | **High** | Documented NSURL bug. Mitigation: Files-app Documents model (§2a contingency). |
| MKV/AVI unplayable in-app | **High** | Inherent to iOS. No workaround short of bundling a software decoder. |
| No usable app until M2 lands | Medium | Consequence of bookmarks-first ordering; M0/M1 deliver value independently. |
| Mac + Xcode becomes a hard requirement | Medium | From M2 onward. |
| Android regression during M1 refactor | Medium | Mitigate by treating M1 as behaviour-preserving; there is currently **no test suite**, so this is manual. |

**Recommended first step regardless of commitment:** M0 and M1. M0 costs half a
day and replaces speculation with facts; M1 improves the Android codebase on its
own merits and is reversible in a way that Swift is not.
