import { combineReducers, configureStore } from '@reduxjs/toolkit'
import settingsReducer from './settingsReducer'
import AsyncStorage from '@react-native-async-storage/async-storage';
import { FLUSH, PAUSE, PERSIST, persistReducer, persistStore, PURGE, REGISTER, REHYDRATE, createTransform } from 'redux-persist';
import type { Transform } from 'redux-persist';
import libraryReducer, { INITIAL_SCAN_PROGRESS } from './libraryReducer';

// Transform that prevents transient scan state from being persisted and ensures
// it is always reset to its initial values when the store is rehydrated.
//
// Background: redux-persist's autoMergeLevel1 reconciler replaces the entire
// libraryReducer sub-state with the persisted version *after* slice reducers
// run, which means a REHYDRATE handler inside the slice cannot reliably reset
// these fields – the persisted values are written back on top.  A transform is
// the correct place to strip/reset transient fields.
//
// Cast to Transform<any, any> so the generic transform types don't cause
// persistReducer to infer optional/undefined sub-state, which would otherwise
// break every selector that reads from state.libraryReducer.
const scanStateTransform: Transform<any, any> = createTransform(
  // serialize: strip transient fields before writing to storage
  (inboundState: any) => {
    const { isScanning: _isScanning, scanProgress: _scanProgress, ...rest } = inboundState;
    return rest;
  },
  // deserialize: always restore transient fields to their safe initial values,
  // including when migrating from older persisted state that still stores them
  (outboundState: any) => ({
    ...outboundState,
    isScanning: false,
    scanProgress: INITIAL_SCAN_PROGRESS,
  }),
  { whitelist: ['libraryReducer'] },
);

// https://dev.to/shreyvijayvargiya/react-native-redux-tool-kit-asyncstorage-210e
// https://stackoverflow.com/a/62610422
const persistConfig = {
  storage: AsyncStorage,
  key: 'root',
  transforms: [scanStateTransform],
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

// Infer the type of `store`
export type AppStore = typeof store

// Infer the `RootState` and `AppDispatch` types from the store itself
export type RootState = ReturnType<typeof store.getState>

// Inferred type: {posts: PostsState, comments: CommentsState, users: UsersState}
export type AppDispatch = typeof store.dispatch