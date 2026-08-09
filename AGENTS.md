# AGENTS.md

Guidance for AI coding agents (and human contributors) working in this
repository. For a deep dive into how the app is built, read
[ARCHITECTURE.md](./ARCHITECTURE.md) — this file is intentionally brief and
defers to it for anything beyond orientation.

## What this project is

Zibo (Zibo — Local Media Library) is an Android-first Expo/React Native app (Expo SDK 55,
RN 0.83) that scans SAF-accessible folders into a browsable TV/movie/
audiobook library, enriches it with TMDB/TVDB/iTunes metadata, and hands
playback off to an external player app. See [README.md](./README.md) for the
full feature list.

## Repo layout (short version)

```
src/
├── app/            Expo Router screens (file-based routing). Real navigation is under (drawer)/.
├── components/     UI components. MediaBrowserScreen.tsx is the core browsing screen.
├── scripts/        Non-UI logic: FileScanner (scanning), MetadataService + providers/ (TMDB/TVDB/iTunes),
│                   ImportExportService, Logger, openMedia
├── store/          Redux Toolkit slices: settingsReducer, libraryReducer (+ store.ts persistence config)
├── contexts/       EditModeContext (edit mode / parent-lock UI state)
├── constants/      Colors, theme tokens, AsyncStorage keys
├── hooks/          Theme/color-scheme hooks, typed Redux hooks
└── utils/          Small pure helpers (e.g. viewScale)
```

Full annotated layout, data flow, and subsystem-by-subsystem detail:
**[ARCHITECTURE.md](./ARCHITECTURE.md)**. Read it before touching
`FileScanner.ts`, `MetadataService.ts`, or the Redux slices — the ordering
and carry-over logic in the scanning pipeline is easy to break subtly.

Note: `src/app/(tabs)/`, top-level `index.tsx`/`explore.tsx`/`modal.tsx`,
and the kebab-case component files (`themed-text.tsx`, `web-badge.tsx`,
etc.) are unused Expo template scaffolding, not part of the real app flow —
see ARCHITECTURE.md §15 before assuming they're dead code you can ignore
vs. code you should update alongside a real screen.

## Setup & common commands

```bash
npm install                # install dependencies
npx expo start             # start the Metro dev server
npm run android             # expo run:android
npx tsc --noEmit            # type-check (must pass — CI runs this)
npm run lint                 # expo lint (eslint-config-expo flat config)
npx jest --ci --watchAll=false --passWithNoTests   # test suite (currently empty)
```

CI (`.github/workflows/pre-build-test.yaml`) runs typecheck, lint, and jest
on every PR into `main`. Run all three locally before considering a change
done — there is no test suite yet, so typecheck + lint are the main
automated safety net.

## Coding conventions

- **TypeScript strict mode.** Use the `@/*` path alias (maps to `src/*`;
  `@/assets/*` maps to `assets/*`) instead of relative `../../..` imports.
- **Redux Toolkit slices** (`store/*Reducer.ts`): add new state via
  `createSlice` reducers and export a typed selector alongside each new
  field, matching the existing `select*` naming pattern.
- **Non-UI logic lives in `src/scripts/`**, not inside components. Follow
  the existing singleton pattern (`getInstance()`) for stateful services
  like `FileScanner` and `MetadataService`.
- **New metadata providers** must implement `IMetadataProvider`
  (`scripts/providers/IMetadataProvider.ts`) and be wired into both
  `MetadataService`'s `resolve*Provider` closures and the `dataSources`
  union type in `settingsReducer.ts`.
- **Logging**: use `logger.log/warn/error(tag, message, ...)` from
  `scripts/Logger.ts` for anything useful in a standalone build, not
  `console.log` — release builds have no attached console, and the in-app
  Debug Logs screen only surfaces what goes through `logger`.
- **Overrides are additive, never destructive.** User edits go into
  `mediaOverrides` (namespaced keys — see ARCHITECTURE.md §6); never mutate
  or drop the underlying scanned/provider data when applying an override.
- Prefer editing an existing file over creating a new one; avoid adding
  abstractions, config flags, or defensive error handling beyond what the
  change actually needs.

## Testing / verifying changes

- There is no existing Jest test suite — `jest-expo` is configured as the
  preset (`package.json`), so it's ready to use if you add coverage. Favor
  adding tests for pure logic (`FileScanner.ts`'s `normalizeShowName`,
  `fuzzyKey`, `buildTmdbSearchQuery`; provider response parsing) over
  UI/component tests, since the app is Android-only and hard to drive
  headlessly.
- UI/feature changes involving scanning, metadata enrichment, or playback
  can't be meaningfully verified by typecheck/lint alone — they touch SAF,
  native video APIs, and network providers that don't run in this
  environment. Say so explicitly if you can't exercise the actual flow
  (e.g. no Android device/emulator available), rather than claiming a fix
  works.
- Always run `npx tsc --noEmit` and `npm run lint` before considering a
  change complete.

## Git / PR conventions

- Target branch: `main`.
- Keep commits focused; write commit messages that explain *why*, not just
  *what* (the diff already shows what changed).
- Don't commit API keys, `.env` files, or anything under
  `android/app/build/outputs/` (release APKs / keystores).

## Where to look for X

| Looking for... | Start here |
|---|---|
| How scanning works | `src/scripts/FileScanner.ts`, ARCHITECTURE.md §7 |
| How TMDB/TVDB matching works | `src/scripts/MetadataService.ts`, `src/scripts/providers/`, ARCHITECTURE.md §8 |
| The `smb.json` sidecar format | `src/scripts/SmbTypes.ts`, ARCHITECTURE.md §9 |
| Redux state shape | `src/store/libraryReducer.ts`, `src/store/settingsReducer.ts`, ARCHITECTURE.md §5-6 |
| Main browsing UI | `src/components/MediaBrowserScreen.tsx` |
| Navigation structure | `src/app/_layout.tsx`, `src/app/(drawer)/_layout.tsx`, ARCHITECTURE.md §4 |
| Edit mode / overrides / parent lock | `src/contexts/EditModeContext.tsx`, `src/app/edititem.tsx`, `src/app/mergeshows.tsx` |
| App-wide logging | `src/scripts/Logger.ts`, `src/app/(drawer)/logs.tsx` |

## Notes for future edits to this file

This file was generated from a codebase read-through and covers the
project's stable, structural facts. Feel free to tighten it with
project-specific conventions, review checklists, or decisions as they
solidify — that's expected and welcome.
