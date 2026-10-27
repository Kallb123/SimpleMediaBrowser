import { createSlice, PayloadAction } from '@reduxjs/toolkit'
import type { RootState } from './store'

export type contentTypes = 'tv' | 'movie' | 'audiobook' | 'personal';
export type dataSources = 'tmdb' | 'tvdb';
export type viewTypes = 'flat' | 'show' | 'show+season' | 'show/season';
export type viewOrientations = 'poster' | 'list';
export type defaultPages = 'home' | 'tv' | 'movies' | 'audiobooks' | 'personal';
/** How the Personal library is browsed: mirroring the on-disk folder tree, or as one flat list of videos. */
export type personalLayouts = 'folders' | 'flat';
export type appColorSchemes = 'light' | 'dark' | 'system';
/** How audiobooks are played: in the app's own player (with resume) or handed to an external app. */
export type audiobookPlayers = 'inapp' | 'external';
/** How movies and episodes are played: in the app's own player (with resume) or handed to an external app. */
export type videoPlayers = 'inapp' | 'external';
/**
 * Temporary experiment switch for issue 244. 'legacy' keeps focused inputs clear of the keyboard with
 * `useKeyboardAwareScroll` + `KeyboardAvoidingView`; 'library' uses react-native-keyboard-controller's
 * `KeyboardAwareScrollView` instead.
 */
export type keyboardHandlingModes = 'legacy' | 'library';
/**
 * What the in-app video player does when an episode reaches its end credits: nothing, offer the
 * next episode ("Up next" card), or offer it and start it automatically after a countdown.
 */
export type videoAutoPlayNextModes = 'off' | 'prompt' | 'countdown';
export type sortOrders = 'alphabetical' | 'reverseAlphabetical' | 'lastOpened' | 'reverseLastOpened' | 'recentlyAdded';

export interface IMediaSource {
  uri: string;
  contentType: contentTypes;
  /**
   * Metadata provider to use for this library folder.
   * When absent the global `dataSource` setting is used.
   */
  metadataSource?: dataSources;
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
  tvdbApiKey: string | null
  tvdbPin: string | null
  defaultPage: defaultPages
  enablePosterFetching: boolean
  enableThumbnailGeneration: boolean
  rescanOnStartup: boolean
  fetchEpisodeNames: boolean
  fetchEpisodeThumbnails: boolean
  appColorScheme: appColorSchemes
  sortOrder: sortOrders
  bedtimeEnabled: boolean
  /** "HH:MM" local time at which bedtime mode starts. */
  bedtimeStart: string
  /** "HH:MM" local time at which bedtime mode ends (may be earlier than start to cross midnight). */
  bedtimeEnd: string
  /** Content types that stay accessible while bedtime mode is in effect. */
  bedtimeAllowedTypes: contentTypes[]
  videoPlayer: videoPlayers
  audiobookPlayer: audiobookPlayers
  keyboardHandling: keyboardHandlingModes
  /** In-app audiobook playback speed (1 = normal). */
  audiobookPlaybackRate: number
  /** Seconds the in-app audiobook player steps back when resuming after a pause; 0 = off. */
  audiobookRewindSeconds: number
  /**
   * Preferred subtitle language for the in-app video player: null = never chosen (keep the
   * player's default), 'off' = subtitles turned off, otherwise a language code from the track.
   */
  videoSubtitleLanguage: string | null
  /** Preferred audio language for the in-app video player; null = never chosen (keep the default). */
  videoAudioLanguage: string | null
  /** Show the resume progress bar on movie / episode tiles and rows. */
  videoShowProgressBar: boolean
  /** Offer the subtitle / audio track picker (and apply the remembered languages) in the in-app video player. */
  videoTrackPickerEnabled: boolean
  /** Offer a playback speed control in the in-app video player (off = always normal speed). */
  videoSpeedControlEnabled: boolean
  /** In-app video playback speed (1 = normal), remembered across videos. */
  videoPlaybackRate: number
  videoAutoPlayNext: videoAutoPlayNextModes
  /** Show a sort-order dropdown in the drawer (sidebar) for quick switching. */
  showSidebarSort: boolean
  personalLayout: personalLayouts
}

