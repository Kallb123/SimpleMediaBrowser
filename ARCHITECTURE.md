# Architecture

This document describes how Zibo is put together: the app's
purpose, its runtime architecture, the data model, and the major subsystems.
It is aimed at anyone (human or AI agent) making non-trivial changes to the
codebase. For a quick orientation and contributor workflow, see
[AGENTS.md](./AGENTS.md); for user-facing features, see [README.md](./README.md).

## 1. Purpose

Zibo ("Zibo — Local Media Library") is an Android-first Expo/React Native app
that turns
folders on local or network storage (accessed via Android's Storage Access
Framework) into a browsable media library. It does **not** play media itself
— it scans, organizes, and enriches metadata, then hands playback off to an
external player app via an Android intent. Three media types are supported:
TV shows (with seasons/episodes), movies, and audiobooks.

## 2. Tech Stack

| Layer | Technology |
|---|---|
| Framework | Expo SDK 55 / React Native 0.83, React 19 |
| Navigation | Expo Router (file-based routing) — drawer + stack |
| State | Redux Toolkit + redux-persist (AsyncStorage-backed) |
| File access | `expo-file-system` (new `File`/`Directory` API) + SAF (`expo-file-system/legacy`'s `StorageAccessFramework`) |
| Metadata | TMDB and TheTVDB REST APIs (TV/movies), iTunes Search API (audiobook cover art, keyless) |
| Video | `expo-video` (thumbnail generation via `expo-image-manipulator`) |
| List rendering | `@shopify/flash-list` |
| Language | TypeScript (`strict: true`), path alias `@/*` → `src/*` |

The app targets Android; iOS/web builds exist (Expo supports them by default)
but are not actively maintained — some legacy-template screens only really
make sense on those platforms (see §10).

## 3. Repository Layout

```
SimpleMediaBrowser/
├── App.tsx                      # Unused legacy entry point; real entry is expo-router (see index.js)
├── index.js                     # Entry: registers expo-router root ("expo-router/entry" in package.json)
├── app.json                     # Expo app config (name, package id, plugins, expo-router root="src")
│                                # Note: `android.package` is still `net.nawt.simplemediabrowser` and the EAS
│                                # `slug` is still `SimpleMediaBrowser` — both are store/build identity and
│                                # must not be renamed, they predate the Zibo rebrand.
├── eas.json                     # EAS Build profiles
├── build.ps1                    # Windows helper script for local release builds
├── .github/workflows/           # CI: pre-build-test.yaml (typecheck/lint/test), build-apk.yml, eas-build.yaml
├── assets/                      # Icons, splash images, fonts, store graphics
│   └── svg/                     # Master brand artwork (launcher fg/bg/monochrome, icon); PNGs are rasterised from these
├── docs/                        # README screenshots
├── scripts/reset-project.js     # Stock Expo "reset to blank template" helper — not app logic
└── src/
    ├── app/                     # Expo Router file-based routes (screens)
    │   ├── _layout.tsx          # Root layout: Redux Provider, theme, first-time-setup redirect, Stack screens
    │   ├── firsttime.tsx        # First-run onboarding (add a media source, pick defaults)
    │   ├── edititem.tsx         # Modal: edit/override title, poster, provider match for a show/movie/episode
    │   ├── mergeshows.tsx       # Modal: merge two show entries that scanning didn't auto-merge
    │   ├── modal.tsx            # Stock Expo template "About" modal (leftover, see §10)
    │   ├── (drawer)/            # Real app navigation — drawer-based, this is what users see
    │   │   ├── _layout.tsx      # Drawer chrome: nav items, parent-mode lock/unlock, edit-mode toggle, startup scan trigger
    │   │   ├── index.tsx        # Home — MediaBrowserScreen with mediaFilter="all"
    │   │   ├── tv.tsx           # MediaBrowserScreen with mediaFilter="tv"
    │   │   ├── movies.tsx       # MediaBrowserScreen with mediaFilter="movie"
    │   │   ├── audiobooks.tsx   # MediaBrowserScreen with mediaFilter="audiobook"
    │   │   ├── settings.tsx     # Media sources, API keys, view options, import/export, parent-mode password
    │   │   └── logs.tsx         # Debug log viewer (reads Logger's in-memory/on-disk log)
    │   ├── (tabs)/ , index.tsx, explore.tsx   # Stock Expo template tab demo — NOT part of the real navigation flow (see §10)
    │   └── +html.tsx, +not-found.tsx          # Expo Router web/404 conventions
    │
    ├── components/
    │   ├── MediaBrowserScreen.tsx   # THE core browsing UI: folder/grid navigation, FlashList rendering, thumbnails
    │   ├── ui/                      # PosterBox, ListItem, MediaItem, DirectoryLink, FileLink, AddMediaSource
    │   ├── ThemedText.tsx, ThemedView.tsx, ThemedTextInput.tsx  # Theme-aware primitives used by real app screens
    │   ├── themed-text.tsx, themed-view.tsx, animated-icon*, app-tabs*, web-badge.tsx, hint-row.tsx
    │   │                             # ^ Newer-template kebab-case components used only by the leftover
    │   │                               (tabs)/index/explore demo screens — see §10
    │   └── navigation/TabBarIcon.tsx
    │
    ├── scripts/                     # Non-UI application logic (the "backend" of the app)
    │   ├── FileScanner.ts           # SAF directory scanning, streaming Redux dispatch, thumbnail generation
    │   ├── MetadataService.ts       # Orchestrates TMDB/TVDB/iTunes enrichment, fuzzy show dedup
    │   ├── SmbTypes.ts              # Shared types for the smb.json sidecar file format
    │   ├── ImportExportService.ts   # JSON state backup/restore + filesystem (smb.json) metadata export
    │   ├── Logger.ts                # In-memory + on-disk logger, singleton, used everywhere via `logger`
    │   ├── openMedia.ts             # Hands a media file off to an external player via Android intent
    │   └── providers/
    │       ├── IMetadataProvider.ts # Common interface all providers implement
    │       ├── TmdbProvider.ts      # TMDB REST client
    │       ├── TvdbProvider.ts      # TheTVDB v4 REST client (JWT auth + PIN support)
    │       └── AudiobookProvider.ts # iTunes Search API client (no key required)
    │
    ├── store/                       # Redux Toolkit slices
    │   ├── store.ts                 # configureStore, redux-persist config, transient-state transform
    │   ├── libraryReducer.ts        # Scanned library: shows/seasons/episodes, movies, audiobooks, overrides, scan progress
    │   └── settingsReducer.ts       # User settings: media sources, API keys, view options, parent-mode password
    │
    ├── contexts/EditModeContext.tsx # React context: edit-mode on/off, drawer lock state, multi-select for edit mode
    ├── constants/                   # Colors.ts, theme.ts (spacing/typography tokens), StorageKeys.ts (AsyncStorage keys)
    ├── hooks/                       # useColorScheme, useThemeColor, useTheme, useRedux (typed dispatch/selector hooks)
    ├── utils/viewScale.ts           # Maps the user's view-scale setting to a grid column count
    └── types/                       # Ambient type declarations (require.context, *.css modules)
```

## 4. Application Bootstrap & Navigation

Entry point: `index.js` → `expo-router/entry` (configured via `"main"` in
`package.json` and `expo-router.root = "src"` in `app.json`), which mounts
`src/app/_layout.tsx` as the router root.

`RootLayout` (`_layout.tsx`):
1. Wraps the app in the Redux `<Provider store={store}>`.
2. `AppRoot` waits for fonts to load, installs a global `ErrorUtils` handler
   that forwards uncaught exceptions to `logger.error` (important because
   standalone builds have no Metro console), and resolves the effective
   color scheme (`system` | `light` | `dark` from settings).
3. Once fonts are ready, it awaits `redux-persist` rehydration
   (`persistor.getState().bootstrapped`), then checks the
   `firstTimeSetup` AsyncStorage key (`StorageKeys.FIRST_TIME_SETUP_KEY`).
   - Not set / not `"false"` → `router.replace('/firsttime')`.
   - Otherwise → redirect to the user's configured `defaultPage`
     (`(drawer)`, `(drawer)/tv`, `(drawer)/movies`, or `(drawer)/audiobooks`).
4. Renders a `Stack` with screens: `firsttime`, `(drawer)`, `+not-found`,
   `modal` (presentation: modal), `edititem` (presentation: modal),
   `mergeshows` (presentation: modal).

**Real navigation lives entirely under `(drawer)`.** `(drawer)/_layout.tsx`
renders a custom drawer (`CustomDrawerContent`) with Home/TV/Movies/
Audiobooks always visible, plus Settings/Debug Logs/Edit Mode/Lock behind a
password-gated "parent mode" unlock (see §9). It also fires the startup
library scan (`FileScanner.scanAllSources`) on mount, once, if
`rescanOnStartup` is enabled and at least one media source is configured.

Screens are thin: `(drawer)/index.tsx`, `tv.tsx`, `movies.tsx`,
`audiobooks.tsx` all render `<MediaBrowserScreen mediaFilter="..." />` — the
one large shared component that implements folder/grid navigation, list
rendering, and playback launch.

## 5. State Management

Redux Toolkit with two slices, combined in `store/store.ts`:

- **`settingsReducer`** — user configuration: `mediaSources` (array of SAF
  folder URIs with a `contentType` of `tv`/`movie`/`audiobook` and an
  optional per-source `metadataSource`), global `dataSource` (`tmdb`|`tvdb`),
  `viewType`, `viewScale`, `viewOrientation`, API keys/PIN, `defaultPage`,
  feature toggles (`enablePosterFetching`, `enableThumbnailGeneration`,
  `rescanOnStartup`, `fetchEpisodeNames`, `fetchEpisodeThumbnails`),
  `appColorScheme`, and `settingsPassword` (parent-mode lock).
- **`libraryReducer`** — everything produced by scanning/enrichment:
  `mediaLibrary` (shows → seasons → episodes), `movies`, `audiobooks`,
  `mediaOverrides` (user edits, keyed by namespaced string — see §7),
  `isScanning` / `scanProgress` (transient), and the raw `scanList`.

Persistence (`store/store.ts`): `redux-persist` backed by
`@react-native-async-storage/async-storage`, whitelisting both slices via
`autoMergeLevel1`. A custom `createTransform` (`scanStateTransform`) strips
`isScanning`/`scanProgress` before writing to storage and always resets them
to their initial values on rehydrate — this exists because a slice's own
REHYDRATE handler can't win against redux-persist's post-merge write, so a
transform is the only reliable place to keep transient scan state from
"getting stuck" as `true` after an app restart mid-scan.

Components read state via `react-redux`'s `useSelector`/`useDispatch` (typed
wrappers in `hooks/useRedux.ts`) and the named selectors exported from each
slice (e.g. `selectMediaLibrary`, `selectMediaSources`). `FileScanner` and
`MetadataService` dispatch directly against the singleton `store` import
rather than going through React, since they run outside the component tree.

