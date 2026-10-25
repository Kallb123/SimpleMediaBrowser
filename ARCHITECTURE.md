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
Framework) into a browsable media library. It scans, organizes, and enriches
metadata, then plays videos and audiobooks in the app by default (so progress
can be tracked and resumed — §13), with a hand-off to an external player app via an
Android intent as a per-type setting.
Three media types are supported:
TV shows (with seasons/episodes), movies, and audiobooks.

## 2. Tech Stack

| Layer | Technology |
|---|---|
| Framework | Expo SDK 55 / React Native 0.83, React 19 |
| Navigation | Expo Router (file-based routing) — drawer + stack |
| State | Redux Toolkit; settings via redux-persist (AsyncStorage), library via SQLite (`LibraryStore`) |
| File access | `expo-file-system` (new `File`/`Directory` API) + SAF (`expo-file-system/legacy`'s `StorageAccessFramework`) |
| Metadata | TMDB and TheTVDB REST APIs (TV/movies), iTunes Search API (audiobook cover art, keyless) |
| Video | `expo-video` (in-app video player; thumbnail generation via `expo-image-manipulator`) |
| Audio | `expo-audio` (in-app audiobook player; config plugin enables background playback) |
| List rendering | `@shopify/flash-list` |
| Language | TypeScript (`strict: true`), path alias `@/*` → `src/*` |

The app targets Android; iOS/web builds exist (Expo supports them by default)
but are not actively maintained — some legacy-template screens only really
make sense on those platforms (see §10).

## 3. Repository Layout

```
SimpleMediaBrowser/
├── App.tsx                      # Root component: <ExpoRoot> over require.context('./src/app')
├── index.js                     # Entry ("main" in package.json): registerRootComponent(App)
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
    │   ├── player.tsx           # Modal: in-app audiobook player ("Now Playing"), observes AudiobookPlayer
    │   ├── videoplayer.tsx      # Full-screen modal: in-app video player (expo-video), owns its player + VideoProgressTracker
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
    │   ├── MediaSectionStack.tsx    # Shared native-stack layout for the four media sections (+ the mini-player bar)
    │   ├── MiniPlayer.tsx           # "Now playing" bar under the browse screens; tap opens the /player modal
    │   ├── OptionSheet.tsx          # Small modal option list (player speed / sleep-timer pickers)
    │   ├── ui/                      # PosterBox, ListItem, WatchedBadge, MediaItem, DirectoryLink, FileLink, AddMediaSource
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
    │   ├── throttledDispatch.ts     # Pure leading/trailing rate limiter (scan progress, thumbnail-cache notifications)
    │   ├── batchedDispatch.ts       # Pure accumulator: queue items, send as one batch every N items / T ms (metadata enrichment)
    │   ├── thumbnailCache.ts        # Observable Map of generated video thumbnails (path → URI); subscribe/getVersion for useSyncExternalStore
    │   ├── SmbTypes.ts              # Shared types for the smb.json sidecar file format
    │   ├── ImportExportService.ts   # JSON state backup/restore + filesystem (smb.json) metadata export
    │   ├── LibraryStore.ts          # SQLite-backed library persistence (one row per show), incremental autosave
    │   ├── Logger.ts                # In-memory + on-disk logger, singleton, used everywhere via `logger`
    │   ├── openMedia.ts             # Hands a media file off to an external player via Android intent
    │   ├── AudiobookPlayer.ts       # In-app audiobook playback singleton (expo-audio): resume, part advance, progress saving
    │   ├── VideoPlayback.ts         # Holds the next VideoRequest for the /videoplayer screen (no route params)
    │   ├── VideoProgressTracker.ts  # Saves video resume points, marks a video watched at 90% / end
    │   ├── videoProgress.ts         # Pure helpers: watched threshold, resume position
    │   ├── audiobookProgress.ts     # Pure helpers: resume start point, whole-book / per-part progress fractions
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
    │   ├── libraryReducer.ts        # Scanned library: shows/seasons/episodes, movies, audiobooks, overrides (+ applyLibraryActions batch action)
    │   ├── scanReducer.ts           # Transient scan state: isScanning + scanProgress (never persisted)
    │   └── settingsReducer.ts       # User settings: media sources, API keys, view options, parent-mode password
    │
    ├── contexts/EditModeContext.tsx # React context: edit-mode on/off, drawer lock state, multi-select for edit mode
    ├── contexts/BedtimeContext.tsx  # React context: bedtime-mode state (active / lifted) and the drawer sections it locks
    ├── constants/                   # Colors.ts, theme.ts (spacing/typography tokens), StorageKeys.ts (AsyncStorage keys)
    ├── hooks/                       # useColorScheme, useThemeColor, useTheme, useRedux (typed dispatch/selector hooks), useThumbnailVersion
    ├── utils/viewScale.ts           # Maps the user's view-scale setting to a grid column count
    └── types/                       # Ambient type declarations (require.context, *.css modules)
```

## 4. Application Bootstrap & Navigation

Entry point: `index.js` (`"main"` in `package.json`) calls
`registerRootComponent(App)`, and `App.tsx` mounts `<ExpoRoot>` with
`require.context('./src/app')`, which makes `src/app/_layout.tsx` the router
root. Dev and release builds both start this way. Until 2.4.1 `"main"` was
`expo-router/entry` locally, but the EAS workflow rewrote it to
`expo/AppEntry.js` (i.e. `App.tsx`) before building, so only CI builds used
`App.tsx`. That split is why local gradle builds failed to open while CI
builds worked (#123): `expo-router/entry` reads the route root from the
plugin config below, which was wrong at the time.

The `expo-router` plugin `root = "src/app"` in `app.json` still matters for
typed routes and the web export. It must point at
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
   `mergeshows` (presentation: modal), `player` (presentation: modal),
   `videoplayer` (presentation: fullScreenModal, no header).

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

Redux Toolkit with three slices, combined in `store/store.ts`:

- **`settingsReducer`** — user configuration: `mediaSources` (array of SAF
  folder URIs with a `contentType` of `tv`/`movie`/`audiobook` and an
  optional per-source `metadataSource`), global `dataSource` (`tmdb`|`tvdb`),
  `viewType`, `viewScale`, `viewOrientation`, API keys/PIN, `defaultPage`,
  feature toggles (`enablePosterFetching`, `enableThumbnailGeneration`,
  `rescanOnStartup`, `fetchEpisodeNames`, `fetchEpisodeThumbnails`),
  `audiobookPlayer` and `videoPlayer` (each `inapp` | `external`, default `inapp`),
  `audiobookPlaybackRate` (0.5–2, default 1, set from the player screen),
  `audiobookRewindSeconds` (rewind on resume, 0 = off, default 10),
  `appColorScheme`, and `settingsPassword` (parent-mode lock).
- **`libraryReducer`** — everything produced by scanning/enrichment:
  `mediaLibrary` (shows → seasons → episodes), `movies`, `audiobooks`,
  `mediaOverrides` (user edits, keyed by namespaced string — see §7), `watched`
  (files marked watched/listened — see §6), `listenProgress` (audiobook resume
  points — see §6), `watchProgress` (video resume points — see §6) and the legacy `thumbnails` map. Everything in this slice is persisted (see below).
  Besides the usual reducers it handles `applyLibraryActions(actions[])`, which
  applies several library actions as one dispatch (one subscriber
  notification) — used by `MetadataService` to batch enrichment updates.
- **`scanReducer`** (`store/scanReducer.ts`) — transient scan state only:
  `isScanning` and `scanProgress` (`ScanProgress`: phase + counters). It is kept
  out of `libraryReducer` on purpose: progress ticks several times a second, and
  in the library slice each one would change `libraryReducer`'s identity (what
  library autosave and the browse screens key off). It is not in the redux-persist
  whitelist and has no SQLite counterpart, so nothing ever serialises it.

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
  `movies`, `audiobooks`, `mediaOverrides`, `thumbnails`, `watched`, `listenProgress`, `watchProgress`).
  `watched`, `listenProgress` and `watchProgress` were added without a `LIBRARY_STORE_VERSION` bump: a
  store from before them simply lacks the row, which loads as empty and is created on the next save, and older apps ignore
  rows they don't know. Redux still holds
  the whole library in memory (same slice, reducers and selectors);
  `LibraryStore` autosaves incrementally (only shows whose object reference
  changed, throttled, flushed when the app backgrounds). Every save, and the
  initial full write that also sets the version marker, is one transaction,
  so a failure leaves the previous state intact and the unsaved diff is
  retried on the next save. expo-sqlite reads rows through its own bundled
  sqlite3, not Android's CursorWindow, so there is no ~2 MB per-row limit.
  The `hydrateLibrary` reducer loads it into the slice. Scan state lives in
  `scanReducer` and is never persisted.

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

