import { combineReducers, configureStore } from '@reduxjs/toolkit'
import settingsReducer from './settingsReducer'
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createTransform, FLUSH, PAUSE, PERSIST, persistReducer, persistStore, PURGE, REGISTER, REHYDRATE } from 'redux-persist';
import libraryReducer from './libraryReducer';
import type { LibraryState } from './libraryReducer';

// Reset transient scan state so a scan that was in progress when the app was
// killed does not rehydrate with isScanning=true or stale progress values.
const scanStateTransform = createTransform<LibraryState, LibraryState>(
  // inbound (state → storage): persist as-is
  (state) => state,
  // outbound (storage → state): clear transient scan fields on load
  (state) => ({
    ...state,
    isScanning: false,
    scanProgress: {
      phase: 'idle',
      filesFound: 0,
      thumbnailsDone: 0,
      thumbnailsTotal: 0,
      metadataDone: 0,
      metadataTotal: 0,
    },
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

export const persistedReducer = persistReducer(persistConfig, rootReducer);

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