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
| State | Redux Toolkit; settings via redux-persist (AsyncStorage), library via SQLite (`LibraryStore`) |
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
├── app.json                     # Expo app config (name, package id, plugins, expo-router root="src/app")
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
    │   ├── _layout.tsx          # Root layout: Redux Provider, theme, first-time-setup redirect, Stack screens; imports store/wireServices
    │   ├── firsttime.tsx        # First-run onboarding (add a media source, pick defaults)
    │   ├── edititem.tsx         # Modal: edit/override title, poster, provider match for a show/movie/episode
    │   ├── mergeshows.tsx       # Modal: merge two show entries that scanning didn't auto-merge
    │   ├── modal.tsx            # Stock Expo template "About" modal (leftover, see §10)
    │   ├── (drawer)/            # Real app navigation — drawer-based, this is what users see
    │   │   ├── _layout.tsx      # Drawer chrome: nav items, parent-mode lock/unlock, edit-mode toggle, startup scan trigger
    │   │   ├── (home)/          # Home section (URL "/") — MediaBrowserScreen with mediaFilter="all"
    │   │   │   ├── _layout.tsx  #   <MediaSectionStack /> — the section's native stack
    │   │   │   ├── index.tsx    #   Section root
    │   │   │   └── folder.tsx   #   One folder level (show / season / multi-part audiobook), pushed per level
    │   │   ├── tv/, movies/, audiobooks/   # Same three files, mediaFilter="tv" / "movies" / "audiobooks"
    │   │   ├── settings.tsx     # Media sources, API keys, view options, import/export, parent-mode password
    │   │   └── logs.tsx         # Debug log viewer (reads Logger's in-memory/on-disk log)
    │   ├── (tabs)/ , index.tsx, explore.tsx   # Stock Expo template tab demo — NOT part of the real navigation flow (see §10)
    │   └── +html.tsx, +not-found.tsx          # Expo Router web/404 conventions
    │
    ├── components/
    │   ├── MediaBrowserScreen.tsx   # THE core browsing UI: one folder level's grid/list, FlashList rendering, thumbnails
    │   ├── MediaSectionStack.tsx    # Shared native-stack layout for the four media sections
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
    │   ├── libraryUtils.ts          # Pure, dependency-free helpers + shared types (IMediaObject, normalizeShowName, fuzzyKey, buildTmdbSearchQuery, filename/path parsers, extension checks)
    │   ├── librarySink.ts           # LibrarySink interface ({ dispatch, getState }) + setLibrarySink(); how scanner/enrichment reach Redux without importing the store
    │   ├── scanProgressDispatcher.ts # Shared throttled scan-progress dispatcher (built on throttledDispatch.ts, dispatches through the sink)
    │   ├── SmbTypes.ts              # Shared types for the smb.json sidecar file format
    │   ├── ImportExportService.ts   # JSON state backup/restore + filesystem (smb.json) metadata export
    │   ├── LibraryStore.ts          # SQLite-backed library persistence (one row per show), incremental autosave
    │   ├── Logger.ts                # In-memory + on-disk logger, singleton, used everywhere via `logger`
    │   ├── openMedia.ts             # Hands a media file off to an external player via Android intent
    │   └── providers/
    │       ├── IMetadataProvider.ts # Common interface all providers implement
    │       ├── TmdbProvider.ts      # TMDB REST client
    │       ├── TvdbProvider.ts      # TheTVDB v4 REST client (JWT auth + PIN support)
    │       └── AudiobookProvider.ts # iTunes Search API client (no key required)
    │
    ├── store/                       # Redux Toolkit slices
    │   ├── store.ts                 # configureStore + redux-persist wiring (settings only); import-time side effects live here
    │   ├── wireServices.ts          # Side-effect module: setLibrarySink(store); imported once by the root layout
    │   ├── persistGuards.ts         # Pure, unit-testable guards used by store.ts: legacy-library capture, write gate, rehydrate-error guard
    │   ├── libraryPersistence.ts    # Startup: load/migrate the library from the SQLite store, hydrate Redux, start autosave (deps injectable)
    │   ├── rehydrateRecovery.ts     # Failure counter, "offer recovery" decision and Start fresh for an unreadable persist:root (#228)
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
`package.json` and `expo-router` `root = "src/app"` in `app.json`), which mounts
`src/app/_layout.tsx` as the router root. The plugin `root` must point at
the folder that directly holds `_layout.tsx` (`src/app`), not at `src`: Expo
turns it into `extra.router.root`, which both the dev server and
`export:embed` (release/EAS bundles) feed into `EXPO_ROUTER_APP_ROOT`. With
`"src"` the whole of `src/` becomes the route tree (`./app/+html.tsx`,
`./components/*`, ... all counted as routes) and expo-router throws
`Invalid route ./app/+html.tsx` when it builds it.