## 6. Core Data Model

Defined across `store/libraryReducer.ts`, `store/settingsReducer.ts`, and
`scripts/FileScanner.ts` (`IMediaObject`):

- **`IMediaShow`** — a TV show: provider `ids` (`tvdb`/`imdb`/`tmdb`),
  `title`, `year`, `poster` (local file URI), `seasons` (keyed `s01`, `s02`,
  …), `rawNames` (raw folder names merged into this canonical entry — see
  fuzzy matching in §7), and an optional per-show `metadataSource`.
- **`IMediaSeason`** — provider ids, `seasonNumber`, `episodes` (keyed `e01`,
  `e02`, …, values are `IMediaObject`).
- **`IMediaObject`** (`FileScanner.ts`) — the unit for both episodes and
  movies: provider `ids`, `title`/`scannedTitle`/`resolvedTitle` (locally
  parsed vs. provider-resolved display name — UI prefers `resolvedTitle`
  when set), `resolvedThumbnail`, SAF `path` + human-readable `parsedPath`,
  `poster`, and an optional per-item `metadataSource`.
- **`IMediaAudiobook`** — `ids.itunes`, `title`/`scannedTitle`, `author`,
  `folderKey` (stable grouping key derived from the relative folder path),
  `path` (first part), `files: IAudiobookFile[]` (all parts, naturally
  sorted), `poster`.
