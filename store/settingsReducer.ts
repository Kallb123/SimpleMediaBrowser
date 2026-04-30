import { createSlice, PayloadAction } from '@reduxjs/toolkit'
import type { RootState } from './store'

export type contentTypes = 'tv' | 'movie';
export type dataSources = 'tvdb';
export type viewTypes = 'flat' | 'show' | 'show+season' | 'show/season';
export type viewOrientations = 'poster' | 'banner';

export interface IMediaSource {
  uri: string;
  contentType: contentTypes;
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
}

// Define the initial state using that type
const initialState: SettingsState = {
  settingsPassword: null,
  mediaSources: [],
  dataSource: 'tvdb',
  viewType: 'show/season',
  viewScale: 5,
  viewOrientation: 'poster',
  tmdbApiKey: null,
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
    setPassword: (state, action: PayloadAction<string>) => {
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
  },
})

export const { addMediaSource, removeMediaSource, setPassword, setDataSource, setMediaStructure, setViewOrientation, setViewScale, setTmdbApiKey } = settingsSlice.actions;

// Other code such as selectors can use the imported `RootState` type
export const selectMediaSources = (state: RootState) => state.settingsReducer.mediaSources;
export const selectPassword = (state: RootState) => state.settingsReducer.settingsPassword;
export const selectDataSource = (state: RootState) => state.settingsReducer.dataSource;
export const selectMediaStructure = (state: RootState) => state.settingsReducer.viewType;
export const selectViewOrientation = (state: RootState) => state.settingsReducer.viewOrientation;
export const selectViewScale = (state: RootState) => state.settingsReducer.viewScale;
export const selectTmdbApiKey = (state: RootState) => state.settingsReducer.tmdbApiKey;

export default settingsSlice.reducer