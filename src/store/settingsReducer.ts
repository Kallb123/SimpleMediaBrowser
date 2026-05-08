import { createSlice, PayloadAction } from '@reduxjs/toolkit'
import type { RootState } from './store'

export type contentTypes = 'tv' | 'movie';
export type dataSources = 'tmdb' | 'tvdb';
export type viewTypes = 'flat' | 'show' | 'show+season' | 'show/season';
export type viewOrientations = 'poster' | 'list';
export type defaultPages = 'home' | 'tv' | 'movies';

export interface IMediaSource {
  uri: string;
  contentType: contentTypes;
  /**
   * Metadata provider to use for this library folder.
   * When absent the global `dataSource` setting is used.
   */
  metadataSource?: dataSources;
}

// Define a type for the slice state
interface SettingsState {
  settingsPassword: string | null
  mediaSources: IMediaSource[]
  dataSource: dataSources
  viewType: viewTypes
  viewScale: number
  viewOrientation: viewOrientations
  tmdbApiKey: string | null
  tvdbApiKey: string | null
  tvdbPin: string | null
  defaultPage: defaultPages
  enablePosterFetching: boolean
  enableThumbnailGeneration: boolean
  rescanOnStartup: boolean
  fetchEpisodeNames: boolean
  fetchEpisodeThumbnails: boolean
}

// Define the initial state using that type
const initialState: SettingsState = {
  settingsPassword: null,
  mediaSources: [],
  dataSource: 'tmdb',
  viewType: 'show/season',
  viewScale: 5,
  viewOrientation: 'poster',
  tmdbApiKey: null,
  tvdbApiKey: null,
  tvdbPin: null,
  defaultPage: 'home',
  enablePosterFetching: true,
  enableThumbnailGeneration: false,
  rescanOnStartup: true,
  fetchEpisodeNames: true,
  fetchEpisodeThumbnails: true,
}

export const settingsSlice = createSlice({
  name: 'settings',
  // `createSlice` will infer the state type from the `initialState` argument
  initialState,
  reducers: {
    // Use the PayloadAction type to declare the contents of `action.payload`
    addMediaSource: (state, action: PayloadAction<IMediaSource>) => {
      state.mediaSources.push(action.payload);
    },
    removeMediaSource: (state, action: PayloadAction<string>) => {
      state.mediaSources = state.mediaSources.filter((s) => s.uri !== action.payload);
    },
    setPassword: (state, action: PayloadAction<string | null>) => {
      state.settingsPassword = action.payload;
    },
    setDataSource: (state, action: PayloadAction<dataSources>) => {
      state.dataSource = action.payload;
    },
    setMediaStructure: (state, action: PayloadAction<viewTypes>) => {
      state.viewType = action.payload;
    },
    setViewOrientation: (state, action: PayloadAction<viewOrientations>) => {
      state.viewOrientation = action.payload;
    },
    setViewScale: (state, action: PayloadAction<number>) => {
      state.viewScale = action.payload;
    },
    setTmdbApiKey: (state, action: PayloadAction<string | null>) => {
      state.tmdbApiKey = action.payload;
    },
    setTvdbApiKey: (state, action: PayloadAction<string | null>) => {
      state.tvdbApiKey = action.payload;
    },
    setTvdbPin: (state, action: PayloadAction<string | null>) => {
      state.tvdbPin = action.payload;
    },
    setDefaultPage: (state, action: PayloadAction<defaultPages>) => {
      state.defaultPage = action.payload;
    },
    setEnablePosterFetching: (state, action: PayloadAction<boolean>) => {
      state.enablePosterFetching = action.payload;
    },
    setEnableThumbnailGeneration: (state, action: PayloadAction<boolean>) => {
      state.enableThumbnailGeneration = action.payload;
    },
    setRescanOnStartup: (state, action: PayloadAction<boolean>) => {
      state.rescanOnStartup = action.payload;
    },
    setFetchEpisodeNames: (state, action: PayloadAction<boolean>) => {
      state.fetchEpisodeNames = action.payload;
    },
    setFetchEpisodeThumbnails: (state, action: PayloadAction<boolean>) => {
      state.fetchEpisodeThumbnails = action.payload;
    },
  },
})

export const { addMediaSource, removeMediaSource, setPassword, setDataSource, setMediaStructure, setViewOrientation, setViewScale, setTmdbApiKey, setTvdbApiKey, setTvdbPin, setDefaultPage, setEnablePosterFetching, setEnableThumbnailGeneration, setRescanOnStartup, setFetchEpisodeNames, setFetchEpisodeThumbnails } = settingsSlice.actions;

// Other code such as selectors can use the imported `RootState` type
export const selectMediaSources = (state: RootState) => state.settingsReducer.mediaSources ?? [];
export const selectPassword = (state: RootState) => state.settingsReducer.settingsPassword ?? null;
export const selectDataSource = (state: RootState) => state.settingsReducer.dataSource ?? 'tmdb';
export const selectMediaStructure = (state: RootState) => state.settingsReducer.viewType ?? 'show/season';
export const selectViewOrientation = (state: RootState): viewOrientations => {
  const v = state.settingsReducer.viewOrientation;
  // Coerce legacy 'banner' value (persisted before the Poster/List change) to 'poster'.
  return (v === 'poster' || v === 'list') ? v : 'poster';
};
export const selectViewScale = (state: RootState) => state.settingsReducer.viewScale ?? 5;
export const selectTmdbApiKey = (state: RootState) => state.settingsReducer.tmdbApiKey ?? null;
export const selectTvdbApiKey = (state: RootState) => state.settingsReducer.tvdbApiKey ?? null;
export const selectTvdbPin = (state: RootState) => state.settingsReducer.tvdbPin ?? null;
export const selectDefaultPage = (state: RootState) => state.settingsReducer.defaultPage ?? 'home';
export const selectEnablePosterFetching = (state: RootState) => state.settingsReducer.enablePosterFetching ?? true;
export const selectEnableThumbnailGeneration = (state: RootState) => state.settingsReducer.enableThumbnailGeneration ?? false;
export const selectRescanOnStartup = (state: RootState) => state.settingsReducer.rescanOnStartup ?? true;
export const selectFetchEpisodeNames = (state: RootState) => state.settingsReducer.fetchEpisodeNames ?? true;
export const selectFetchEpisodeThumbnails = (state: RootState) => state.settingsReducer.fetchEpisodeThumbnails ?? true;

export default settingsSlice.reducer