- **`sourceUri` / `unavailable`** — `IMediaShow`, `IMediaObject`, and
  `IMediaAudiobook` all carry an optional `sourceUri` (the `IMediaSource.uri`
  they were scanned from) and an optional `unavailable` flag. When a
  source's root folder can't be read during a scan (e.g. its storage device
  is disconnected), `scanAllSources` carries the item forward from the
  previous scan with `unavailable: true` instead of dropping it — metadata
  survives, but `MediaBrowserScreen` excludes flagged items from what it
  renders (see §7 step 5). The flag clears itself the next time that
  source scans successfully, since the item is then rebuilt fresh.
- **`IMediaOverride`** — user edits layered on top of scanned/provider data:
  `title`, `sortTitle`, `tmdbId`/`tvdbId`, `year`, `poster`, `hidden`,
  `metadataSourceOverride`. Stored in `mediaOverrides` keyed by a namespaced
  string: `show:<showName>`, `movie:<parsedPath>`, `episode:<parsedPath>`,
  or `audiobook:<folderKey>`. Overrides are **additive and non-destructive**
  — clearing one restores the underlying scanned/provider value; nothing is
  deleted from the scan result itself.

Provider/data-source resolution follows a strict override chain, applied
consistently in `MetadataService` and the UI: **per-item override →
per-source-folder `metadataSource` → global `settings.dataSource`.**