`RootLayout` (`_layout.tsx`):
1. Wraps the app in the Redux `<Provider store={store}>`.
2. `AppRoot` waits for fonts to load, installs a global `ErrorUtils` handler
   that forwards uncaught exceptions to `logger.error` (important because
   standalone builds have no Metro console), and resolves the effective
   color scheme (`system` | `light` | `dark` from settings).
3. Once fonts are ready, it awaits `redux-persist` rehydration
   (`waitForPersistBootstrap()`), then awaits `startLibraryPersistence()` (§5)
   so the library is in Redux before routing, then checks the
   `firstTimeSetup` AsyncStorage key (`StorageKeys.FIRST_TIME_SETUP_KEY`).
   - Not set / not `"false"` → `router.replace('/firsttime')`.
   - Otherwise → redirect to the user's configured `defaultPage`
     (`(drawer)/(home)`, `(drawer)/tv`, `(drawer)/movies`, or `(drawer)/audiobooks`).
4. Renders a `Stack` with screens: `firsttime`, `(drawer)`, `+not-found`,
   `modal` (presentation: modal), `edititem` (presentation: modal),
   `mergeshows` (presentation: modal).

**Real navigation lives entirely under `(drawer)`.** `(drawer)/_layout.tsx`
renders a custom drawer (`CustomDrawerContent`) with Home/TV/Movies/
Audiobooks always visible, plus Settings/Debug Logs/Edit Mode/Lock behind a
password-gated "parent mode" unlock (see §9). It also fires the startup
library scan (`FileScanner.scanAllSources`) on mount, once, if
`rescanOnStartup` is enabled and at least one media source is configured.

Each media section (`(home)`, `tv`, `movies`, `audiobooks`) is a nested native
stack (`MediaSectionStack`). Its `index.tsx` is the section root and every
folder the user opens (a show, a season, a multi-part audiobook) is pushed as
its own `folder.tsx` screen, with the level passed as route params
(`label`, `title`, `showName`, `seasonKey`, `audiobookKey` — read by
`hooks/useBrowseLocation.ts`). Because the levels above stay mounted
underneath, their scroll positions survive navigating back without any
save/restore logic, and the stack handles the header back arrow and Android
hardware back. The drawer sets `popToTopOnBlur` on the sections so leaving one
resets it to its root, and its custom item list also pops the current
section to its root when tapped — that entry shows a back arrow while the
section is deeper than its root.

Screens are thin: every section's `index.tsx` and `folder.tsx` render
`<MediaBrowserScreen mediaFilter="..." location={...} />` — the
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
  and `isScanning` / `scanProgress` (transient).

Persistence is split in two so a large library can't take the settings down
with it (issue #222: on Android AsyncStorage reads an entry through a ~2 MB
CursorWindow, so one `persist:root` blob holding the whole library broke past
roughly 2,000 episodes):

- **Settings** (`store/store.ts`): `redux-persist` over
  `@react-native-async-storage/async-storage`, key `persist:root`,
  `whitelist: ['settingsReducer']`. Writes are throttled (`throttle: 1000`)
  and `store.ts` calls `persistor.flush()` when the app goes to
  `background`/`inactive`, so a pending change (e.g. a `lastOpened` stamp
  before handing off to an external player) is not lost.
