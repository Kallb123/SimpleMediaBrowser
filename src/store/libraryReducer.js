import { createSlice } from '@reduxjs/toolkit';
import { REHYDRATE } from 'redux-persist';
const INITIAL_SCAN_PROGRESS = {
    phase: 'idle',
    filesFound: 0,
    thumbnailsDone: 0,
    thumbnailsTotal: 0,
    metadataDone: 0,
    metadataTotal: 0,
};
// Define the initial state using that type
const initialState = {
    mediaLibrary: {},
    movies: [],
    scanList: [],
    isScanning: false,
    thumbnails: {},
    mediaOverrides: {},
    scanProgress: INITIAL_SCAN_PROGRESS,
};
export const settingsSlice = createSlice({
    name: 'settings',
    // `createSlice` will infer the state type from the `initialState` argument
    initialState,
    reducers: {
        // Use the PayloadAction type to declare the contents of `action.payload`
        addToScanList: (state, action) => {
            state.scanList.push(action.payload);
        },
        setScanList: (state, action) => {
            state.scanList = action.payload;
        },
        clearScanList: (state, action) => {
            state.scanList = [];
        },
        setMediaLibrary: (state, action) => {
            state.mediaLibrary = action.payload;
        },
        setMovies: (state, action) => {
            state.movies = action.payload;
        },
        setIsScanning: (state, action) => {
            state.isScanning = action.payload;
            // Reset progress to idle when scanning stops so stale values are not shown
            // on the next scan's initial render.
            if (!action.payload) {
                state.scanProgress = INITIAL_SCAN_PROGRESS;
            }
        },
        setScanProgress: (state, action) => {
            state.scanProgress = action.payload;
        },
        setThumbnail: (state, action) => {
            state.thumbnails[action.payload.path] = action.payload.uri;
        },
        clearThumbnails: (state) => {
            state.thumbnails = {};
        },
        updateShowMetadata: (state, action) => {
            const show = state.mediaLibrary[action.payload.showName];
            if (show) {
                show.ids.tmdb = action.payload.tmdbId;
                show.poster = action.payload.poster;
            }
            else {
                console.warn(`[libraryReducer] updateShowMetadata: show "${action.payload.showName}" not found`);
            }
        },
        updateMovieMetadata: (state, action) => {
            const movie = state.movies.find((m) => m.path === action.payload.path);
            if (movie) {
                movie.ids.tmdb = action.payload.tmdbId;
                movie.poster = action.payload.poster;
            }
        },
        setMediaOverride: (state, action) => {
            state.mediaOverrides[action.payload.key] = {
                ...(state.mediaOverrides[action.payload.key] ?? {}),
                ...action.payload.override,
            };
        },
        clearMediaOverride: (state, action) => {
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
        mergeEpisodeBatch: (state, action) => {
            for (const { showName, folderPoster, seasonKey, seasonNumber, episodeKey, episode } of action.payload) {
                if (!state.mediaLibrary[showName]) {
                    state.mediaLibrary[showName] = {
                        ids: { tvdb: null, imdb: null, tmdb: null },
                        title: showName,
                        year: 0,
                        poster: folderPoster,
                        seasons: {},
                    };
                }
                else if (folderPoster && !state.mediaLibrary[showName].poster) {
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
        appendMovieBatch: (state, action) => {
            const existingPaths = new Set(state.movies.map((m) => m.path));
            for (const movie of action.payload) {
                if (!existingPaths.has(movie.path)) {
                    state.movies.push(movie);
                    existingPaths.add(movie.path);
                }
            }
        },
        /** Updates the poster URI for a show (e.g. when a local poster file is found during scanning). */
        updateShowPoster: (state, action) => {
            const show = state.mediaLibrary[action.payload.showName];
            if (show)
                show.poster = action.payload.poster;
        },
        /** Updates the poster URI for a single movie by its file path. */
        setMoviePoster: (state, action) => {
            const movie = state.movies.find((m) => m.path === action.payload.path);
            if (movie)
                movie.poster = action.payload.poster;
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
});
export const { addToScanList, setScanList, clearScanList, setMediaLibrary, setMovies, setIsScanning, setScanProgress, setThumbnail, clearThumbnails, updateShowMetadata, updateMovieMetadata, setMediaOverride, clearMediaOverride, clearLibraryAndMovies, mergeEpisodeBatch, appendMovieBatch, updateShowPoster, setMoviePoster } = settingsSlice.actions;
// Other code such as selectors can use the imported `RootState` type
export const selectScanList = (state) => state.libraryReducer.scanList;
export const selectMediaLibrary = (state) => state.libraryReducer.mediaLibrary;
export const selectMovies = (state) => state.libraryReducer.movies;
export const selectIsScanning = (state) => state.libraryReducer.isScanning;
export const selectThumbnails = (state) => state.libraryReducer.thumbnails;
export const selectMediaOverrides = (state) => state.libraryReducer.mediaOverrides;
export const selectScanProgress = (state) => state.libraryReducer.scanProgress;
export default settingsSlice.reducer;