## 7. Media Scanning Pipeline (`FileScanner.ts`)

`FileScanner` is a singleton (`FileScanner.getInstance()`) driven by
`scanAllSources(sources: IMediaSource[])`. High-level flow:

1. **Collection** — for each configured source folder, `collectAllMediaFiles`
   recurses the SAF tree (`recursiveCollect`) up to `MAX_SCAN_DEPTH` (8). It
   fans subdirectories out **in parallel**, bounded by a `Semaphore`
   (`MAX_CONCURRENT_DIR_READS = 8`) so slower storage (USB OTG, network
   shares) isn't overwhelmed. Files are classified purely by extension
   (`VIDEO_EXTENSIONS`, `AUDIO_EXTENSIONS`, `NON_DIRECTORY_EXTENSIONS`) since
   SAF entry metadata is unreliable.
2. **Streaming dispatch** — discovered episodes/movies are buffered
   (`StreamState.episodeBatch` / `movieBatch`) and flushed to Redux
   (`mergeEpisodeBatch`, `appendMovieBatch`) every
   `PROGRESS_DISPATCH_INTERVAL` (10) files, so the UI populates
   progressively during a large scan rather than waiting for it to finish.
   Audiobooks are the exception — they're grouped by folder and dispatched
   once, after collection, via `buildAudiobookList`.
3. **Sidecar detection** — while walking, the scanner also recognizes:
   - **Poster images** (`folder.jpg`, `poster.jpg`, `cover.jpg`, `show.jpg`,
     `movie.jpg` and `.jpeg` variants) — copied into the app's persistent
     `smb_posters/` document directory (`copyLocalPoster`) so they survive
     without holding the original SAF permission open.
   - **`smb.json`** — a per-folder sidecar (see §9) written by
     `ImportExportService`'s filesystem export, parsed back on the next scan
     to restore titles/years/provider ids/overrides/episode metadata without
     re-hitting the network.
   - **`smb_thumb_s01e01.jpg`**-style files (matched via `SMB_THUMB_REGEX`
     from `SmbTypes.ts`) — previously-exported episode thumbnails, copied
     into `smb_thumbnails_fs/`.
4. **Name normalization & fuzzy merge keys** — `normalizeShowName` strips a
   trailing year suffix (`"Bluey (2018)"` → `"Bluey"`, year `2018`);
   `fuzzyKey` further lower-cases, expands `&` → `and`, and strips
   punctuation so that e.g. `"Grey's Anatomy"` and `"Greys Anatomy"` collapse
   to the same library entry. `MetadataService.deduplicateByFuzzyName`
   performs the actual merge pass before enrichment.
