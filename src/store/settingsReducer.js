import { createSlice } from '@reduxjs/toolkit';
// Define the initial state using that type
const initialState = {
    settingsPassword: null,
    mediaSources: [],
    dataSource: 'tmdb',
    viewType: 'show/season',
    viewScale: 5,
    viewOrientation: 'poster',
    tmdbApiKey: null,
    defaultPage: 'home',
    enablePosterFetching: true,
    enableThumbnailGeneration: false,
};
export const settingsSlice = createSlice({
    name: 'settings',
    // `createSlice` will infer the state type from the `initialState` argument
    initialState,
    reducers: {
        // Use the PayloadAction type to declare the contents of `action.payload`
        addMediaSource: (state, action) => {
            state.mediaSources.push(action.payload);
        },
        removeMediaSource: (state, action) => {
            state.mediaSources = state.mediaSources.filter((s) => s.uri !== action.payload);
        },
        setPassword: (state, action) => {
            state.settingsPassword = action.payload;
        },
        setDataSource: (state, action) => {
            state.dataSource = action.payload;
        },
        setMediaStructure: (state, action) => {
            state.viewType = action.payload;
        },
        setViewOrientation: (state, action) => {
            state.viewOrientation = action.payload;
        },
        setViewScale: (state, action) => {
            state.viewScale = action.payload;
        },
        setTmdbApiKey: (state, action) => {
            state.tmdbApiKey = action.payload;
        },
        setDefaultPage: (state, action) => {
            state.defaultPage = action.payload;
        },
        setEnablePosterFetching: (state, action) => {
            state.enablePosterFetching = action.payload;
        },
        setEnableThumbnailGeneration: (state, action) => {
            state.enableThumbnailGeneration = action.payload;
        },
    },
});
export const { addMediaSource, removeMediaSource, setPassword, setDataSource, setMediaStructure, setViewOrientation, setViewScale, setTmdbApiKey, setDefaultPage, setEnablePosterFetching, setEnableThumbnailGeneration } = settingsSlice.actions;
// Other code such as selectors can use the imported `RootState` type
export const selectMediaSources = (state) => state.settingsReducer.mediaSources ?? [];
export const selectPassword = (state) => state.settingsReducer.settingsPassword ?? null;
export const selectDataSource = (state) => state.settingsReducer.dataSource ?? 'tmdb';
export const selectMediaStructure = (state) => state.settingsReducer.viewType ?? 'show/season';
export const selectViewOrientation = (state) => state.settingsReducer.viewOrientation ?? 'poster';
export const selectViewScale = (state) => state.settingsReducer.viewScale ?? 5;
export const selectTmdbApiKey = (state) => state.settingsReducer.tmdbApiKey ?? null;
export const selectDefaultPage = (state) => state.settingsReducer.defaultPage ?? 'home';
export const selectEnablePosterFetching = (state) => state.settingsReducer.enablePosterFetching ?? true;
export const selectEnableThumbnailGeneration = (state) => state.settingsReducer.enableThumbnailGeneration ?? false;
export default settingsSlice.reducer;
