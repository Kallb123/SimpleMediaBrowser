import { combineReducers, configureStore } from '@reduxjs/toolkit'
import settingsReducer from './settingsReducer'
import AsyncStorage from '@react-native-async-storage/async-storage';
import { FLUSH, PAUSE, PERSIST, persistReducer, persistStore, PURGE, REGISTER, REHYDRATE, createTransform } from 'redux-persist';
import type { Transform } from 'redux-persist';
import libraryReducer, { INITIAL_SCAN_PROGRESS } from './libraryReducer';
import { AppState } from 'react-native';
import { logger } from '@/scripts/Logger';

// Transform that prevents transient scan state from being persisted and ensures
// it is always reset to its initial values when the store is rehydrated. It also
// drops the legacy `scanList` field (removed from the slice; it held every
// scanned file URI and was never read).
//
// Background: redux-persist's autoMergeLevel1 reconciler replaces the entire
// libraryReducer sub-state with the persisted version *after* slice reducers
// run, which means a REHYDRATE handler inside the slice cannot reliably reset
// these fields – the persisted values are written back on top.  A transform is
// the correct place to strip/reset transient fields.
//
// `scanList` is stripped in both directions for the same reason: installs that
// already have it in their persisted blob would otherwise have autoMergeLevel1
// carry it back into state on rehydrate, and it would be re-persisted forever.
//
// Cast to Transform<any, any> so the generic transform types don't cause
// persistReducer to infer optional/undefined sub-state, which would otherwise
// break every selector that reads from state.libraryReducer.
const scanStateTransform: Transform<any, any> = createTransform(
  // serialize: strip transient fields before writing to storage
  (inboundState: any) => {
    const { isScanning: _isScanning, scanProgress: _scanProgress, scanList: _scanList, ...rest } = inboundState;
    return rest;
  },
  // deserialize: always restore transient fields to their safe initial values,
  // including when migrating from older persisted state that still stores them
  (outboundState: any) => {
    const { scanList: _scanList, ...rest } = outboundState;
    return {
      ...rest,
      isScanning: false,
      scanProgress: INITIAL_SCAN_PROGRESS,
    };
  },
  { whitelist: ['libraryReducer'] },
);

// The whole store is one AsyncStorage entry, so every state change re-serialises
// the entire library. redux-persist's `throttle` is the period of a write timer
// (not a debounce): the first change starts it, further changes within the
// period just update the state to be written, so bursts such as scan progress
// ticks collapse into roughly one write per period. The trade-off is that the
// latest change can sit unwritten for up to this long (longer if both slices
// changed, as it writes one slice per tick); see the AppState flush below.
const PERSIST_THROTTLE_MS = 1000;

// https://dev.to/shreyvijayvargiya/react-native-redux-tool-kit-asyncstorage-210e
// https://stackoverflow.com/a/62610422
const persistConfig = {
  storage: AsyncStorage,
  key: 'root',
  transforms: [scanStateTransform],
  throttle: PERSIST_THROTTLE_MS,
};
const rootReducer = combineReducers({
  settingsReducer,
  libraryReducer
});

// Cast back to the plain combined-reducer type so that RootState (inferred from
// store.getState) uses the concrete slice state types.  Without this cast, the
// transforms entry in persistConfig causes persistReducer to infer the sub-keys
// as possibly-undefined, which breaks every selector in the codebase.
export const persistedReducer = persistReducer(persistConfig, rootReducer as any) as unknown as typeof rootReducer;

export const store = configureStore({
  reducer: persistedReducer,
  middleware: (getDefaultMiddleware) => getDefaultMiddleware({
    serializableCheck: {
      ignoredActions: [FLUSH, REHYDRATE, PAUSE, PERSIST, PURGE, REGISTER],
    },
  }),
})

export const persistor = persistStore(store);

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