- **Library** (`scripts/LibraryStore.ts`, driven by `store/libraryPersistence.ts`):
  a SQLite database (`library.db`, expo-sqlite, WAL) with three tables —
  `meta` (the `version` row marks the store as initialised), `shows` (one
  JSON row per show, keyed by show name) and `kv` (one JSON row each for
  `movies`, `audiobooks`, `mediaOverrides`, `thumbnails`). Redux still holds
  the whole library in memory (same slice, reducers and selectors);
  `LibraryStore` autosaves incrementally (only shows whose object reference
  changed, throttled, flushed when the app backgrounds). Every save, and the
  initial full write that also sets the version marker, is one transaction,
  so a failure leaves the previous state intact and the unsaved diff is
  retried on the next save. expo-sqlite reads rows through its own bundled
  sqlite3, not Android's CursorWindow, so there is no ~2 MB per-row limit.
  Transient `isScanning`/`scanProgress` are never persisted. The
  `hydrateLibrary` reducer loads it into the slice.

Startup (`startLibraryPersistence()`, memoised, never rejects), after
redux-persist has bootstrapped:

1. Store exists → `hydrateLibrary`, start autosave, allow settings writes.
   Any `libraryReducer` still in `persist:root` is stale and discarded.
2. No store yet (fresh install or first launch after upgrading) → take the
   legacy `libraryReducer` blob, write it to the SQLite store (empty if none),
   hydrate, start autosave, allow settings writes. This is the one-time
   migration. If the write fails, Redux is still hydrated for the session
   but autosave and settings writes stay off, so the library remains in
   `persist:root` and the migration is retried next launch.
3. Store exists but can't be read (corruption / newer version) → alert, no
   hydrate and no autosave, so nothing is overwritten; settings writes are
   allowed (the migration already happened earlier).

Two guards, built in `store/persistGuards.ts` (pure and side-effect free, so
they are unit-tested directly) and wired up in `store.ts`, make this safe:

- **Legacy capture.** redux-persist's `autoMergeLevel1` merges every inbound
  key whatever the `whitelist`, so a custom `stateReconciler` strips
  `libraryReducer` from the inbound blob, stashes it for the migration
  (`createLegacyLibraryCapture()` → `takeLegacyPersistedLibrary()`) and delegates the rest to `autoMergeLevel1`.
