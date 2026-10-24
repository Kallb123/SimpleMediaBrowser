import { combineReducers, configureStore } from '@reduxjs/toolkit'
import type { Middleware } from '@reduxjs/toolkit'
import settingsReducer from './settingsReducer'
import AsyncStorage from '@react-native-async-storage/async-storage';
import { FLUSH, PAUSE, PERSIST, persistReducer, persistStore, PURGE, REGISTER, REHYDRATE } from 'redux-persist';
import type { PersistConfig, Storage } from 'redux-persist';
import autoMergeLevel1 from 'redux-persist/lib/stateReconciler/autoMergeLevel1';
import libraryReducer from './libraryReducer';
import { AppState } from 'react-native';
import { logger } from '@/scripts/Logger';

const PERSIST_KEY = 'root';

// Only the settings slice goes through redux-persist. The library lives in the
// file-backed LibraryStore (see libraryPersistence.ts): a single AsyncStorage
// entry is read through a ~2 MB CursorWindow on Android, so a large library
// made `persist:root` unreadable (issue #222). `persist:root` therefore stays
// small and holds only settings.
//
// Because redux-persist writes are throttled (see below) and settings are tiny,
// the throttle period is the only batching needed. `throttle` is the period of
// a write timer (not a debounce): the first change starts it, further changes
// within the period just update the state to be written. The trade-off is that
// the latest change can sit unwritten for up to this long; see the AppState
// flush below.
const PERSIST_THROTTLE_MS = 1000;

// ---------------------------------------------------------------------------
// Legacy library capture
// ---------------------------------------------------------------------------
// Installs from before the SQLite library store have `libraryReducer` inside
// `persist:root`. redux-persist's autoMergeLevel1 merges *every* key of the
// inbound blob into state regardless of `whitelist`, so without intervention a
// stale library would be merged on every rehydrate until the blob is rewritten.
// This reconciler pulls it out of the inbound state, stashes it for the
// one-time migration in libraryPersistence.ts, and merges the rest as usual.
// The stash can still contain legacy transient fields (isScanning /
// scanProgress / scanList); `pickPersistedLibrary` strips them.
let legacyPersistedLibrary: unknown;

/** Returns the `libraryReducer` blob found in `persist:root` (if any) and clears it. */
export function takeLegacyPersistedLibrary(): unknown | undefined {
  const legacy = legacyPersistedLibrary;
  legacyPersistedLibrary = undefined;
  return legacy;
}

export const legacyLibraryReconciler = (
  inboundState: any,
  originalState: any,
  reducedState: any,
  config: PersistConfig<any>,
) => {
  if (inboundState && typeof inboundState === 'object' && 'libraryReducer' in inboundState) {
    const { libraryReducer: legacy, ...rest } = inboundState;
    legacyPersistedLibrary = legacy;
    return autoMergeLevel1(rest, originalState, reducedState, config);
  }
  return autoMergeLevel1(inboundState, originalState, reducedState, config);
};

// ---------------------------------------------------------------------------
// Write gate
// ---------------------------------------------------------------------------
// After the first REHYDRATE, redux-persist's persistoid (createPersistoid.js)
// has an empty `lastState`, so it queues every whitelisted key plus `_persist`
// and writes them as the *entire* new `persist:root` value. That first write
// is what drops the legacy `libraryReducer` from the blob, so it must not
// happen until the library is safely in the SQLite library store. For the same reason a
// failed read must never be followed by a write: redux-persist rehydrates with
// `undefined` on a read error or its 5 s timeout, and the next write would
// replace the stored settings (sources, API keys, password, ...) with defaults.
//
// Hence storage writes wait for `open()` (called by libraryPersistence once
// the library is hydrated/migrated), and `block()` turns them into no-ops for
// the rest of the session.
export function createWriteGate(base: Storage) {
  let open!: () => void;
  const opened = new Promise<void>((resolve) => { open = resolve; });
  let blocked = false;

  const storage: Storage = {
    getItem: (key: string) => base.getItem(key),
    removeItem: (key: string) => base.removeItem(key),
    setItem: async (key: string, value: string) => {
      await opened;
      if (blocked) {
        logger.warn('Store', `Skipping write of "${key}": settings were not loaded this session, keeping stored data intact`);
        return;
      }
      return base.setItem(key, value);
    },
  };

  return {
    storage,
    /** Lets queued and future writes through. */
    allow: () => open(),
    /** Permanently turns writes into no-ops (also wakes writes already waiting). */
    block: () => {
      blocked = true;
      open();
    },
    isBlocked: () => blocked,
  };
}

