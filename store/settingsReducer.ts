import { createSlice, PayloadAction } from '@reduxjs/toolkit'
import type { RootState } from './store'

export type contentTypes = 'tv' | 'movie';
export type dataSources = 'tvdb';
export type viewTypes = 'flat' | 'show' | 'show+season' | 'show/season';
export type viewOrientations = 'poster' | 'banner';

// Define a type for the slice state
interface SettingsState {
  settingsPassword: string | null
  directory: string
  contentType: contentTypes
  dataSource: dataSources
  viewType: viewTypes
  viewScale: number
  viewOrientation: viewOrientations
}

// Define the initial state using that type
const initialState: SettingsState = {
  settingsPassword: null,
  directory: "",
  contentType: 'tv',
  dataSource: 'tvdb',
  viewType: 'show/season',
  viewScale: 5,
  viewOrientation: 'poster'
}

export const settingsSlice = createSlice({
  name: 'settings',
  // `createSlice` will infer the state type from the `initialState` argument
  initialState,
  reducers: {
    // Use the PayloadAction type to declare the contents of `action.payload`
    setDirectory: (state, action: PayloadAction<string>) => {
      state.directory = action.payload;
    },
    setPassword: (state, action: PayloadAction<string>) => {
      state.settingsPassword = action.payload;
    },
    setMediaType: (state, action: PayloadAction<contentTypes>) => {
      state.contentType = action.payload;
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
  },
})

export const { setDirectory, setPassword, setMediaType, setDataSource, setMediaStructure, setViewOrientation, setViewScale } = settingsSlice.actions;

// Other code such as selectors can use the imported `RootState` type
export const selectDirectory = (state: RootState) => state.settingsReducer.directory;
export const selectPassword = (state: RootState) => state.settingsReducer.settingsPassword;
export const selectMediaType = (state: RootState) => state.settingsReducer.contentType;
export const selectDataSource = (state: RootState) => state.settingsReducer.dataSource;
export const selectMediaStructure = (state: RootState) => state.settingsReducer.viewType;
export const selectViewOrientation = (state: RootState) => state.settingsReducer.viewOrientation;
export const selectViewScale = (state: RootState) => state.settingsReducer.viewScale;

export default settingsSlice.reducer