**Thumbnails are not in Redux.** Generated video thumbnails live in
`scripts/thumbnailCache.ts`: a Map (media path → `file://` URI, or an in-session
`VideoThumbnail` ref, which is not serialisable) made observable. It exposes
`subscribe` / `getVersion` for `useSyncExternalStore`, and change notifications
are rate-limited (250 ms, leading + trailing) so a thumbnail pass doesn't
re-render subscribers once per image. `hooks/useThumbnailVersion.ts` returns the
version, and `MediaBrowserScreen` uses it as the `displayItems` memo dependency
(this replaced the old `scanProgress.thumbnailsDone` cache-buster, which tied
browse rebuilds to scan-progress state). `smb_thumbnails/index.json` stays the
persistence layer; `FileScanner` loads it into the cache. The `thumbnails` field
of `libraryReducer` (and its `kv` row) is a leftover that the scanner and UI no
longer use.

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

- **Watched / listened** — `libraryReducer.watched`: `{ [parsedPath]: timestamp }`.
  Tapping a playable file (episode, movie, audiobook part or single-file audiobook) in
  `MediaBrowserScreen` marks it as it is handed to the external player (undone if the
  hand-off throws and it wasn't already marked); folders are never marked by a tap. The
  key is the file's `parsedPath` (the decoded SAF URI — the same identity the
  `episode:`/`movie:` override keys use), and the map sits beside `mediaOverrides`
  rather than on the scanned objects, so a rescan, which rebuilds those and clears the
  library at its start, cannot lose it, and a temporarily unavailable source keeps its
  marks. Moving or renaming a file (or re-adding a source under a different SAF tree)
  changes its `parsedPath`, same as for overrides; stale entries are kept, not pruned.
  `WatchedBadge` (in `PosterBox`'s bottom-left corner, or inline in `ListItem`) shows a
  green tick for a watched file, or for a show/season/multi-part audiobook whose files
  (`getShowWatchKeys` / `getSeasonWatchKeys` / `getAudiobookWatchKeys`; hidden episodes
  excluded) are all watched. Each badge subscribes to `selectWatched` itself, so marking
  re-renders only badges, not cells or the list. In **edit mode** (parent-lock gated) the
  badge is also the manual toggle on every file and folder cell; a folder cell sets or
  clears every file below it in one dispatch (`markWatched` / `markUnwatched`). The JSON
  backup has an optional `watched` section, merged on import (later timestamp wins).
  With the in-app audiobook player (§13) an audiobook part is **not** marked on tap: it is
  marked when it plays to its end. Likewise a video played in-app is marked once it passes 90% or ends.

- **Listening progress** — `libraryReducer.listenProgress`: `{ [folderKey]: IListenProgress }`
  (`partPath` = the part's `parsedPath`, `position`/`duration` in seconds, `updatedAt`).
  Written only by `AudiobookPlayer` (§13); like `watched` it sits beside the scanned
  objects so rescans keep it. The entry is removed when the last part finishes, so the
  next play starts over. If the saved part is no longer among the book's parts after a
  rescan, playback starts from the beginning. `ListenProgressBar` (inside `PosterBox` /
  `ListItem`) subscribes to it itself, like `WatchedBadge`, and shows the whole-book
  fraction on a book cell and the part fraction on the in-progress part row. It is
  exported in the JSON backup alongside `watched` (same checkbox) and merged on import
  (later `updatedAt` wins).

- **Watch progress** — `libraryReducer.watchProgress`: `{ [parsedPath]: IWatchProgress }`
  (`position`/`duration` in seconds, `updatedAt`), one entry per video file. Written only by
  `VideoProgressTracker` (§13); the entry is removed when the file passes 90% or plays to its
  end (it is then marked watched). `resumePosition` (`videoProgress.ts`) decides whether an
  entry is worth offering to resume. It sits beside `watched`, so rescans keep it, and is
  exported in the JSON backup with the watched marks and merged on import (later `updatedAt` wins).

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
   every file not already in `thumbnailCache` (§5), bounded by a second semaphore
   (`MAX_CONCURRENT_THUMBNAILS = 3`, CPU-bound so kept low). Successful
   thumbnails are persisted to `smb_thumbnails/` and indexed in
   `smb_thumbnails/index.json` so they survive app restarts; failures fall
   back to an in-session-only in-memory `VideoThumbnail`.
8. Scanning is cooperatively cancellable via `cancelScan()`, checked at
   numerous points (`_cancelRequested`); partial Redux state from a
   cancelled scan is left in place rather than rolled back.

`scanProgress` (in `scanReducer`, not `libraryReducer`) tracks a `phase` (`collecting` |
`enriching` | `thumbnails`) plus counts, driving the progress UI in
`MediaBrowserScreen`. `FileScanner` and `MetadataService` both send it through
the shared `scanProgressDispatcher` (`scripts/scanProgressDispatcher.ts`,
built on `scripts/throttledDispatch.ts`), because every update notifies all store
subscribers (including library autosave) and re-renders every screen showing progress: per-item ticks go through
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
- Batches its library updates: `enrichLibrary` / `enrichMovies` /
  `enrichAudiobooks` / `enrichEpisodes` each collect their per-item actions
  (`updateShowMetadata`, `updateMovieMetadata`, `updateSeasonEpisodeMetadata`, ...)
  in a `createBatcher` (`scripts/batchedDispatch.ts`) and dispatch them as one
  `applyLibraryActions` every 25 items or 300 ms, whichever comes first, instead of
  one dispatch (and one subscriber notification) per item. Each method flushes its
  batch before returning, so callers that read the library back afterwards (e.g.
  `enrichAll` before episode enrichment and provider-id dedup) always see every update.
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
`expo-document-picker`) that serializes settings + overrides + watched marks + matched
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

**Bedtime mode.** An optional second restriction on top of the parent lock:
during a configured time window (`bedtimeEnabled`/`bedtimeStart`/`bedtimeEnd`/
`bedtimeAllowedTypes` in settings; pure helpers in `utils/bedtime.ts`) only the
allowed libraries (default: audiobooks) are reachable. `BedtimeContext`
(mounted inside `EditModeProvider`) exposes `restrictedSections`, which is empty
unless bedtime is active and neither lifted nor `drawerUnlocked`. Bedtime is
(re)evaluated at an *entry check* — app mount, return to the foreground, a
bedtime setting change, and the drawer's Lock button (`recheckBedtime`) — and
entry checks also clear a previous lift. A 60 s interval re-evaluates the clock
only (it does not clear a lift), so an app left open across the start time still
locks. In the drawer, restricted sections show a bed icon; tapping one opens
`PasswordPromptModal` (the shared password + recovery modal, also used by
Unlock) and on success calls `liftBedtime()` and navigates there. `DrawerLayout`
watches `useSegments()` and `router.replace`s off any restricted section to the
first allowed one, and `firstTimeSetupCheck` in `app/_layout.tsx` does the same
for the default page at startup to avoid a flash of a restricted screen.

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

## 13. Playback (`openMedia.ts`, `AudiobookPlayer.ts`, `VideoProgressTracker.ts`)

**Audiobooks — in-app player** (default; `settings.audiobookPlayer === 'inapp'`). Tapping
an audiobook file in `MediaBrowserScreen` calls `AudiobookPlayer.getInstance().play(book,
partIndex?)` and pushes the `/player` modal. `AudiobookPlayer` is a singleton owning one
`expo-audio` player (`createAudioPlayer`), so playback outlives every screen; the player
screen only observes it (`subscribe`/`getSnapshot` for `useSyncExternalStore`, plus
`useAudioPlayerStatus(getPlayer())` for live position). Like `FileScanner` it reaches
Redux only through `librarySink`. Behaviour:

- **Resume.** `resolveStartPoint` (`audiobookProgress.ts`): a book tap resumes the saved
  part and position; tapping a specific part resumes it if it is the saved part, else
  starts it at 0. Tapping the book that is already loaded just resumes it.
- **Loading.** `pause()` → `replace(content:// path)` → wait for the player's live
  `isLoaded` → `seekTo(saved position)` → `play()`. Android emits no load-error event, so
  a part that reports `buffering` and then falls back to `idle` is treated as failed. An
  early `idle` that `setMediaSource` emits before `prepare` is ignored. The error is shown
  on the player screen, and pressing play retries.
- **Progress saving** (`setListenProgress`): at most every 10 s while playing, plus
  immediately on pause (including from the lock screen), seek, part load, part change,
  switching books, and the app leaving the foreground. It is not saved on every status
  tick, because each dispatch notifies every store subscriber and schedules a library
  autosave.
- **End of a part.** On `didJustFinish` the part is `markWatched` and the next part
  loads at 0. After the last part the book's progress is cleared and the book stays
  loaded as "Finished", where play starts it over.
- **Background / lock screen.** `setAudioModeAsync({ shouldPlayInBackground: true,
  interruptionMode: 'doNotMix' })` and `setActiveForLockScreen` (title respects the
  `audiobook:` override, artist = author, cover passed only as a `file:`/`http(s):` URL,
  because the native side loads it with `java.net.URL`). The `expo-audio` config plugin
  in `app.json` (`enableBackgroundPlayback: true`, microphone/recording disabled) adds
  the media-playback foreground service and its permissions. That is a native change,
  so it needs a rebuild. The media notification has play/pause and seek back/forward
  (expo-audio fixes those at 10 s natively), and no part navigation (expo-audio removes
  next/previous from the session).
- **Skip.** `skipBy(±SKIP_INTERVAL_SECONDS)` (30 s) seeks within the current part. Forward
  stops 1 s short of the end, so a skip never ends a paused part (which would auto-advance
  and start playing).
- **Speed.** `setPlaybackRate` stores `settings.audiobookPlaybackRate` (via `librarySink`)
  and applies it; it is re-applied after every part load. Android preserves pitch.
- **Sleep timer.** `setSleepTimer({ minutes } | 'endOfPart' | null)`; the timer is in the
  `NowPlaying` snapshot. A duration timer is enforced from `playbackStatusUpdate` events,
  not `setTimeout`: RN's JS timers don't fire while the app is backgrounded on Android,
  but status events keep arriving while audio plays. A timer that expires while paused is
  just cleared, so pressing play afterwards doesn't pause again straight away. One that
  expires while a part is loading stops there, and the part is not started. "End of
  part" ticks the part and loads the next one paused (`startLoad`'s `autoplay: false`).
- **Rewind on resume.** When playback resumes after a pause of at least
  `REWIND_MIN_PAUSE_MS` (30 s), it steps back `settings.audiobookRewindSeconds` within the
  part (`rewindOnResume` in `audiobookProgress.ts`). The pause starts when status goes from
  playing to paused (`pausedAt`). For a book loaded fresh from saved progress, the pause is
  measured from `listenProgress.updatedAt`. The rewind applies to the in-app play button,
  the lock screen/headset (detected in `onStatus` on the paused→playing transition) and
  reopening a book. A seek while paused clears `pausedAt`, because the listener picked
  that spot.
- **Mini-player.** `MediaSectionStack` renders `MiniPlayer` under each media section's
  stack once something has been played in-app. While it shows, it zeroes the bottom
  safe-area inset for the stack subtree because it owns the bottom edge.

**Video — in-app player** (default; `settings.videoPlayer === 'inapp'`). Tapping a movie or
episode in `MediaBrowserScreen` runs `playVideoInApp`:

- **Flow.** It records `lastOpened`, looks up `watchProgress[parsedPath]` and, when
  `resumePosition` (`videoProgress.ts`) says there is something to resume (at least 10 s in,
  not past the watched threshold), asks with a native `Alert` ("Resume from 23:41?", buttons
  "Start over" / "Resume"; dismissing it does nothing). Otherwise it plays from 0 straight
  away. The chosen start goes into `setVideoRequest` (`VideoPlayback.ts`, a module variable:
  `{ path, parsedPath, filename, title, startAt }`) and the `/videoplayer` screen is pushed.
  The request is not a route param so a `content://` URI never goes through URL encoding;
  it also means a screen restored after the process died (nothing in the variable) shows
  "Nothing playing" with a Close button.
- **Screen** (`app/videoplayer.tsx`). A `fullScreenModal` (falls back to `modal` on Android)
  with `animation: 'fade'` and no header, status bar hidden. It owns its player
  (`useVideoPlayer`, `timeUpdateEventInterval = 1`, `keepScreenOnWhilePlaying`) and shows it
  in a `VideoView` with native controls (contain, black background, expo-video's own
  fullscreen button off). On the first `readyToPlay` it pauses the audiobook player
  (`AudiobookPlayer.pause()`, so the two never play over each other), seeks to `startAt` and
  plays. There is no background playback and no Picture-in-Picture: expo-video pauses when
  the app is backgrounded, and closing the screen releases the player.
- **Errors.** A `statusChange` to `error` is logged and covers the video with "This file
  could not be played." and two buttons: "Open in external player" (`openMediaInExternalApp`,
  then closes the screen; it does not mark the file watched) and "Close".