// Define the initial state using that type
const initialState: SettingsState = {
  settingsPassword: null,
  mediaSources: [],
  dataSource: 'tmdb',
  viewType: 'show/season',
  viewScale: 5,
  viewOrientation: 'poster',
  tmdbApiKey: null,
  tvdbApiKey: null,
  tvdbPin: null,
  defaultPage: 'home',
  enablePosterFetching: true,
  enableThumbnailGeneration: false,
  rescanOnStartup: true,
  fetchEpisodeNames: true,
  fetchEpisodeThumbnails: true,
  appColorScheme: 'system',
  sortOrder: 'alphabetical',
  bedtimeEnabled: false,
  bedtimeStart: '19:00',
  bedtimeEnd: '07:00',
  bedtimeAllowedTypes: ['audiobook'],
  videoPlayer: 'inapp',
  audiobookPlayer: 'inapp',
  keyboardHandling: 'legacy',
  audiobookPlaybackRate: 1,
  audiobookRewindSeconds: 10,
  videoSubtitleLanguage: null,
  videoAudioLanguage: null,
  videoShowProgressBar: true,
  videoTrackPickerEnabled: true,
  videoSpeedControlEnabled: true,
  videoPlaybackRate: 1,
  videoAutoPlayNext: 'prompt',
  showSidebarSort: false,
  personalLayout: 'folders',
}

// Stable fallback for persisted state that predates bedtime mode, so selectors don't
// return a fresh array (and force re-renders) on every call.
const DEFAULT_BEDTIME_ALLOWED_TYPES: contentTypes[] = ['audiobook'];

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
    updateMediaSourceMetadata: (state, action: PayloadAction<{ uri: string; metadataSource: dataSources | undefined }>) => {
      const source = state.mediaSources.find((s) => s.uri === action.payload.uri);
      if (source) {
        source.metadataSource = action.payload.metadataSource;
      }
    },
    setPassword: (state, action: PayloadAction<string | null>) => {
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
    setTvdbApiKey: (state, action: PayloadAction<string | null>) => {
      state.tvdbApiKey = action.payload;
    },
    setTvdbPin: (state, action: PayloadAction<string | null>) => {
      state.tvdbPin = action.payload;
    },
    setDefaultPage: (state, action: PayloadAction<defaultPages>) => {
      state.defaultPage = action.payload;
    },
    setEnablePosterFetching: (state, action: PayloadAction<boolean>) => {
      state.enablePosterFetching = action.payload;
    },
    setEnableThumbnailGeneration: (state, action: PayloadAction<boolean>) => {
      state.enableThumbnailGeneration = action.payload;
    },
    setRescanOnStartup: (state, action: PayloadAction<boolean>) => {
      state.rescanOnStartup = action.payload;
    },
    setFetchEpisodeNames: (state, action: PayloadAction<boolean>) => {
      state.fetchEpisodeNames = action.payload;
    },
    setFetchEpisodeThumbnails: (state, action: PayloadAction<boolean>) => {
      state.fetchEpisodeThumbnails = action.payload;
    },
    setAppColorScheme: (state, action: PayloadAction<appColorSchemes>) => {
      state.appColorScheme = action.payload;
    },
    setSortOrder: (state, action: PayloadAction<sortOrders>) => {
      state.sortOrder = action.payload;
    },
    setBedtimeEnabled: (state, action: PayloadAction<boolean>) => {
      state.bedtimeEnabled = action.payload;
    },
    setBedtimeStart: (state, action: PayloadAction<string>) => {
      state.bedtimeStart = action.payload;
    },
    setBedtimeEnd: (state, action: PayloadAction<string>) => {
      state.bedtimeEnd = action.payload;
    },
    setBedtimeAllowedTypes: (state, action: PayloadAction<contentTypes[]>) => {
      state.bedtimeAllowedTypes = action.payload;
    },
    setVideoPlayer: (state, action: PayloadAction<videoPlayers>) => {
      state.videoPlayer = action.payload;
    },
    setAudiobookPlayer: (state, action: PayloadAction<audiobookPlayers>) => {
      state.audiobookPlayer = action.payload;
    },
    setKeyboardHandling: (state, action: PayloadAction<keyboardHandlingModes>) => {
      state.keyboardHandling = action.payload;
    },
    setAudiobookPlaybackRate: (state, action: PayloadAction<number>) => {
      if (!Number.isFinite(action.payload)) return;
      state.audiobookPlaybackRate = Math.min(2, Math.max(0.5, action.payload));
    },
    setAudiobookRewindSeconds: (state, action: PayloadAction<number>) => {
      if (!Number.isFinite(action.payload)) return;
      state.audiobookRewindSeconds = Math.min(300, Math.max(0, Math.round(action.payload)));
    },
    setVideoSubtitleLanguage: (state, action: PayloadAction<string | null>) => {
      state.videoSubtitleLanguage = action.payload;
    },
    setVideoAudioLanguage: (state, action: PayloadAction<string | null>) => {
      state.videoAudioLanguage = action.payload;
    },
    setVideoShowProgressBar: (state, action: PayloadAction<boolean>) => {
      state.videoShowProgressBar = action.payload;
    },
    setVideoTrackPickerEnabled: (state, action: PayloadAction<boolean>) => {
      state.videoTrackPickerEnabled = action.payload;
    },
    setVideoSpeedControlEnabled: (state, action: PayloadAction<boolean>) => {
      state.videoSpeedControlEnabled = action.payload;
    },
    setVideoPlaybackRate: (state, action: PayloadAction<number>) => {
      if (!Number.isFinite(action.payload)) return;
      state.videoPlaybackRate = Math.min(2, Math.max(0.5, action.payload));
    },
    setVideoAutoPlayNext: (state, action: PayloadAction<videoAutoPlayNextModes>) => {
      state.videoAutoPlayNext = action.payload;
    },
    setShowSidebarSort: (state, action: PayloadAction<boolean>) => {
      state.showSidebarSort = action.payload;
    },
    setPersonalLayout: (state, action: PayloadAction<personalLayouts>) => {
      state.personalLayout = action.payload;
    },
  },
})

