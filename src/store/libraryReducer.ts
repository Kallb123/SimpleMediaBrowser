import { createSlice, PayloadAction } from '@reduxjs/toolkit';
import { REHYDRATE } from 'redux-persist';
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
  /**
   * When true, this item is hidden from all library views.
   * No data is deleted; clearing this override restores the item.
   */
  hidden?: boolean;
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
    /**
     * Raw folder / filename names that were merged under this canonical show
     * entry via name normalization (e.g. "Bluey (2018)" merged into "Bluey").
     * Populated during scanning; useful for debugging and the edit screen.
     */
    rawNames?: string[];
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
  /** Normalized (canonical) show name used as the Redux library key. */
  showName: string;
  /**
   * Raw folder / filename name before year-suffix normalization.
   * E.g. "Bluey (2018)" when showName is "Bluey".
   * Equal to showName when no normalization was applied.
   */
  rawShowName: string;
  /** Year extracted from the raw show name/folder suffix (0 if not present). */
  folderYear: number;
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
  /**
   * 1-based index of the source currently being collected.
   * Only present during the 'collecting' phase when there is more than one source.
   */
  currentSourceIndex?: number;
  /** Total number of sources being scanned. Only present when there is more than one source. */
  sourcesTotal?: number;
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
    updateShowMetadata: (state, action: PayloadAction<{ showName: string; tmdbId: string; poster: string; title?: string; year?: number }>) => {
      const show = state.mediaLibrary[action.payload.showName];
      if (show) {
        show.ids.tmdb = action.payload.tmdbId;
        show.poster = action.payload.poster;
        if (action.payload.title) show.title = action.payload.title;
        if (action.payload.year) show.year = action.payload.year;
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
      for (const { showName, rawShowName, folderYear, folderPoster, seasonKey, seasonNumber, episodeKey, episode } of action.payload) {
        if (!state.mediaLibrary[showName]) {
          state.mediaLibrary[showName] = {
            ids: { tvdb: null, imdb: null, tmdb: null },
            title: showName,
            year: folderYear,
            poster: folderPoster,
            seasons: {},
            rawNames: rawShowName !== showName ? [rawShowName] : [],
          };
        } else {
          if (folderPoster && !state.mediaLibrary[showName].poster) {
            // Back-fill poster for a show that was created without one
            state.mediaLibrary[showName].poster = folderPoster;
          }
          if (folderYear > 0 && !state.mediaLibrary[showName].year) {
            // Back-fill year extracted from folder name
            state.mediaLibrary[showName].year = folderYear;
          }
          // Track raw names that were merged under this canonical key
          if (rawShowName !== showName) {
            if (!state.mediaLibrary[showName].rawNames) {
              state.mediaLibrary[showName].rawNames = [rawShowName];
            } else if (!state.mediaLibrary[showName].rawNames!.includes(rawShowName)) {
              state.mediaLibrary[showName].rawNames!.push(rawShowName);
            }
          }
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
    /**
     * Merges one or more duplicate show entries into a single canonical entry.
     * All seasons and episodes from the removed entries are folded into `keepKey`;
     * existing episodes at the same key are not overwritten.  Called after TMDB
     * enrichment detects that multiple library keys share the same TMDB ID.
     */
    mergeDuplicateShows: (state, action: PayloadAction<{ keepKey: string; removeKeys: string[] }>) => {
      const { keepKey, removeKeys } = action.payload;
      const keepShow = state.mediaLibrary[keepKey];
      if (!keepShow) return;
      for (const removeKey of removeKeys) {
        const removeShow = state.mediaLibrary[removeKey];
        if (!removeShow) continue;
        // Merge seasons and episodes
        for (const [seasonKey, season] of Object.entries(removeShow.seasons) as Array<[string, IMediaSeason]>) {
          if (!keepShow.seasons[seasonKey]) {
            keepShow.seasons[seasonKey] = season;
          } else {
            for (const [epKey, ep] of Object.entries(season.episodes)) {
              if (!keepShow.seasons[seasonKey].episodes[epKey]) {
                keepShow.seasons[seasonKey].episodes[epKey] = ep;
              }
            }
          }
        }
        // Accumulate raw names for provenance tracking
        if (!keepShow.rawNames) keepShow.rawNames = [];
        const existingRaw = new Set(keepShow.rawNames);
        for (const n of (removeShow.rawNames && removeShow.rawNames.length > 0 ? removeShow.rawNames : [removeKey])) {
          if (!existingRaw.has(n)) {
            keepShow.rawNames.push(n);
            existingRaw.add(n);
          }
        }
        // Use the removed show's poster if the keep show has none
        if (!keepShow.poster && removeShow.poster) {
          keepShow.poster = removeShow.poster;
        }
        delete state.mediaLibrary[removeKey];
      }
    },
    /**
     * Clears all user-supplied overrides (title, sortTitle, tmdbId, year, poster)
     * for every show, movie, and episode. Does not touch library data or disk files.
     */
    clearAllOverrides: (state) => {
      state.mediaOverrides = {};
    },
    /**
     * Clears the TMDB-sourced episode metadata (tmdbTitle and tmdbThumbnail) for every
     * episode in every season of the specified show.  Called before re-enriching a show
     * after a manual TMDB rematch so stale data from the old match does not persist.
     */
    clearShowEpisodeMetadata: (state, action: PayloadAction<string>) => {
      const show = state.mediaLibrary[action.payload];
      if (!show) return;
      for (const season of Object.values(show.seasons)) {
        for (const ep of Object.values(season.episodes)) {
          ep.tmdbTitle = undefined;
          ep.tmdbThumbnail = undefined;
        }
      }
    },
    /**
     * Clears all cached poster data:
     * - Removes the `poster` field from every entry in `mediaOverrides`.
     * - Resets the poster URI to an empty string for every show and movie in the library.
     * - Clears `tmdbThumbnail` from every episode (TMDB stills will be re-fetched on next scan).
     * Call this after deleting the smb_posters and smb_thumbnails_tmdb directories from disk.
     */
    clearPosterOverrides: (state) => {
      for (const key of Object.keys(state.mediaOverrides)) {
        delete state.mediaOverrides[key].poster;
      }
      for (const show of Object.values(state.mediaLibrary)) {
        show.poster = '';
        for (const season of Object.values(show.seasons)) {
          for (const ep of Object.values(season.episodes)) {
            ep.tmdbThumbnail = undefined;
          }
        }
      }
      for (const movie of state.movies) {
        movie.poster = '';
      }
    },
    /**
     * Batch-updates episode metadata (tmdbTitle and/or tmdbThumbnail) for all
     * episodes in one season fetched from the TMDB season endpoint.
     * This is dispatched once per season after a single API call, avoiding
     * the need for individual per-episode API calls.
     */
    updateSeasonEpisodeMetadata: (
      state,
      action: PayloadAction<{
        showName: string;
        seasonKey: string;
        episodeUpdates: { [episodeKey: string]: { tmdbTitle?: string; tmdbThumbnail?: string } };
      }>,
    ) => {
      const { showName, seasonKey, episodeUpdates } = action.payload;
      const season = state.mediaLibrary[showName]?.seasons[seasonKey];
      if (!season) return;
      for (const [epKey, update] of Object.entries(episodeUpdates)) {
        const ep = season.episodes[epKey];
        if (!ep) continue;
        if (update.tmdbTitle !== undefined) ep.tmdbTitle = update.tmdbTitle;
        if (update.tmdbThumbnail !== undefined) ep.tmdbThumbnail = update.tmdbThumbnail;
      }
    },
  },
  extraReducers: (builder) => {
    // Reset transient scan state when redux-persist rehydrates the store.
    // This prevents a scan that was in progress when the app was killed from
    // rehydrating with isScanning=true or stale progress values on next launch.
    builder.addCase(REHYDRATE, (state) => {
      state.isScanning = false;
      state.scanProgress = INITIAL_SCAN_PROGRESS;
    });
  },
})

export const { addToScanList, setScanList, clearScanList, setMediaLibrary, setMovies, setIsScanning, setScanProgress, setThumbnail, clearThumbnails, updateShowMetadata, updateMovieMetadata, setMediaOverride, clearMediaOverride, clearLibraryAndMovies, mergeEpisodeBatch, appendMovieBatch, updateShowPoster, setMoviePoster, mergeDuplicateShows, clearPosterOverrides, clearAllOverrides, updateSeasonEpisodeMetadata, clearShowEpisodeMetadata } = settingsSlice.actions;

// Other code such as selectors can use the imported `RootState` type
export const selectScanList = (state: RootState) => state.libraryReducer.scanList;
export const selectMediaLibrary = (state: RootState) => state.libraryReducer.mediaLibrary;
export const selectMovies = (state: RootState) => state.libraryReducer.movies;
export const selectIsScanning = (state: RootState) => state.libraryReducer.isScanning;
export const selectThumbnails = (state: RootState) => state.libraryReducer.thumbnails;
export const selectMediaOverrides = (state: RootState) => state.libraryReducer.mediaOverrides;
export const selectScanProgress = (state: RootState) => state.libraryReducer.scanProgress;

export default settingsSlice.reducer