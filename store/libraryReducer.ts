import { createSlice, PayloadAction } from '@reduxjs/toolkit';
import type { RootState } from './store';
import { IMediaObject } from '@/scripts/FileScanner';

/** User-supplied overrides for a media item (show, movie, or episode). */
export interface IMediaOverride {
  /** Display title shown in the UI (takes priority over the scanned/TMDB title). */
  title?: string;
  /** Sort key used to order the item (falls back to title override, then original name). */
  sortTitle?: string;
  /** TMDB numeric ID stored as a string after a rematch. */
  tmdbId?: string;
  /** Release year stored after a successful TMDB match/rematch. */
  year?: number;
  /**
   * Local file URI for a manually selected poster image (browse locally or TMDB rematch).
   * Persisted across rescans so user-chosen posters survive library rebuilds.
   */
  poster?: string;
}

export interface IMediaLibrary {
    [show: string] : IMediaShow;
}

export interface IMediaShow {
    ids: {
        tvdb: string | null;
        imdb: string | null;
        tmdb: string | null;
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
        tmdb: string | null;
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
  movies: IMediaObject[];
  scanList: IRawScanList;
  isScanning: boolean;
  thumbnails: { [path: string]: string };
  /**
   * User-supplied overrides keyed by a namespaced string:
   *   "show:<showName>"      – for a TV show folder
   *   "movie:<path>"         – for a movie file
   *   "episode:<path>"       – for an episode file
   */
  mediaOverrides: { [key: string]: IMediaOverride };
}

// Define the initial state using that type
const initialState: LibraryState = {
  mediaLibrary: {},
  movies: [],
  scanList: [],
  isScanning: false,
  thumbnails: {},
  mediaOverrides: {},
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
    setMovies: (state, action: PayloadAction<IMediaObject[]>) => {
      state.movies = action.payload;
    },
    setIsScanning: (state, action: PayloadAction<boolean>) => {
      state.isScanning = action.payload;
    },
    setThumbnail: (state, action: PayloadAction<{ path: string; uri: string }>) => {
      state.thumbnails[action.payload.path] = action.payload.uri;
    },
    clearThumbnails: (state) => {
      state.thumbnails = {};
    },
    updateShowMetadata: (state, action: PayloadAction<{ showName: string; tmdbId: string; poster: string }>) => {
      const show = state.mediaLibrary[action.payload.showName];
      if (show) {
        show.ids.tmdb = action.payload.tmdbId;
        show.poster = action.payload.poster;
      } else {
        console.warn(`[libraryReducer] updateShowMetadata: show "${action.payload.showName}" not found`);
      }
    },
    updateMovieMetadata: (state, action: PayloadAction<{ path: string; tmdbId: string; poster: string }>) => {
      const movie = state.movies.find((m) => m.path === action.payload.path);
      if (movie) {
        movie.ids.tmdb = action.payload.tmdbId;
        movie.poster = action.payload.poster;
      }
    },
    setMediaOverride: (state, action: PayloadAction<{ key: string; override: IMediaOverride }>) => {
      state.mediaOverrides[action.payload.key] = {
        ...(state.mediaOverrides[action.payload.key] ?? {}),
        ...action.payload.override,
      };
    },
    clearMediaOverride: (state, action: PayloadAction<string>) => {
      delete state.mediaOverrides[action.payload];
    },
  },
})

export const { addToScanList, setScanList, clearScanList, setMediaLibrary, setMovies, setIsScanning, setThumbnail, clearThumbnails, updateShowMetadata, updateMovieMetadata, setMediaOverride, clearMediaOverride } = settingsSlice.actions;

// Other code such as selectors can use the imported `RootState` type
export const selectScanList = (state: RootState) => state.libraryReducer.scanList;
export const selectMediaLibrary = (state: RootState) => state.libraryReducer.mediaLibrary;
export const selectMovies = (state: RootState) => state.libraryReducer.movies;
export const selectIsScanning = (state: RootState) => state.libraryReducer.isScanning;
export const selectThumbnails = (state: RootState) => state.libraryReducer.thumbnails;
export const selectMediaOverrides = (state: RootState) => state.libraryReducer.mediaOverrides;

export default settingsSlice.reducer