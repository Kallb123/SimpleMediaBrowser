import { createSlice, PayloadAction } from '@reduxjs/toolkit'
import type { RootState } from './store'

// Define a type for the slice state
interface SettingsState {
  settingsPassword: string | null
  directory: string
  contentType: 'tv' | 'movie'
  dataSource: 'tvdb'
  viewType: 'flat' | 'show+season' | 'show/season'
  viewScale: number
  viewOrientation: 'poster' | 'banner'
}

// Define the initial state using that type
const initialState: SettingsState = {
  settingsPassword: null,
  directory: "",
  contentType: 'tv',
  dataSource: 'tvdb',
  viewType: 'show/season',
  viewScale: 50,
  viewOrientation: 'poster'
}

export const settingsSlice = createSlice({
  name: 'settings',
  // `createSlice` will infer the state type from the `initialState` argument
  initialState,
  reducers: {
    // Use the PayloadAction type to declare the contents of `action.payload`
    setDirectory: (state, action: PayloadAction<string>) => {
      state.directory = action.payload
    },
    setPassword: (state, action: PayloadAction<string>) => {
      state.settingsPassword = action.payload
    },
  },
})

export const { setDirectory, setPassword } = settingsSlice.actions

// Other code such as selectors can use the imported `RootState` type
export const selectDirectory = (state: RootState) => state.settingsReducer.directory
export const selectPassword = (state: RootState) => state.settingsReducer.settingsPassword

export default settingsSlice.reducer