export const { addMediaSource, removeMediaSource, updateMediaSourceMetadata, setPassword, setDataSource, setMediaStructure, setViewOrientation, setViewScale, setTmdbApiKey, setTvdbApiKey, setTvdbPin, setDefaultPage, setEnablePosterFetching, setEnableThumbnailGeneration, setRescanOnStartup, setFetchEpisodeNames, setFetchEpisodeThumbnails, setAppColorScheme, setSortOrder, setBedtimeEnabled, setBedtimeStart, setBedtimeEnd, setBedtimeAllowedTypes, setVideoPlayer, setAudiobookPlayer, setKeyboardHandling, setAudiobookPlaybackRate, setAudiobookRewindSeconds, setVideoSubtitleLanguage, setVideoAudioLanguage, setVideoShowProgressBar, setVideoTrackPickerEnabled, setVideoSpeedControlEnabled, setVideoPlaybackRate, setVideoAutoPlayNext, setShowSidebarSort, setPersonalLayout } = settingsSlice.actions;

// Other code such as selectors can use the imported `RootState` type
export const selectMediaSources = (state: RootState) => state.settingsReducer.mediaSources ?? [];
export const selectPassword = (state: RootState) => state.settingsReducer.settingsPassword ?? null;
export const selectDataSource = (state: RootState) => state.settingsReducer.dataSource ?? 'tmdb';
export const selectMediaStructure = (state: RootState) => state.settingsReducer.viewType ?? 'show/season';
export const selectViewOrientation = (state: RootState): viewOrientations => {
  const v = state.settingsReducer.viewOrientation;
  // Coerce legacy 'banner' value (persisted before the Poster/List change) to 'poster'.
  return (v === 'poster' || v === 'list') ? v : 'poster';
};
export const selectViewScale = (state: RootState) => state.settingsReducer.viewScale ?? 5;
export const selectTmdbApiKey = (state: RootState) => state.settingsReducer.tmdbApiKey ?? null;
export const selectTvdbApiKey = (state: RootState) => state.settingsReducer.tvdbApiKey ?? null;
export const selectTvdbPin = (state: RootState) => state.settingsReducer.tvdbPin ?? null;
export const selectDefaultPage = (state: RootState) => state.settingsReducer.defaultPage ?? 'home';
export const selectEnablePosterFetching = (state: RootState) => state.settingsReducer.enablePosterFetching ?? true;
export const selectEnableThumbnailGeneration = (state: RootState) => state.settingsReducer.enableThumbnailGeneration ?? false;
export const selectRescanOnStartup = (state: RootState) => state.settingsReducer.rescanOnStartup ?? true;
export const selectFetchEpisodeNames = (state: RootState) => state.settingsReducer.fetchEpisodeNames ?? true;
export const selectFetchEpisodeThumbnails = (state: RootState) => state.settingsReducer.fetchEpisodeThumbnails ?? true;
export const selectAppColorScheme = (state: RootState): appColorSchemes =>
  (state.settingsReducer.appColorScheme ?? 'system') as appColorSchemes;