- **Progress and watched** (`VideoProgressTracker.ts`, created by the screen once the player
  exists; reaches Redux only through `librarySink`). Resume points go to
  `watchProgress[parsedPath]` (`setWatchProgress`): at most every 10 s from `timeUpdate`,
  immediately on pause, when the app leaves the foreground, and on `dispose()`. The first timed
  save waits a full interval after the tracker is created, so a tick before the seek to the resume
  point can't overwrite it. Nothing is saved for a non-finite position, or for position 0 with
  an unknown duration. From `isWatchedPosition` (90% of the duration, `WATCHED_FRACTION`) or
  `playToEnd` the file counts as watched: `markWatched` is dispatched once per tracker, and the
  resume point is cleared (`clearWatchProgress`). The threshold is checked on every tick, not
  only on timed saves. Seeking back below 90% after that resumes progress saving and keeps the
  watched mark; reaching 90% again drops the new resume point without marking twice. After
  `playToEnd` positions are ignored until playback is seen before the end again, because a
  player may rewind to 0 once it has ended. Unlike the external hand-off, a tap does not mark
  anything watched.
- **Teardown order.** The screen creates the tracker in a `useLayoutEffect`: on unmount a layout
  effect's cleanup runs before the passive cleanup in which `useVideoPlayer` releases the player
  (cleanups within one component run in declaration order, so a plain `useEffect` declared after
  the hook would run too late). `dispose()` therefore still reads the final position from a live
  player; reads are guarded with try/catch anyway.

**Video with `videoPlayer === 'external'`, and audiobooks with `audiobookPlayer === 'external'`.**
These are handed off to another app (the tap also marks the file watched/listened, and undoes
that if the hand-off fails). `openMediaInExternalApp` resolves a
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
  module's `File`/`Directory` constructors throw on web. It also adds `wasm`
  to Metro's asset extensions and sets COOP/COEP headers on the dev server,
  which expo-sqlite (the library store) needs on web. Nothing reliable persists
  on web and library scanning does not work there.
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
- `App.tsx` at the repo root is the real root component (via `index.js`),
  not template scaffolding; see §4.
- Jest coverage lives in `__tests__/` folders next to the code
  (`jest-expo` preset). Scan/enrichment logic is testable without the real
  store: pure helpers are in `scripts/libraryUtils.ts`, and
  `FileScanner`/`MetadataService` can run against a fake via
  `setLibrarySink` (see `scripts/__tests__/MetadataService.test.ts`). Add
  coverage alongside new parsing/normalization logic or provider parsing.
