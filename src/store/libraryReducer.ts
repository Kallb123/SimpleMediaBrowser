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

/**
 * Payload for a single episode entry streamed to Redux during scanning.
 * Exported so FileScanner can build typed batch arrays without importing
 * a separate type module.
 */
export interface MergeEpisodePayload {
  showName: string;
  /** Local poster URI for the show folder (empty string when not yet found). */
  folderPoster: string;
  seasonKey: string;
  seasonNumber: number;
  episodeKey: string;
  episode: IMediaObject;
}

/** Progress information for an in-progress scan. */
export interface ScanProgress {
  /** Current phase of the scan. */
  phase: 'idle' | 'collecting' | 'thumbnails' | 'enriching';
  /** Number of media files found so far during the collecting phase. */
  filesFound: number;
  /** Number of thumbnails successfully generated or failed so far. */
  thumbnailsDone: number;
  /** Total number of thumbnails to generate (set when the thumbnail phase begins). */
  thumbnailsTotal: number;
  /** Number of metadata items (shows + movies) processed so far during enrichment. */
  metadataDone: number;
  /** Total number of metadata items to process during enrichment. */
  metadataTotal: number;
}

export type contentTypes = 'tv' | 'movie';
export type dataSources = 'tmdb';
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
  /** Live progress information updated during an active scan. */
  scanProgress: ScanProgress;
}

const INITIAL_SCAN_PROGRESS: ScanProgress = {
  phase: 'idle',
  filesFound: 0,
  thumbnailsDone: 0,
  thumbnailsTotal: 0,
  metadataDone: 0,
  metadataTotal: 0,
};

// Define the initial state using that type
const initialState: LibraryState = {
  mediaLibrary: {},
  movies: [],
  scanList: [],
  isScanning: false,
  thumbnails: {},
  mediaOverrides: {},
  scanProgress: INITIAL_SCAN_PROGRESS,
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
      // Reset progress to idle when scanning stops so stale values are not shown
      // on the next scan's initial render.
      if (!action.payload) {
        state.scanProgress = INITIAL_SCAN_PROGRESS;
      }
    },
    setScanProgress: (state, action: PayloadAction<ScanProgress>) => {
      state.scanProgress = action.payload;
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
    /**
     * Clears both the TV library and the movie list.  Dispatched at the start
     * of each scan so stale data is not shown before streaming results arrive.
     */
    clearLibraryAndMovies: (state) => {
      state.mediaLibrary = {};
      state.movies = [];
    },
    /**
     * Incrementally upserts a batch of TV episodes into the library.
     * Creates show and season scaffolding as needed; skips duplicate episode keys.
     * Used to stream discovered episodes to the UI during scanning.
     */
    mergeEpisodeBatch: (state, action: PayloadAction<MergeEpisodePayload[]>) => {
      for (const { showName, folderPoster, seasonKey, seasonNumber, episodeKey, episode } of action.payload) {
        if (!state.mediaLibrary[showName]) {
          state.mediaLibrary[showName] = {
            ids: { tvdb: null, imdb: null, tmdb: null },
            title: showName,
            year: 0,
            poster: folderPoster,
            seasons: {},
          };
        } else if (folderPoster && !state.mediaLibrary[showName].poster) {
          // Back-fill poster for a show that was created without one
          state.mediaLibrary[showName].poster = folderPoster;
        }
        if (!state.mediaLibrary[showName].seasons[seasonKey]) {
          state.mediaLibrary[showName].seasons[seasonKey] = {
            ids: { tvdb: null, imdb: null, tmdb: null },
            seasonNumber,
            episodes: {},
          };
        }
        if (!state.mediaLibrary[showName].seasons[seasonKey].episodes[episodeKey]) {
          state.mediaLibrary[showName].seasons[seasonKey].episodes[episodeKey] = episode;
        }
      }
    },
    /**
     * Appends a batch of movies to the movie list.
     * Deduplicates by path so re-scanning a source that overlaps another is safe.
     */
    appendMovieBatch: (state, action: PayloadAction<IMediaObject[]>) => {
      const existingPaths = new Set(state.movies.map((m) => m.path));
      for (const movie of action.payload) {
        if (!existingPaths.has(movie.path)) {
          state.movies.push(movie);
          existingPaths.add(movie.path);
        }
      }
    },
    /** Updates the poster URI for a show (e.g. when a local poster file is found during scanning). */
    updateShowPoster: (state, action: PayloadAction<{ showName: string; poster: string }>) => {
      const show = state.mediaLibrary[action.payload.showName];
      if (show) show.poster = action.payload.poster;
    },
    /** Updates the poster URI for a single movie by its file path. */
    setMoviePoster: (state, action: PayloadAction<{ path: string; poster: string }>) => {
      const movie = state.movies.find((m) => m.path === action.payload.path);
      if (movie) movie.poster = action.payload.poster;
    },
  },
})

export const { addToScanList, setScanList, clearScanList, setMediaLibrary, setMovies, setIsScanning, setScanProgress, setThumbnail, clearThumbnails, updateShowMetadata, updateMovieMetadata, setMediaOverride, clearMediaOverride, clearLibraryAndMovies, mergeEpisodeBatch, appendMovieBatch, updateShowPoster, setMoviePoster } = settingsSlice.actions;

// Other code such as selectors can use the imported `RootState` type
export const selectScanList = (state: RootState) => state.libraryReducer.scanList;
export const selectMediaLibrary = (state: RootState) => state.libraryReducer.mediaLibrary;
export const selectMovies = (state: RootState) => state.libraryReducer.movies;
export const selectIsScanning = (state: RootState) => state.libraryReducer.isScanning;
export const selectThumbnails = (state: RootState) => state.libraryReducer.thumbnails;
export const selectMediaOverrides = (state: RootState) => state.libraryReducer.mediaOverrides;
export const selectScanProgress = (state: RootState) => state.libraryReducer.scanProgress;

export default settingsSlice.reducer