const writeGate = createWriteGate(AsyncStorage);

/** Lets redux-persist write settings to `persist:root` (call once the library is safely persisted elsewhere). */
export const allowPersistWrites = writeGate.allow;

/** True when the settings rehydrate failed, so writes are blocked for this session. */
export const didPersistRehydrateFail = writeGate.isBlocked;

// redux-persist reports a failed read, failed migrate or the 5 s timeout by
// dispatching REHYDRATE with an `err` and no payload. The state then stays at
// defaults while storage may still hold the user's real settings (and legacy
// library), so block writes before the reducer's post-rehydrate write is queued.
export function createRehydrateErrorGuard(gate: Pick<ReturnType<typeof createWriteGate>, 'block'>): Middleware {
  return () => (next) => (action: any) => {
    if (action?.type === REHYDRATE && action.key === PERSIST_KEY && action.err) {
      logger.error('Store', 'Failed to rehydrate persisted settings; blocking settings writes for this session so stored data is not overwritten', action.err);
      gate.block();
    }
    return next(action);
  };
}

// https://dev.to/shreyvijayvargiya/react-native-redux-tool-kit-asyncstorage-210e
// https://stackoverflow.com/a/62610422
const persistConfig = {
  storage: writeGate.storage,
  key: PERSIST_KEY,
  whitelist: ['settingsReducer'],
  stateReconciler: legacyLibraryReconciler,
  throttle: PERSIST_THROTTLE_MS,
};
const rootReducer = combineReducers({
  settingsReducer,
  libraryReducer
});

// Cast back to the plain combined-reducer type so that RootState (inferred from
// store.getState) uses the concrete slice state types.  Without this cast, the
// persistConfig typing causes persistReducer to infer the sub-keys as
// possibly-undefined, which breaks every selector in the codebase.
export const persistedReducer = persistReducer(persistConfig, rootReducer as any) as unknown as typeof rootReducer;

export const store = configureStore({
  reducer: persistedReducer,
  middleware: (getDefaultMiddleware) => getDefaultMiddleware({
    serializableCheck: {
      ignoredActions: [FLUSH, REHYDRATE, PAUSE, PERSIST, PURGE, REGISTER],
    },
  }).concat(createRehydrateErrorGuard(writeGate)),
})

export const persistor = persistStore(store);

/** Resolves once redux-persist has finished (or failed) rehydrating settings. */
export function waitForPersistBootstrap(): Promise<void> {
  return new Promise<void>((resolve) => {
    if (persistor.getState().bootstrapped) {
      resolve();
      return;
    }
    const unsubscribe = persistor.subscribe(() => {
      if (persistor.getState().bootstrapped) {
        unsubscribe();
        resolve();
      }
    });
  });
}

// Throttled writes can lag behind state, and handing playback to an external
// player (right after dispatching `lastOpened`) backgrounds, and may kill, the
// app. persistor.flush() dispatches FLUSH, which makes redux-persist serialise
// any queued changes immediately and resolve once the AsyncStorage write
// finishes. Registered here, next to persistStore, so it runs exactly once per
// JS runtime without needing a React effect.
AppState.addEventListener('change', (nextState) => {
  if (nextState === 'background' || nextState === 'inactive') {
    persistor.flush().catch((e) => {
      logger.warn('Store', 'Failed to flush persisted state on background', e);
    });
  }
});

// Infer the type of `store`
export type AppStore = typeof store

// Infer the `RootState` and `AppDispatch` types from the store itself
export type RootState = ReturnType<typeof store.getState>

// Inferred type: {posts: PostsState, comments: CommentsState, users: UsersState}
export type AppDispatch = typeof store.dispatch