- **Write gate.** After the first `REHYDRATE`, redux-persist writes the
  whitelisted keys as the *whole* new `persist:root` value, which is what
  drops the legacy library from it. `persistConfig.storage` is therefore a
  wrapper (`createWriteGate`) whose `setItem` waits for `allowPersistWrites()`
  (called only once the library is safely in the SQLite store). If `REHYDRATE`
  carries an `err` (read failure, or redux-persist's 5 s timeout) a middleware
  (`createRehydrateErrorGuard`) blocks settings
  writes for the rest of the session, since state is then defaults and the
  next write would overwrite the stored settings. An existing library store
  still loads and autosaves then, but the migration is skipped, since the
  unreadable `persist:root` may hold the only copy of the legacy library.

**Unreadable `persist:root` recovery** (`store/rehydrateRecovery.ts`, driven from
`runLibraryPersistence`; issue #228). The guards above are the right default for
a one-off read failure but a dead end when the entry can never be read (e.g. a
pre-#227 library blob past the ~2 MB CursorWindow limit: "Row too big to fit
into CursorWindow"). So each failed settings rehydrate is counted in its own
small AsyncStorage entry (`StorageKeys.REHYDRATE_FAILURE_KEY`, kept apart from
`persist:root` so it stays readable) together with the error message, and a
successful rehydrate clears it. `shouldOfferRecovery()` (pure) returns true at
>= 2 consecutive failed launches or when the message matches
`/CursorWindow|Row too big/i`. Then, instead of the plain "Could not load your
settings" notice, startup shows a **Start fresh** / **Keep trying** prompt (the
splash stays up until answered; dismissing counts as Keep trying):

- **Keep trying** — today's behaviour: writes stay blocked, nothing is removed,
  the migration is skipped, and the prompt returns next launch.
- **Start fresh** (`performStartFresh`), in this order: remove `persist:root`
  (if that fails, stop: writes stay blocked and an alert is shown); remove the
  first-time-setup flag so first-time setup shows as on a fresh install;
  re-arm the write gate (`gate.unblock()` — blocked state cleared, but writes
  are *held again* until `allow()`); clear the failure record. Then the normal
  fresh-install branch runs: an empty library store is written (or an existing
  one is loaded and kept), the library is hydrated, autosave starts, and
  `allowWrites()` releases the held settings writes. Nothing can write defaults
  over the old entry before the choice, and no settings write precedes the
  library store being initialised. No app reload is needed (and `expo-updates`
  is not a dependency).

A single transient failure (count 1, no size error) only shows the plain notice
and never removes or overwrites anything. Every decision is logged through
`logger` (tag `LibraryPersistence` / `RehydrateRecovery`). Salvaging the old
data by reading the raw RKStorage SQLite row in chunks is not implemented.

`libraryPersistence.ts` keeps its startup logic in `runLibraryPersistence(deps)`,
which takes the store, `LibraryStore`, gate functions and `Alert` as plain
dependencies; `startLibraryPersistence()` builds the real ones lazily (so
importing the module never creates the store) and is what `_layout.tsx` calls.

Components read state via `react-redux`'s `useSelector`/`useDispatch` (typed
wrappers in `hooks/useRedux.ts`) and the named selectors exported from each
slice (e.g. `selectMediaLibrary`, `selectMediaSources`). `FileScanner`,
`MetadataService` and `scanProgressDispatcher` run outside the component tree
and do **not** import the `store` singleton. They dispatch and read state
through `librarySink` (`scripts/librarySink.ts`), a thin forwarder over a
narrow `LibrarySink` interface (`dispatch(action)` / `getState()` limited to
the `libraryReducer` and `settingsReducer` slices). `store/wireServices.ts`
calls `setLibrarySink(store)` once, and is imported for its side effect by the
root `_layout.tsx`. Every `librarySink.getState()` forwards to the real
`getState()` at the call site (nothing is cached), and using it before it is
wired throws a clear error. Tests call `setLibrarySink(fake)` (or `null` to
reset) instead of mocking the store module.

## 6. Core Data Model

Defined across `store/libraryReducer.ts`, `store/settingsReducer.ts`, and
`scripts/libraryUtils.ts` (`IMediaObject`):

- **`IMediaShow`** — a TV show: provider `ids` (`tvdb`/`imdb`/`tmdb`),
  `title`, `year`, `poster` (local file URI), `seasons` (keyed `s01`, `s02`,
  …), `rawNames` (raw folder names merged into this canonical entry — see
  fuzzy matching in §7), and an optional per-show `metadataSource`.
- **`IMediaSeason`** — provider ids, `seasonNumber`, `episodes` (keyed `e01`,
  `e02`, …, values are `IMediaObject`).
- **`IMediaObject`** (`libraryUtils.ts`) — the unit for both episodes and
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
`scanAllSources(sources: IMediaSource[])`. It reaches Redux only through the
injected `librarySink` (§5). High-level flow:

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
4. **Name normalization & fuzzy merge keys** — these pure helpers live in
   `scripts/libraryUtils.ts` (a module with no runtime imports, shared by
   FileScanner, MetadataService, the providers and the UI, which is what keeps
   them free of require cycles; it also holds `isMediaFile`, `parseFilename`,
   `parseFromPath`, the extension sets and `buildTmdbSearchQuery`).
   `normalizeShowName` strips a bracketed trailing year (`"Bluey (2018)"` →
   `"Bluey"`, year `2018`, the Plex/Jellyfin/Kodi convention); a bare number
   is kept as part of the title (`"Wonder Woman 1984"`, a show named
   `"1923"`). The one exception is release-style filenames, where
   `parseFilename` also treats a bare year right before the episode tag as the
   release year (`"Bluey.2018.S01E05.mkv"` → `"Bluey"`, 2018).
   `fuzzyKey` further lower-cases, expands `&` → `and`, turns hyphens into
   spaces, and strips punctuation (including typographic apostrophes) so that
   e.g. `"Grey's Anatomy"`, `"Grey’s Anatomy"` and `"Greys Anatomy"` collapse
   to the same library entry. `MetadataService.deduplicateByFuzzyName`
   performs the actual merge pass before enrichment.
   Episodes are keyed `eNN` within a season. When several files in one season
   have no recognisable episode number, the first keeps `e00` and the rest get
   `e00-<filename hash>` (`unnumberedEpisodeKey`), so none are dropped.
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
`MediaBrowserScreen`. `FileScanner` and `MetadataService` both send it through
the shared `scanProgressDispatcher` (`scripts/scanProgressDispatcher.ts`,
built on `scripts/throttledDispatch.ts`), because every update notifies all store
subscribers (including library autosave) and rebuilds the browse screens: per-item ticks go through
`.throttled` (at most one per 250 ms, with a trailing update so the final
count lands), phase starts through `.immediate` (which drops any pending tick
so it can't overwrite the new phase), phase ends call `.flush`, and each scan
entry point calls `.cancel` before `setIsScanning(false)` resets progress.

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
- Reports `scanProgress` (`metadataDone`/`metadataTotal`) after every item via
  the rate-limited `scanProgressDispatcher` (see §7), flushing at the end of
  each phase so the counter reaches 100%.

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

Selection is built up with one long press followed by plain taps: while
`selectedItems` is empty a tap navigates/opens as usual and a long press
selects the first item, after which a tap on any *selectable* item toggles it
instead. The deliberate trade-off is that a show folder cannot be entered
while a selection is active (season folders and audiobooks aren't selectable,
so they still navigate) — Cancel in the selection toolbar restores normal
tapping. The toolbar exposes Hide, Merge (2+ shows) and a **More** overflow
menu holding the bulk metadata actions: *Fetch metadata* and *Reset metadata*
(both clear the cached provider state for the selection, then re-enrich via
`MetadataService.enrichSelection`; only Reset also drops the user's own
overrides) and *Generate thumbnails* (`FileScanner.regenerateThumbnailsFor`,
which discards the cached video thumbnails first so the "already cached" skip
doesn't apply). Both bulk paths run through `FileScanner` so they report
progress on the normal scan banner and honour its Stop button, and both end by
clearing expo-image's memory cache — refreshed art reuses the same file URIs,
so the old bitmaps would otherwise stay on screen.

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
  or Android emulator. `npx expo start --web` boots the UI in a browser for
  headless smoke tests; `metro.config.js` aliases `expo-file-system` to
  `src/shims/expo-file-system.web.ts` (web platform only) because the real
  module's `File`/`Directory` constructors throw on web. Nothing persists on
  web and library scanning does not work there.
- **Typed routes**: `experiments.typedRoutes` generates `.expo/types/router.d.ts`
  (gitignored), normally only written by `expo start`. `npm run typegen`
  (`expo customize tsconfig.json`) writes it headlessly in ~2s with no network,
  so run it before `npx tsc --noEmit` to type-check `href`/`router.push` targets.
- **Release APK**: `npx expo prebuild && cd android && ./gradlew assembleRelease`
  (see README for the full Windows setup and `build.ps1`).
- **CI** (`.github/workflows/`):
  - `pre-build-test.yaml` — on PRs into `main`: `npm run typegen` (typed-route
    declarations), `npx tsc --noEmit`,
    `npm run lint` (`expo lint` / `eslint-config-expo` flat config), and
    `npx jest --ci --watchAll=false --passWithNoTests` (suites live in
    `__tests__/` folders next to the code; see AGENTS.md).
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
  `HelloWave.tsx`) is what the real `(drawer)` screens
  and `MediaBrowserScreen` actually import; **kebab-case** duplicates are
  used only by the unused template screens above. When editing themed
  primitives, double-check which file the screen you're touching actually
  imports.
- `App.tsx` at the repo root is an unused legacy RN entry point; the real
  entry is `expo-router/entry` per `package.json`'s `"main"` field.
- Jest coverage lives in `__tests__/` folders next to the code
  (`jest-expo` preset). Scan/enrichment logic is testable without the real
  store: pure helpers are in `scripts/libraryUtils.ts`, and
  `FileScanner`/`MetadataService` can run against a fake via
  `setLibrarySink` (see `scripts/__tests__/MetadataService.test.ts`). Add
  coverage alongside new parsing/normalization logic or provider parsing.
