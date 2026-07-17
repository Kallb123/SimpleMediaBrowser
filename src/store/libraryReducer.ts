import { createSlice, PayloadAction } from '@reduxjs/toolkit';
import type { RootState } from './store';
import { IMediaObject } from '@/scripts/FileScanner';

/** User-supplied overrides for a media item (show, movie, or episode). */
export interface IMediaOverride {
  /** Display title shown in the UI (takes priority over the scanned/TMDB title). */
  title?: string;
  /** Sort key used to order the item (falls back to title override, then original name). */
  sortTitle?: string;
  /** TMDB numeric ID stored as a string after a TMDB rematch. */
  tmdbId?: string;
  /** TVDB numeric ID stored as a string after a TVDB rematch. */
  tvdbId?: string;
  /** Release year stored after a successful metadata match/rematch. */
  year?: number;
  /**
   * Local file URI for a manually selected poster image (browse locally or metadata rematch).
   * Persisted across rescans so user-chosen posters survive library rebuilds.
   */
  poster?: string;
  /**
   * When true, this item is hidden from all library views.
   * No data is deleted; clearing this override restores the item.
   */
  hidden?: boolean;
  /**
   * Forces a specific metadata provider for this item, overriding both the library-level
   * and global data-source settings.
   */
  metadataSourceOverride?: dataSources;
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
    /**
     * The metadata provider that was configured on the source folder when this
     * show was scanned.  Used by MetadataService to pick the right provider
     * without needing a per-item override.  Absent means use the global setting.
     */
    metadataSource?: dataSources;
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

/** A single audio file that forms part of an audiobook. */
export interface IAudiobookFile {
    /** SAF content:// URI used to open the file in an external player. */
    path: string;
    /** Decoded URI (human-readable), used as a stable key. */
    parsedPath: string;
    /** Filename including extension. */
    filename: string;
}

/**
 * A single audiobook.  An audiobook is a folder (or a single audio file) that
 * groups one or more audio files (mp3 / m4a / m4b …).  Multiple files within
 * the same folder are treated as parts of one audiobook.
 */
export interface IMediaAudiobook {
    ids: {
        /** iTunes / Apple Books collection ID once matched. */
        itunes: string | null;
    }
    /** Display title (folder name, or provider title once matched). */
    title: string;
    /** Title parsed from the local folder/filename during scanning. */
    scannedTitle?: string;
    /** Author / narrator, populated from the metadata provider when available. */
    author?: string;
    /**
     * Stable key that groups the audio files of this audiobook.  Derived from the
     * relative folder path during scanning.  Used as the Redux/list key and as the
     * override namespace (`audiobook:<folderKey>`).
     */
    folderKey: string;
    /** Primary file URI used when the audiobook is opened directly (first part). */
    path: string;
    /** All audio files that make up this audiobook, ordered naturally by filename. */
    files: IAudiobookFile[];
    /** Local file URI for the downloaded cover art (empty string when none). */
    poster: string;
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
  /**
   * Metadata provider configured on the source folder that produced this episode.
   * Stamped on the show entry so MetadataService can pick the right provider.
   * Absent means use the global setting.
   */
  metadataSource?: dataSources;
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

export type contentTypes = 'tv' | 'movie' | 'audiobook';
export type dataSources = 'tmdb' | 'tvdb';
export type viewTypes = 'flat' | 'show' | 'show+season' | 'show/season';
export type viewOrientations = 'poster' | 'banner';

// Define a type for the slice state
interface LibraryState {
  mediaLibrary: IMediaLibrary;
  movies: IMediaObject[];
  audiobooks: IMediaAudiobook[];
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

export const INITIAL_SCAN_PROGRESS: ScanProgress = {
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
  audiobooks: [],
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
    setAudiobooks: (state, action: PayloadAction<IMediaAudiobook[]>) => {
      state.audiobooks = action.payload;
    },
    /**
     * Appends a batch of audiobooks, deduplicating by folderKey so re-scanning
     * an overlapping source is safe.
     */
    appendAudiobookBatch: (state, action: PayloadAction<IMediaAudiobook[]>) => {
      const existingKeys = new Set(state.audiobooks.map((a) => a.folderKey));
      for (const audiobook of action.payload) {
        if (!existingKeys.has(audiobook.folderKey)) {
          state.audiobooks.push(audiobook);
          existingKeys.add(audiobook.folderKey);
        }
      }
    },
    /** Updates the cover-art poster URI for a single audiobook by its folder key. */
    setAudiobookPoster: (state, action: PayloadAction<{ folderKey: string; poster: string }>) => {
      const audiobook = state.audiobooks.find((a) => a.folderKey === action.payload.folderKey);
      if (audiobook) audiobook.poster = action.payload.poster;
    },
    /** Updates audiobook metadata (provider ID, title, author, cover) after a match. */
    updateAudiobookMetadata: (state, action: PayloadAction<{
      folderKey: string;
      itunesId?: string;
      title?: string;
      author?: string;
      /** When omitted the existing poster is left unchanged. */
      poster?: string;
    }>) => {
      const audiobook = state.audiobooks.find((a) => a.folderKey === action.payload.folderKey);
      if (audiobook) {
        if (action.payload.itunesId !== undefined) audiobook.ids.itunes = action.payload.itunesId || null;
        if (action.payload.title) audiobook.title = action.payload.title;
        if (action.payload.author) audiobook.author = action.payload.author;
        if (action.payload.poster !== undefined) audiobook.poster = action.payload.poster;
      }
    },
    clearAudiobookMetadata: (state, action: PayloadAction<string>) => {
      const audiobook = state.audiobooks.find((a) => a.folderKey === action.payload);
      if (!audiobook) return;
      audiobook.poster = '';
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
    updateShowMetadata: (state, action: PayloadAction<{
      showName: string;
      /** The provider-specific ID string (written to ids.tmdb or ids.tvdb based on source). */
      providerId?: string;
      /**
       * @deprecated Use `providerId` instead. Retained for backward compatibility.
       * When both are provided, `providerId` takes precedence.
       */
      tmdbId?: string;
      /** Which provider resolved this metadata. Defaults to 'tmdb' for backward compatibility. */
      source?: dataSources;
      /** When omitted the existing poster is left unchanged. */
      poster?: string;
      title?: string;
      year?: number;
    }>) => {
      const show = state.mediaLibrary[action.payload.showName];
      if (show) {
        const source = action.payload.source ?? 'tmdb';
        const rawId = action.payload.providerId ?? action.payload.tmdbId;
        const id = rawId === undefined || rawId === '' ? null : rawId;
        if (source === 'tvdb') {
          show.ids.tvdb = id;
          show.ids.tmdb = null;
        } else {
          show.ids.tmdb = id;
          show.ids.tvdb = null;
        }
        if (action.payload.poster !== undefined) show.poster = action.payload.poster;
        if (action.payload.title) show.title = action.payload.title;
        if (action.payload.year) show.year = action.payload.year;
      } else {
        console.warn(`[libraryReducer] updateShowMetadata: show "${action.payload.showName}" not found`);
      }
    },
    updateMovieMetadata: (state, action: PayloadAction<{
      path: string;
      /** The provider-specific ID string (written to ids.tmdb or ids.tvdb based on source). */
      providerId?: string;
      /**
       * @deprecated Use `providerId` instead. Retained for backward compatibility.
       * When both are provided, `providerId` takes precedence.
       */
      tmdbId?: string;
      /** Which provider resolved this metadata. Defaults to 'tmdb' for backward compatibility. */
      source?: dataSources;
      /** When omitted the existing poster is left unchanged. */
      poster?: string;
    }>) => {
      const movie = state.movies.find((m) => m.path === action.payload.path);
      if (movie) {
        const source = action.payload.source ?? 'tmdb';
        const rawId = action.payload.providerId ?? action.payload.tmdbId;
        const id = rawId === undefined || rawId === '' ? null : rawId;
        if (source === 'tvdb') {
          movie.ids.tvdb = id;
          movie.ids.tmdb = null;
        } else {
          movie.ids.tmdb = id;
          movie.ids.tvdb = null;
        }
        if (action.payload.poster !== undefined) movie.poster = action.payload.poster;
      }
    },
    setMediaOverride: (state, action: PayloadAction<{ key: string; override: IMediaOverride }>) => {
      const existingOverride = state.mediaOverrides[action.payload.key] ?? {};
      const mergedOverride: IMediaOverride = {
        ...existingOverride,
        ...action.payload.override,
      };
      if ('tmdbId' in action.payload.override && action.payload.override.tmdbId !== undefined) {
        mergedOverride.tvdbId = undefined;
      } else if ('tvdbId' in action.payload.override && action.payload.override.tvdbId !== undefined) {
        mergedOverride.tmdbId = undefined;
      }
      state.mediaOverrides[action.payload.key] = mergedOverride;
    },
    clearMediaOverride: (state, action: PayloadAction<string>) => {
      delete state.mediaOverrides[action.payload];
    },
    clearShowMetadata: (state, action: PayloadAction<string>) => {
      const show = state.mediaLibrary[action.payload];
      if (!show) return;
      show.poster = '';
      for (const season of Object.values(show.seasons) as IMediaSeason[]) {
        for (const ep of Object.values(season.episodes) as IMediaObject[]) {
          ep.resolvedTitle = undefined;
          ep.resolvedThumbnail = undefined;
        }
      }
    },
    clearMovieMetadata: (state, action: PayloadAction<string>) => {
      const movie = state.movies.find((m) => m.path === action.payload);
      if (!movie) return;
      movie.poster = '';
    },
    clearEpisodeMetadata: (state, action: PayloadAction<string>) => {
      for (const show of Object.values(state.mediaLibrary) as IMediaShow[]) {
        for (const season of Object.values(show.seasons) as IMediaSeason[]) {
          const episode = Object.values(season.episodes as { [key: string]: IMediaObject }).find((ep) => ep.path === action.payload);
          if (episode) {
            episode.resolvedTitle = undefined;
            episode.resolvedThumbnail = undefined;
            return;
          }
        }
      }
    },
    /**
     * Clears both the TV library and the movie list.  Dispatched at the start
     * of each scan so stale data is not shown before streaming results arrive.
     */
    clearLibraryAndMovies: (state) => {
      state.mediaLibrary = {};
      state.movies = [];
      state.audiobooks = [];
    },
    /**
     * Incrementally upserts a batch of TV episodes into the library.
     * Creates show and season scaffolding as needed; skips duplicate episode keys.
     * Used to stream discovered episodes to the UI during scanning.
     */
    mergeEpisodeBatch: (state, action: PayloadAction<MergeEpisodePayload[]>) => {
      for (const { showName, rawShowName, folderYear, folderPoster, seasonKey, seasonNumber, episodeKey, episode, metadataSource } of action.payload) {
        if (!state.mediaLibrary[showName]) {
          state.mediaLibrary[showName] = {
            ids: { tvdb: null, imdb: null, tmdb: null },
            title: showName,
            year: folderYear,
            poster: folderPoster,
            seasons: {},
            rawNames: rawShowName !== showName ? [rawShowName] : [],
            metadataSource,
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
     * Clears provider-sourced episode metadata (title and thumbnail) for every
     * episode in every season of the specified show. Called before re-enriching a show
     * after a manual rematch so stale data from the old match does not persist.
     */
    clearShowEpisodeMetadata: (state, action: PayloadAction<string>) => {
      const show = state.mediaLibrary[action.payload];
      if (!show) return;
      for (const season of Object.values(show.seasons) as IMediaSeason[]) {
        for (const ep of Object.values(season.episodes) as IMediaObject[]) {
          ep.resolvedTitle = undefined;
          ep.resolvedThumbnail = undefined;
        }
      }
    },
    /**
     * Clears all cached poster data:
     * - Removes the `poster` field from every entry in `mediaOverrides`.
     * - Resets the poster URI to an empty string for every show and movie in the library.
     * - Clears provider-sourced episode thumbnails from every episode.
     * Call this after deleting the smb_posters and smb_thumbnails_tmdb directories from disk.
     */
    clearPosterOverrides: (state) => {
      for (const key of Object.keys(state.mediaOverrides)) {
        delete state.mediaOverrides[key].poster;
      }
      for (const show of Object.values(state.mediaLibrary) as IMediaShow[]) {
        show.poster = '';
        for (const season of Object.values(show.seasons) as IMediaSeason[]) {
          for (const ep of Object.values(season.episodes) as IMediaObject[]) {
            ep.resolvedThumbnail = undefined;
          }
        }
      }
      for (const movie of state.movies) {
        movie.poster = '';
      }
      for (const audiobook of state.audiobooks) {
        audiobook.poster = '';
      }
    },
    /**
     * Batch-updates episode metadata (title and/or thumbnail) for all
     * episodes in one season fetched from the provider season endpoint.
     * This is dispatched once per season after a single API call, avoiding
     * the need for individual per-episode API calls.
     */
    updateSeasonEpisodeMetadata: (
      state,
      action: PayloadAction<{
        showName: string;
        seasonKey: string;
        episodeUpdates: { [episodeKey: string]: { resolvedTitle?: string; resolvedThumbnail?: string } };
      }>,
    ) => {
      const { showName, seasonKey, episodeUpdates } = action.payload;
      const season = state.mediaLibrary[showName]?.seasons[seasonKey];
      if (!season) return;
      for (const [epKey, update] of Object.entries(episodeUpdates)) {
        const ep = season.episodes[epKey];
        if (!ep) continue;
        if (update.resolvedTitle !== undefined) ep.resolvedTitle = update.resolvedTitle;
        if (update.resolvedThumbnail !== undefined) ep.resolvedThumbnail = update.resolvedThumbnail;
      }
    },
    /**
     * Clears all cached TVDB poster and episode thumbnail data:
     * - Resets the poster URI to empty for shows whose metadata source is 'tvdb'.
     * - Clears provider-sourced episode thumbnails from every episode for TVDB-sourced shows.
     * Call this after deleting the smb_posters_tvdb and smb_thumbnails_tvdb directories from disk.
     */
    clearTvdbPosterOverrides: (state) => {
      for (const show of Object.values(state.mediaLibrary) as IMediaShow[]) {
        if (show.metadataSource === 'tvdb') {
          show.poster = '';
          for (const season of Object.values(show.seasons) as IMediaSeason[]) {
            for (const ep of Object.values(season.episodes) as IMediaObject[]) {
              ep.resolvedThumbnail = undefined;
            }
          }
        }
      }
    },
  },
})

export const { addToScanList, setScanList, clearScanList, setMediaLibrary, setMovies, setAudiobooks, appendAudiobookBatch, setAudiobookPoster, updateAudiobookMetadata, clearAudiobookMetadata, setIsScanning, setScanProgress, setThumbnail, clearThumbnails, updateShowMetadata, updateMovieMetadata, setMediaOverride, clearMediaOverride, clearShowMetadata, clearMovieMetadata, clearEpisodeMetadata, clearLibraryAndMovies, mergeEpisodeBatch, appendMovieBatch, updateShowPoster, setMoviePoster, mergeDuplicateShows, clearPosterOverrides, clearTvdbPosterOverrides, clearAllOverrides, updateSeasonEpisodeMetadata, clearShowEpisodeMetadata } = settingsSlice.actions;

// Other code such as selectors can use the imported `RootState` type
export const selectScanList = (state: RootState) => state.libraryReducer.scanList;
export const selectMediaLibrary = (state: RootState) => state.libraryReducer.mediaLibrary;
export const selectMovies = (state: RootState) => state.libraryReducer.movies;
export const selectAudiobooks = (state: RootState) => state.libraryReducer.audiobooks ?? [];
export const selectIsScanning = (state: RootState) => state.libraryReducer.isScanning;
export const selectThumbnails = (state: RootState) => state.libraryReducer.thumbnails;
export const selectMediaOverrides = (state: RootState) => state.libraryReducer.mediaOverrides;
export const selectScanProgress = (state: RootState) => state.libraryReducer.scanProgress;

export default settingsSlice.reducer