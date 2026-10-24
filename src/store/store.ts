import { combineReducers, configureStore } from '@reduxjs/toolkit'
import settingsReducer from './settingsReducer'
import AsyncStorage from '@react-native-async-storage/async-storage';
import { FLUSH, PAUSE, PERSIST, persistReducer, persistStore, PURGE, REGISTER, REHYDRATE } from 'redux-persist';
import libraryReducer from './libraryReducer';
import { AppState } from 'react-native';
import { logger } from '@/scripts/Logger';
import { createLegacyLibraryCapture, createRehydrateErrorGuard, createWriteGate, PERSIST_KEY } from './persistGuards';

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

const legacyCapture = createLegacyLibraryCapture();

/** Returns the `libraryReducer` blob found in `persist:root` (if any) and clears it. */
export const takeLegacyPersistedLibrary = legacyCapture.take;

// Storage writes are held back until libraryPersistence.ts has the library
// safely in the SQLite store; see persistGuards.ts for the full rationale.
const writeGate = createWriteGate(AsyncStorage);

/** Lets redux-persist write settings to `persist:root` (call once the library is safely persisted elsewhere). */
export const allowPersistWrites = writeGate.allow;

/** True when the settings rehydrate failed, so writes are blocked for this session. */
export const didPersistRehydrateFail = writeGate.isBlocked;

// https://dev.to/shreyvijayvargiya/react-native-redux-tool-kit-asyncstorage-210e
// https://stackoverflow.com/a/62610422
const persistConfig = {
  storage: writeGate.storage,
  key: PERSIST_KEY,
  whitelist: ['settingsReducer'],
  stateReconciler: legacyCapture.reconciler,
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