export const selectSortOrder = (state: RootState): sortOrders =>
  (state.settingsReducer.sortOrder ?? 'alphabetical') as sortOrders;
export const selectVideoPlayer = (state: RootState): videoPlayers => state.settingsReducer.videoPlayer ?? 'inapp';
export const selectAudiobookPlayer = (state: RootState): audiobookPlayers => state.settingsReducer.audiobookPlayer ?? 'inapp';
// Anything but 'library' (missing, or a stale/corrupt persisted value) means the existing behaviour.
export const selectKeyboardHandling = (state: RootState): keyboardHandlingModes =>
  state.settingsReducer.keyboardHandling === 'library' ? 'library' : 'legacy';
export const selectAudiobookPlaybackRate = (state: RootState): number => state.settingsReducer.audiobookPlaybackRate ?? 1;
export const selectAudiobookRewindSeconds = (state: RootState): number => state.settingsReducer.audiobookRewindSeconds ?? 10;
export const selectVideoSubtitleLanguage = (state: RootState): string | null => state.settingsReducer.videoSubtitleLanguage ?? null;
export const selectVideoAudioLanguage = (state: RootState): string | null => state.settingsReducer.videoAudioLanguage ?? null;
export const selectVideoShowProgressBar = (state: RootState): boolean => state.settingsReducer.videoShowProgressBar ?? true;
export const selectVideoTrackPickerEnabled = (state: RootState): boolean => state.settingsReducer.videoTrackPickerEnabled ?? true;
export const selectVideoSpeedControlEnabled = (state: RootState): boolean => state.settingsReducer.videoSpeedControlEnabled ?? true;
export const selectVideoPlaybackRate = (state: RootState): number => state.settingsReducer.videoPlaybackRate ?? 1;
// A missing or stale/corrupt persisted value means the default ('prompt').
export const selectVideoAutoPlayNext = (state: RootState): videoAutoPlayNextModes => {
  const mode = state.settingsReducer.videoAutoPlayNext;
  return mode === 'off' || mode === 'countdown' ? mode : 'prompt';
};
export const selectShowSidebarSort = (state: RootState): boolean => state.settingsReducer.showSidebarSort ?? false;
// Anything but 'flat' (missing, or a stale/corrupt persisted value) means the default ('folders').
export const selectPersonalLayout = (state: RootState): personalLayouts =>
  state.settingsReducer.personalLayout === 'flat' ? 'flat' : 'folders';
export const selectBedtimeEnabled = (state: RootState) => state.settingsReducer.bedtimeEnabled ?? false;
export const selectBedtimeStart = (state: RootState) => state.settingsReducer.bedtimeStart ?? '19:00';
export const selectBedtimeEnd = (state: RootState) => state.settingsReducer.bedtimeEnd ?? '07:00';
export const selectBedtimeAllowedTypes = (state: RootState) =>
  state.settingsReducer.bedtimeAllowedTypes ?? DEFAULT_BEDTIME_ALLOWED_TYPES;

export default settingsSlice.reducer