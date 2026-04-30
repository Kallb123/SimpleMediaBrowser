import { createSlice, PayloadAction } from '@reduxjs/toolkit';
import type { RootState } from './store';
import { IMediaObject } from '@/scripts/FileScanner';

export interface IMediaLibrary {
    [show: string] : IMediaShow;
}

export interface IMediaShow {
    ids: {
        tvdb: string | null;
        imdb: string | null;
    }
    title: string;
    year: number;
    poster: string;
    seasons: { [season: string] : IMediaSeason; };
}

export interface IMediaSeason {
    ids: {
        tvdb: string | null;
        imdb: string | null;
    }
    seasonNumber: number;
    episodes: { [episode: string] : IMediaObject; };
}

export type IRawScanList = string[];

export type contentTypes = 'tv' | 'movie';
export type dataSources = 'tvdb';
export type viewTypes = 'flat' | 'show' | 'show+season' | 'show/season';
export type viewOrientations = 'poster' | 'banner';

// Define a type for the slice state
interface LibraryState {
  mediaLibrary: IMediaLibrary;
  scanList: IRawScanList;
}

// Define the initial state using that type
const initialState: LibraryState = {
  mediaLibrary: {},
  scanList: []
}

export const settingsSlice = createSlice({
  name: 'settings',
  // `createSlice` will infer the state type from the `initialState` argument
  initialState,
  reducers: {
    // Use the PayloadAction type to declare the contents of `action.payload`
    addToScanList: (state, action: PayloadAction<string>) => {
      state.scanList.push(action.payload);
    },
    setScanList: (state, action: PayloadAction<string[]>) => {
      state.scanList = action.payload;
    },
    clearScanList: (state, action: PayloadAction<string>) => {
      state.scanList = [];
    },
    setMediaLibrary: (state, action: PayloadAction<IMediaLibrary>) => {
      state.mediaLibrary = action.payload;
    },
  },
})

export const { addToScanList, setScanList, clearScanList, setMediaLibrary } = settingsSlice.actions;

// Other code such as selectors can use the imported `RootState` type
export const selectScanList = (state: RootState) => state.libraryReducer.scanList;
export const selectMediaLibrary = (state: RootState) => state.libraryReducer.mediaLibrary;

export default settingsSlice.reducer