5. **State carry-over across rescans** — after building the fresh
   library/movie/audiobook lists, the scanner reads the *previous* Redux
   state and copies forward provider ids, posters (only if the file still
   exists on disk and the new scan didn't find a fresher local poster), and
   episode-level `resolvedTitle`/`resolvedThumbnail`. This is what keeps
   posters from "flashing empty" on every rescan while enrichment re-runs.
   Separately, if a source's root directory itself couldn't be read this
   scan (`rootAccessible` false in `collectAllMediaFiles` — e.g. a
   disconnected USB/SD device), any previously-scanned show/movie/audiobook
   whose `sourceUri` matches that source (or, for older items scanned before
   `sourceUri` existed, when *every* source of that content type failed) is
   re-inserted into the fresh library/movie/audiobook list with
   `unavailable: true` rather than being silently dropped by the `setMedia*`
   dispatches below. This is what fixes the "app forgets everything scanned
   from a disconnected drive" failure mode — data is hidden, not deleted.
6. **Metadata enrichment** — if poster fetching is enabled and either a
   provider API key is configured or any audiobooks were found, awaits
   `MetadataService.getInstance().enrichAll(...)` before continuing (kept
   synchronous with `isScanning` so scan progress UI stays accurate for the
   whole operation).
7. **Thumbnail generation** — if enabled, generates video-frame thumbnails
   (`expo-video`'s `generateThumbnailsAsync` + `expo-image-manipulator`) for
   every file not already in `thumbnailCache`, bounded by a second semaphore
   (`MAX_CONCURRENT_THUMBNAILS = 3`, CPU-bound so kept low). Successful
   thumbnails are persisted to `smb_thumbnails/` and indexed in
   `smb_thumbnails/index.json` so they survive app restarts; failures fall
   back to an in-session-only in-memory `VideoThumbnail`.
8. Scanning is cooperatively cancellable via `cancelScan()`, checked at
   numerous points (`_cancelRequested`); partial Redux state from a
   cancelled scan is left in place rather than rolled back.

`scanProgress` (in `libraryReducer`) tracks a `phase` (`collecting` |
`enriching` | `thumbnails`) plus counts, driving the progress UI in
`MediaBrowserScreen`.

## 8. Metadata Enrichment (`MetadataService.ts` + providers)

`MetadataService` is a singleton orchestrating enrichment across TV shows,
movies, and audiobooks concurrently (`Promise.allSettled`). It:

- Instantiates providers only if their API key is configured
  (`TmdbProvider`, `TvdbProvider` — TVDB additionally requires a short-lived
  JWT obtained via `authenticate()` before any other call).
- Resolves the effective provider per item using the override chain from
  §6 (`resolveShowProvider` / `resolveMovieProvider` closures).
- Runs fuzzy show deduplication (§7) before enriching, so duplicate network
  requests aren't made for shows that are about to be merged.
- Uses `AudiobookProvider` (iTunes Search API — no key needed) for
  audiobook cover art/author lookup whenever audiobooks exist and poster
  fetching is enabled, independent of whether a TMDB/TVDB key is set.
- Dispatches throttled `scanProgress` updates (`metadataDone`/`metadataTotal`,
  every `METADATA_PROGRESS_INTERVAL = 5` items and always on the last one).

All providers implement `IMetadataProvider` (`providers/IMetadataProvider.ts`)
— `searchShow`, `searchMovie`, `downloadShowPoster`, `downloadMoviePoster`,
`fetchSeasonEpisodes`, `downloadEpisodeThumbnail` — so `MetadataService` and
the edit-item rematch flow are written once against a provider-agnostic
interface. **Adding a new metadata provider means implementing this
interface and wiring it into the two `resolve*Provider` closures and the
`dataSources` union type** (`settingsReducer.ts`).

## 9. Sidecar Metadata Format & Import/Export (`SmbTypes.ts`, `ImportExportService.ts`)

`smb.json` is a versioned (`smbVersion: 1`) JSON sidecar file
(`SmbJsonShowData` | `SmbJsonMovieData`) that `ImportExportService` can write
into each show/movie folder on the user's storage (`exportToFilesystem`).
It captures canonical title/year, provider ids, the active
`metadataSource`, user `overrides`, and (for shows) per-season/episode
titles and thumbnail filenames. `FileScanner` reads it back in during the
next scan (§7, step 3) so a fresh install — or a folder copied to another
device — can restore matched metadata **without hitting TMDB/TVDB again**.
Episode thumbnails are exported as `smb_thumb_<season><episode>.jpg`
(`smbThumbFilename()`), with a shared regex (`SMB_THUMB_REGEX`) used by both
the writer and the reader so the two stay in sync — this is why the naming
helpers live in the standalone `SmbTypes.ts` module rather than in
`FileScanner.ts` or `ImportExportService.ts` directly (avoids a circular
import between the two).

`ImportExportService` also provides an independent **JSON state
backup/restore** pair (`exportJson`/`importJson`, via
`expo-document-picker`) that serializes settings + overrides + matched
metadata to a single file the user can save/share — this is a full app-state
snapshot, separate from the filesystem `smb.json` export.

## 10. Edit Mode, Overrides & Parent Lock

`EditModeContext` (`contexts/EditModeContext.tsx`) is a plain React context
(not Redux, since it's ephemeral UI state) tracking: `editMode` on/off,
`drawerUnlocked` (parent-mode gate), and `selectedItems` (a `Set` of
namespaced override keys for multi-select bulk actions).

The drawer (`(drawer)/_layout.tsx`) gates Settings, Debug Logs, and the
Edit Mode toggle behind `drawerUnlocked`, which requires the
`settingsPassword` (if set in settings) to unlock. This "parent mode" lets a
primary user restrict a shared/kid device to just browsing and playing
media. `edititem.tsx` (opened from `MediaBrowserScreen` while in edit mode)
lets the user override title/poster/provider match for a single item or
rematch it against a provider; `mergeshows.tsx` handles the case where two
distinct show folders should be one library entry but weren't auto-merged
by the fuzzy-key pass.

## 11. Logging & Diagnostics (`Logger.ts`)

`logger` (singleton, `Logger.getInstance()` under the hood) is a
lightweight in-memory (capped at `MAX_MEMORY_LINES = 600`) plus on-disk
(`smb_debug.log`, rotated past `MAX_FILE_BYTES = 2 MB`) logger. It exists
because standalone EAS/production builds have no attached Metro console —
`logger.log/warn/error(tag, message, ...)` calls throughout `scripts/` and
navigation code are the only way to debug a release build in the field.
The in-app **Debug Logs** screen (`(drawer)/logs.tsx`) surfaces this log for
on-device inspection/sharing without `adb`.

## 12. Theming

`constants/Colors.ts` and `constants/theme.ts` define the light/dark palette
and spacing/typography tokens. `hooks/useColorScheme(.web).ts` resolves the
native OS scheme; `AppRoot` in `_layout.tsx` overrides it with the user's
`appColorScheme` setting when not `"system"`. `ThemedText`/`ThemedView`/
`ThemedTextInput` are the theme-aware primitives used throughout the real
app screens.

## 13. Playback Handoff (`openMedia.ts`)

The app never plays media in-process. `openMediaInExternalApp` resolves a
MIME type from the file extension and, on Android, fires an
`ACTION_VIEW` intent (`expo-intent-launcher`) at the SAF `content://` URI
with `FLAG_GRANT_READ_URI_PERMISSION` so external players (VLC, MX Player,
etc.) can read it; iOS falls back to `Linking.openURL`.

## 14. Build, CI & Tooling

- **Local dev**: `npm install`, `npx expo start` (Metro), run in a
  [development build](https://docs.expo.dev/develop/development-builds/introduction/)
  or Android emulator.
- **Release APK**: `npx expo prebuild && cd android && ./gradlew assembleRelease`
  (see README for the full Windows setup and `build.ps1`).
- **CI** (`.github/workflows/`):
  - `pre-build-test.yaml` — on PRs into `main`: `npx tsc --noEmit`,
    `npm run lint` (`expo lint` / `eslint-config-expo` flat config), and
    `npx jest --ci --watchAll=false --passWithNoTests` (no test suite exists
    yet — this passes vacuously; see AGENTS.md).
  - `build-apk.yml`, `eas-build.yaml` — produce release/EAS builds.
- **TypeScript**: `strict: true`, path alias `@/*` → `src/*`,
  `@/assets/*` → `assets/*` (`tsconfig.json`).
- **Lint**: `eslint-config-expo` flat config (`eslint.config.js`).

## 15. Known Quirks / Template Leftovers

Worth knowing before you go hunting for "why is there a duplicate of X":

- `src/app/index.tsx`, `src/app/explore.tsx`, `src/app/(tabs)/**`, and
  `src/app/modal.tsx`, along with the kebab-case components
  (`themed-text.tsx`, `themed-view.tsx`, `animated-icon*`, `app-tabs*`,
  `web-badge.tsx`, `hint-row.tsx`) are **stock Expo Router template
  scaffolding** left over from `create-expo-app`/template upgrades. The
  real app's root `Stack` in `_layout.tsx` never routes to `(tabs)` or the
  top-level `index`/`explore`, and always redirects into `(drawer)` (or
  `firsttime`). `modal.tsx` is still wired as a Stack screen but is the
  default template's "About" modal, not app-specific UI.
- Two component naming conventions coexist side-by-side:
  **PascalCase** (`ThemedText.tsx`, `ThemedView.tsx`, `Collapsible.tsx`,
  `ExternalLink.tsx`, `HelloWave.tsx`) is what the real `(drawer)` screens
  and `MediaBrowserScreen` actually import; **kebab-case** duplicates are
  used only by the unused template screens above. When editing themed
  primitives, double-check which file the screen you're touching actually
  imports.
- `App.tsx` at the repo root is an unused legacy RN entry point; the real
  entry is `expo-router/entry` per `package.json`'s `"main"` field.
- There is currently no test suite (`jest --passWithNoTests` passes
  vacuously in CI). If you add meaningful logic (especially in
  `scripts/FileScanner.ts`'s parsing/normalization helpers or
  `scripts/providers/`), consider adding Jest coverage — `jest-expo` is
  already configured as the preset.
