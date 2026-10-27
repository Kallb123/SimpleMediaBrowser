import { Alert, BackHandler, Button, ScrollView, StyleSheet, Switch, TouchableOpacity, View, useWindowDimensions } from 'react-native';
import { HeaderBackButton, useHeaderHeight } from '@react-navigation/elements';
import Ionicons from '@expo/vector-icons/Ionicons';
import { ThemedTextInput } from '@/components/ThemedTextInput';
import { ThemedText } from '@/components/ThemedText';
import { ThemedView } from '@/components/ThemedView';
import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { router, useFocusEffect } from 'expo-router';
import { useNavigation } from '@react-navigation/native';
import { useDispatch, useSelector } from 'react-redux';
import { dataSources, IMediaSource, selectDataSource, selectMediaSources, selectMediaStructure, selectPassword, selectViewOrientation, selectViewScale, setDataSource, setMediaStructure, setPassword, setViewOrientation, setViewScale, viewOrientations, viewTypes, removeMediaSource, updateMediaSourceMetadata, selectTmdbApiKey, setTmdbApiKey, selectTvdbApiKey, setTvdbApiKey, selectTvdbPin, setTvdbPin, defaultPages, selectDefaultPage, setDefaultPage, selectEnablePosterFetching, setEnablePosterFetching, selectEnableThumbnailGeneration, setEnableThumbnailGeneration, selectRescanOnStartup, setRescanOnStartup, selectFetchEpisodeNames, setFetchEpisodeNames, selectFetchEpisodeThumbnails, setFetchEpisodeThumbnails, appColorSchemes, selectAppColorScheme, setAppColorScheme, videoPlayers, selectVideoPlayer, setVideoPlayer, audiobookPlayers, selectAudiobookPlayer, setAudiobookPlayer, keyboardHandlingModes, selectKeyboardHandling, setKeyboardHandling, selectAudiobookRewindSeconds, setAudiobookRewindSeconds, sortOrders, selectSortOrder, setSortOrder, contentTypes, selectBedtimeEnabled, setBedtimeEnabled, selectBedtimeStart, setBedtimeStart, selectBedtimeEnd, setBedtimeEnd, selectBedtimeAllowedTypes, setBedtimeAllowedTypes, videoAutoPlayNextModes, selectVideoShowProgressBar, setVideoShowProgressBar, selectVideoTrackPickerEnabled, setVideoTrackPickerEnabled, selectVideoSpeedControlEnabled, setVideoSpeedControlEnabled, selectVideoAutoPlayNext, setVideoAutoPlayNext, selectShowSidebarSort, setShowSidebarSort, personalLayouts, selectPersonalLayout, setPersonalLayout } from '@/store/settingsReducer';
import { clearLibraryAndMovies, clearPosterOverrides, clearTvdbPosterOverrides, clearThumbnails, clearAllOverrides } from '@/store/libraryReducer';
import Slider from '@react-native-community/slider';
import { useColorScheme } from '@/hooks/useColorScheme';
import { useTheme } from '@/hooks/use-theme';
import { Colors } from '@/constants/Colors';
import { sortOrderOptions } from '@/constants/sortOrderOptions';
import { AddMediaSource } from '@/components/ui/AddMediaSource';
import { Dropdown } from '@/components/Dropdown';
import { KeyboardAwareForm } from '@/components/KeyboardAwareForm';
import { useKeyboardAwareScroll } from '@/hooks/useKeyboardAwareScroll';
import { logger } from '@/scripts/Logger';
import Constants from 'expo-constants';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { thumbnailCache } from '@/scripts/thumbnailCache';
import { exportJson, importJson, exportToFilesystem } from '@/scripts/ImportExportService';
import type { JsonExportOptions } from '@/scripts/ImportExportService';
import { formatTimeOfDay, parseTimeOfDay } from '@/utils/bedtime';
import { LANDSCAPE_MAX_COLUMNS, LANDSCAPE_MIN_COLUMNS, PORTRAIT_MAX_COLUMNS, PORTRAIT_MIN_COLUMNS, mapScaleToColumns } from '@/utils/viewScale';

const DIVIDER_COLOR = 'rgba(128,128,128,0.35)';
const DESTRUCTIVE_COLOR = '#E55';

// Below this window width (or on a phone held sideways) the category list and a category's page
// are shown one at a time; on tablets they sit side by side, like Android's and iPadOS's own Settings.
const TWO_PANE_MIN_WIDTH = 720;
const TWO_PANE_MIN_SHORT_SIDE = 600;
const LIST_PANE_WIDTH = 320;

type IoniconName = React.ComponentProps<typeof Ionicons>['name'];

type SectionId = 'library' | 'metadata' | 'appearance' | 'browsing' | 'video' | 'audiobook' | 'parental' | 'backup' | 'troubleshooting';

const sections: { id: SectionId; title: string; icon: IoniconName }[] = [
  {id: 'library', title: 'Media folders', icon: 'folder-open-outline'},
  {id: 'metadata', title: 'Metadata', icon: 'cloud-download-outline'},
  {id: 'appearance', title: 'Appearance', icon: 'color-palette-outline'},
  {id: 'browsing', title: 'Browsing', icon: 'albums-outline'},
  {id: 'video', title: 'Video player', icon: 'film-outline'},
  {id: 'audiobook', title: 'Audiobook player', icon: 'headset-outline'},
  {id: 'parental', title: 'Parental controls', icon: 'lock-closed-outline'},
  {id: 'backup', title: 'Backup & restore', icon: 'swap-vertical-outline'},
  {id: 'troubleshooting', title: 'Troubleshooting', icon: 'construct-outline'},
];

const dataSourceOptions: { id: dataSources; label: string }[] = [
  {id: 'tmdb', label: 'TMDB'},
  {id: 'tvdb', label: 'TheTVDB'},
];

const metadataSourceOptions: { id: dataSources | 'auto'; label: string }[] = [
  { id: 'auto', label: '🌐 Auto' },
  { id: 'tmdb', label: 'TMDB' },
  { id: 'tvdb', label: 'TheTVDB' },
];

const viewTypeOptions: { id: viewTypes; label: string; title: string }[] = [
  {id: 'flat', label: 'Flat', title: 'All episodes of all shows visible in one list'},
  {id: 'show', label: 'Show', title: 'A folder for each show, with all episodes of that show then visible in each folder'},
  {id: 'show+season', label: 'Show + Season', title: 'A folder for each show and season, with the episodes of that season in the folder'},
  {id: 'show/season', label: 'Show/Season', title: 'A folder for each show, with a further folder for each season, with episodes then visible within'},
];

const uiTypeOptions: { id: viewOrientations; label: string }[] = [
  {id: 'poster', label: 'Poster'},
  {id: 'list', label: 'List'},
];

const defaultPageOptions: { id: defaultPages; label: string }[] = [
  {id: 'home', label: 'Library (All)'},
  {id: 'tv', label: 'TV'},
  {id: 'movies', label: 'Movies'},
  {id: 'audiobooks', label: 'Audiobooks'},
  {id: 'personal', label: 'Personal'},
];

const personalLayoutOptions: { id: personalLayouts; label: string; title: string }[] = [
  {id: 'folders', label: 'Folders', title: 'Mirrors the folders on disk: a tile for each folder, with its videos inside'},
  {id: 'flat', label: 'Flat list', title: 'Every Personal video in one list'},
];

const appColorSchemeOptions: { id: appColorSchemes; label: string }[] = [
  {id: 'system', label: 'System'},
  {id: 'light', label: 'Light'},
  {id: 'dark', label: 'Dark'},
];

const videoPlayerOptions: { id: videoPlayers; label: string }[] = [
  {id: 'inapp', label: 'In-app'},
  {id: 'external', label: 'External app'},
];

const keyboardHandlingOptions: { id: keyboardHandlingModes; label: string }[] = [
  {id: 'legacy', label: 'Built-in (current)'},
  {id: 'library', label: 'Keyboard-controller library'},
];

const audiobookPlayerOptions: { id: audiobookPlayers; label: string }[] = [
  {id: 'inapp', label: 'In-app'},
  {id: 'external', label: 'External app'},
];

const audiobookRewindOptions: { id: number; label: string }[] = [
  {id: 0, label: 'Off'},
  {id: 5, label: '5 s'},
  {id: 10, label: '10 s'},
  {id: 15, label: '15 s'},
  {id: 30, label: '30 s'},
  {id: 60, label: '60 s'},
];

const videoAutoPlayNextOptions: { id: videoAutoPlayNextModes; label: string }[] = [
  {id: 'off', label: 'Off'},
  {id: 'prompt', label: 'Up next'},
  {id: 'countdown', label: 'Countdown'},
];

const BEDTIME_STEP_MINUTES = 15;
const bedtimeGridTimes: string[] = Array.from(
  { length: (24 * 60) / BEDTIME_STEP_MINUTES },
  (_, i) => formatTimeOfDay(i * BEDTIME_STEP_MINUTES),
);

// Canonical order, also used to compare/persist the allowed-types selection.
const bedtimeTypeOptions: { id: contentTypes; label: string }[] = [
  {id: 'tv', label: 'TV'},
  {id: 'movie', label: 'Movies'},
  {id: 'audiobook', label: 'Audiobooks'},
  {id: 'personal', label: 'Personal'},
];

// "7:00" -> "07:00" so stored values line up with dropdown option ids; malformed values are left as-is.
const normaliseBedtimeTime = (value: string): string => {
  const minutes = parseTimeOfDay(value);
  return minutes === null ? value : formatTimeOfDay(minutes);
};

// 15-minute grid, plus any stored value that isn't on it (so it is still shown and selectable).
const buildBedtimeTimeOptions = (...stored: string[]): { id: string; label: string }[] => {
  const ids = new Set(bedtimeGridTimes);
  for (const value of stored) ids.add(normaliseBedtimeTime(value));
  return Array.from(ids)
    .sort((a, b) => (parseTimeOfDay(a) ?? Infinity) - (parseTimeOfDay(b) ?? Infinity))
    .map(id => ({ id, label: id }));
};

// Canonical-ordered, de-duplicated copy of an allowed-types selection.
const canonicalBedtimeTypes = (types: readonly contentTypes[]): contentTypes[] =>
  bedtimeTypeOptions.map(o => o.id).filter(id => types.includes(id));

const labelFor = <T,>(options: readonly { id: T; label: string }[], id: T): string =>
  options.find(o => o.id === id)?.label ?? '';

class SettingsErrorBoundary extends React.Component<{ children: React.ReactNode }, { hasError: boolean; message: string }> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, message: '' };
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, message: error.message || 'Unknown error' };
  }

  componentDidCatch(error: Error) {
    logger.error('Settings', 'Render exception caught by SettingsErrorBoundary', error);
  }

  render() {
    if (this.state.hasError) {
      return (
        <ThemedView style={styles.crashContainer}>
          <ThemedText type="title">Settings failed to load</ThemedText>
          <ThemedText style={styles.hintText}>Error: {this.state.message}</ThemedText>
          <ThemedText style={styles.hintText}>Open Debug Logs for stack details.</ThemedText>
        </ThemedView>
      );
    }

    return this.props.children;
  }
}

/** One preference: a label (with an optional explanation under it) and its control on the right. */
function SettingRow({ label, description, disabled, children }: {
  label: string;
  description?: string;
  disabled?: boolean;
  children?: React.ReactNode;
}) {
  return (
    <View style={styles.settingRow}>
      <View style={[styles.settingText, disabled && styles.disabled]}>
        <ThemedText style={styles.settingLabel}>{label}</ThemedText>
        {description ? <ThemedText style={styles.settingDescription}>{description}</ThemedText> : null}
      </View>
      {children}
    </View>
  );
}

function SwitchRow({ label, description, value, onValueChange, disabled }: {
  label: string;
  description?: string;
  value: boolean;
  onValueChange: (value: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <SettingRow label={label} description={description} disabled={disabled}>
      <Switch value={value} onValueChange={onValueChange} disabled={disabled} />
    </SettingRow>
  );
}

/** A small heading that splits a page into groups (like an Android preference category). */
function GroupHeading({ children }: { children: string }) {
  const tint = useTheme().textSecondary;
  return <ThemedText style={[styles.groupHeading, { color: tint }]} accessibilityRole="header">{children}</ThemedText>;
}

/** A tappable row for a one-off action (export, clear a cache...). */
function ActionRow({ title, description, onPress, destructive }: {
  title: string;
  description: string;
  onPress: () => void;
  destructive?: boolean;
}) {
  return (
    <TouchableOpacity style={styles.actionRow} onPress={onPress} accessibilityRole="button">
      <ThemedText style={[styles.actionTitle, destructive && styles.destructiveText]}>{title}</ThemedText>
      <ThemedText style={styles.settingDescription}>{description}</ThemedText>
    </TouchableOpacity>
  );
}

export default function SettingsPrompt() {
  const colorScheme = useColorScheme() === 'dark' ? 'dark' : 'light';
  const theme = Colors[colorScheme];
  const surfaces = useTheme();
  const appVersion = Constants.expoConfig?.version ?? 'unknown';
  const insets = useSafeAreaInsets();
  // See edititem.tsx for why we use the real header height here instead of
  // KeyboardAvoidingView's automaticOffset heuristic.
  const headerHeight = useHeaderHeight();
  const keyboard = useKeyboardAwareScroll();
  const { handleInputFocus, handleInputBlur } = keyboard;
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  const twoPane = windowWidth >= TWO_PANE_MIN_WIDTH && Math.min(windowWidth, windowHeight) >= TWO_PANE_MIN_SHORT_SIDE;

  // The category whose page is open. On a phone null means the category list is showing; in the
  // two-pane layout one page is always shown, so null falls back to the first category.
  const [activeSection, setActiveSection] = useState(null as SectionId | null);
  const shownSection: SectionId | null = activeSection ?? (twoPane ? sections[0].id : null);
  const shownSectionTitle = sections.find(s => s.id === shownSection)?.title ?? 'Settings';
  // Phone layout with a category page open: the header shows the category and a back arrow.
  const onSectionPage = !twoPane && shownSection !== null;

  const containerStyle = useMemo(
    () => [styles.container, { backgroundColor: theme.background }],
    [theme.background],
  );

  const [password, setLocalPassword] = useState(null as string | null);
  const [tmdbApiKey, setLocalTmdbApiKey] = useState(null as string | null);
  const [tvdbApiKey, setLocalTvdbApiKey] = useState(null as string | null);
  const [tvdbPin, setLocalTvdbPin] = useState(null as string | null);
  const [dataSource, setLocalDataSource] = useState("" as dataSources);
  const [mediaStructure, setLocalMediaStructure] = useState("" as viewTypes);
  const [viewOrientation, setLocalViewOrientation] = useState("" as viewOrientations);
  const [viewScale, setLocalViewScale] = useState(2);
  const [defaultPage, setLocalDefaultPage] = useState("home" as defaultPages);
  const [personalLayout, setLocalPersonalLayout] = useState('folders' as personalLayouts);
  const [enablePosterFetching, setLocalEnablePosterFetching] = useState(true);
  const [enableThumbnailGeneration, setLocalEnableThumbnailGeneration] = useState(false);
  const [rescanOnStartup, setLocalRescanOnStartup] = useState(true);
  const [fetchEpisodeNames, setLocalFetchEpisodeNames] = useState(true);
  const [fetchEpisodeThumbnails, setLocalFetchEpisodeThumbnails] = useState(true);
  const [appColorScheme, setLocalAppColorScheme] = useState('system' as appColorSchemes);
  const [sortOrder, setLocalSortOrder] = useState('alphabetical' as sortOrders);
  const [showSidebarSort, setLocalShowSidebarSort] = useState(false);
  const [videoPlayer, setLocalVideoPlayer] = useState('inapp' as videoPlayers);
  const [videoShowProgressBar, setLocalVideoShowProgressBar] = useState(true);
  const [videoTrackPickerEnabled, setLocalVideoTrackPickerEnabled] = useState(true);
  const [videoSpeedControlEnabled, setLocalVideoSpeedControlEnabled] = useState(true);
  const [videoAutoPlayNext, setLocalVideoAutoPlayNext] = useState('prompt' as videoAutoPlayNextModes);
  const [audiobookPlayer, setLocalAudiobookPlayer] = useState('inapp' as audiobookPlayers);
  const [keyboardHandling, setLocalKeyboardHandling] = useState('legacy' as keyboardHandlingModes);
  const [audiobookRewindSeconds, setLocalAudiobookRewindSeconds] = useState(10);
  const [bedtimeEnabled, setLocalBedtimeEnabled] = useState(false);
  const [bedtimeStart, setLocalBedtimeStart] = useState('19:00');
  const [bedtimeEnd, setLocalBedtimeEnd] = useState('07:00');
  const [bedtimeAllowedTypes, setLocalBedtimeAllowedTypes] = useState(['audiobook'] as contentTypes[]);
  const [scanning, setScanning] = useState(false);
  const [scanComplete, setScanComplete] = useState(false);
  const [exportIncludeSettings, setExportIncludeSettings] = useState(true);
  const [exportIncludeOverrides, setExportIncludeOverrides] = useState(true);
  const [exportIncludeWatched, setExportIncludeWatched] = useState(true);
  const [exportIncludeMatches, setExportIncludeMatches] = useState(true);

  const dispatch = useDispatch();
  const settingsPassword = useSelector(selectPassword);
  const mediaSources = useSelector(selectMediaSources);
  const settingsDataSource = useSelector(selectDataSource);
  const settingsTmdbApiKey = useSelector(selectTmdbApiKey);
  const settingsTvdbApiKey = useSelector(selectTvdbApiKey);
  const settingsTvdbPin = useSelector(selectTvdbPin);
  const settingsMediaStructure = useSelector(selectMediaStructure);
  const settingsViewOrientation = useSelector(selectViewOrientation);
  const settingsViewScale = useSelector(selectViewScale);
  const settingsDefaultPage = useSelector(selectDefaultPage);
  const settingsEnablePosterFetching = useSelector(selectEnablePosterFetching);
  const settingsEnableThumbnailGeneration = useSelector(selectEnableThumbnailGeneration);
  const settingsRescanOnStartup = useSelector(selectRescanOnStartup);
  const settingsFetchEpisodeNames = useSelector(selectFetchEpisodeNames);
  const settingsFetchEpisodeThumbnails = useSelector(selectFetchEpisodeThumbnails);
  const settingsAppColorScheme = useSelector(selectAppColorScheme);
  const settingsSortOrder = useSelector(selectSortOrder);
  const settingsShowSidebarSort = useSelector(selectShowSidebarSort);
  const settingsVideoPlayer = useSelector(selectVideoPlayer);
  const settingsVideoShowProgressBar = useSelector(selectVideoShowProgressBar);
  const settingsVideoTrackPickerEnabled = useSelector(selectVideoTrackPickerEnabled);
  const settingsVideoSpeedControlEnabled = useSelector(selectVideoSpeedControlEnabled);
  const settingsVideoAutoPlayNext = useSelector(selectVideoAutoPlayNext);
  const settingsAudiobookPlayer = useSelector(selectAudiobookPlayer);
  const settingsPersonalLayout = useSelector(selectPersonalLayout);
  const settingsKeyboardHandling = useSelector(selectKeyboardHandling);
  const settingsAudiobookRewindSeconds = useSelector(selectAudiobookRewindSeconds);
  const settingsBedtimeEnabled = useSelector(selectBedtimeEnabled);
  const settingsBedtimeStart = useSelector(selectBedtimeStart);
  const settingsBedtimeEnd = useSelector(selectBedtimeEnd);
  const settingsBedtimeAllowedTypes = useSelector(selectBedtimeAllowedTypes);

  const bedtimeTimeOptions = useMemo(
    () => buildBedtimeTimeOptions(settingsBedtimeStart, settingsBedtimeEnd),
    [settingsBedtimeStart, settingsBedtimeEnd],
  );

  const safeDecodeUri = useCallback((uri: string) => {
    try {
      return decodeURIComponent(uri);
    } catch {
      logger.warn('Settings', `Unable to decode source URI for display: ${uri}`);
      return uri;
    }
  }, []);

  const safeMediaSources = useMemo(() => {
    try {
      if (!Array.isArray(mediaSources)) {
        logger.warn('Settings', 'mediaSources is not an array; falling back to empty list');
        return [] as IMediaSource[];
      }

      const sanitised = mediaSources.filter((source): source is IMediaSource => {
        if (!source || typeof source !== 'object') return false;
        const uriOk = typeof source.uri === 'string' && source.uri.length > 0;
        const typeOk = source.contentType === 'tv' || source.contentType === 'movie' || source.contentType === 'audiobook' || source.contentType === 'personal';
        return uriOk && typeOk;
      });

      if (sanitised.length !== mediaSources.length) {
        logger.warn('Settings', `Filtered out ${mediaSources.length - sanitised.length} invalid media source item(s)`);
      }
      return sanitised;
    } catch (e) {
      logger.error('Settings', 'Failed to sanitise mediaSources, using empty list', e as Error);
      return [] as IMediaSource[];
    }
  }, [mediaSources]);

  useEffect(() => {
    try {
      logger.log('Settings', `Screen mounted. Current state: dataSource=${settingsDataSource}, mediaStructure=${settingsMediaStructure}, viewOrientation=${settingsViewOrientation}, viewScale=${settingsViewScale}, sources=${safeMediaSources.length}, posters=${settingsEnablePosterFetching}, thumbnails=${settingsEnableThumbnailGeneration}, rescanOnStartup=${settingsRescanOnStartup}, fetchEpisodeNames=${settingsFetchEpisodeNames}, fetchEpisodeThumbnails=${settingsFetchEpisodeThumbnails}`);
    } catch (e) {
      logger.error('Settings', 'Exception while logging settings mount state', e as Error);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Re-initialise the local draft from the saved (Redux) values. Runs on every focus as well as
  // when a saved value changes: Settings is a drawer screen, so it stays mounted after the user
  // leaves, and without this an unsaved edit would still be showing (and savable) on the next visit.
  // The dropdowns follow their draft value, so resetting the draft resets them too.
  useFocusEffect(useCallback(() => {
    try {
      setLocalPassword(settingsPassword);
      setLocalTmdbApiKey(settingsTmdbApiKey);
      setLocalTvdbApiKey(settingsTvdbApiKey);
      setLocalTvdbPin(settingsTvdbPin);
      setLocalDataSource(settingsDataSource);
      setLocalMediaStructure(settingsMediaStructure);
      setLocalViewOrientation(settingsViewOrientation);
      setLocalDefaultPage(settingsDefaultPage);
      setLocalViewScale(settingsViewScale);
      setLocalEnablePosterFetching(settingsEnablePosterFetching);
      setLocalEnableThumbnailGeneration(settingsEnableThumbnailGeneration);
      setLocalRescanOnStartup(settingsRescanOnStartup);
      setLocalFetchEpisodeNames(settingsFetchEpisodeNames);
      setLocalFetchEpisodeThumbnails(settingsFetchEpisodeThumbnails);
      setLocalAppColorScheme(settingsAppColorScheme);
      setLocalSortOrder(settingsSortOrder);
      setLocalShowSidebarSort(settingsShowSidebarSort);
      setLocalVideoPlayer(settingsVideoPlayer);
      setLocalVideoShowProgressBar(settingsVideoShowProgressBar);
      setLocalVideoTrackPickerEnabled(settingsVideoTrackPickerEnabled);
      setLocalVideoSpeedControlEnabled(settingsVideoSpeedControlEnabled);
      setLocalVideoAutoPlayNext(settingsVideoAutoPlayNext);
      setLocalAudiobookPlayer(settingsAudiobookPlayer);
      setLocalPersonalLayout(settingsPersonalLayout);
      setLocalKeyboardHandling(settingsKeyboardHandling);
      setLocalAudiobookRewindSeconds(settingsAudiobookRewindSeconds);
      setLocalBedtimeEnabled(settingsBedtimeEnabled);
      setLocalBedtimeStart(normaliseBedtimeTime(settingsBedtimeStart));
      setLocalBedtimeEnd(normaliseBedtimeTime(settingsBedtimeEnd));
      setLocalBedtimeAllowedTypes(canonicalBedtimeTypes(settingsBedtimeAllowedTypes));
    } catch (e) {
      logger.error('Settings', 'Exception while syncing local settings state', e as Error);
    }
  }, [settingsPassword, settingsTmdbApiKey, settingsTvdbApiKey, settingsTvdbPin, settingsDataSource, settingsMediaStructure, settingsViewOrientation, settingsViewScale, settingsDefaultPage, settingsEnablePosterFetching, settingsEnableThumbnailGeneration, settingsRescanOnStartup, settingsFetchEpisodeNames, settingsFetchEpisodeThumbnails, settingsAppColorScheme, settingsSortOrder, settingsShowSidebarSort, settingsVideoPlayer, settingsVideoShowProgressBar, settingsVideoTrackPickerEnabled, settingsVideoSpeedControlEnabled, settingsVideoAutoPlayNext, settingsAudiobookPlayer, settingsPersonalLayout, settingsKeyboardHandling, settingsAudiobookRewindSeconds, settingsBedtimeEnabled, settingsBedtimeStart, settingsBedtimeEnd, settingsBedtimeAllowedTypes]));

  // Leaving Settings closes any open category, so the next visit starts at the category list.
  useFocusEffect(useCallback(() => () => setActiveSection(null), []));

  // On a phone, the hardware back button closes the open category before it leaves Settings.
  useFocusEffect(useCallback(() => {
    if (!onSectionPage) return undefined;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      setActiveSection(null);
      return true;
    });
    return () => subscription.remove();
  }, [onSectionPage]));

  const save = useCallback(() => {
    try {
      logger.log('Settings', 'Save pressed – evaluating changes');
      let changeCount = 0;
      const passwordToSave = password || null;
      if (password !== null && passwordToSave !== settingsPassword) {
        logger.log('Settings', 'Persisting: password changed');
        dispatch(setPassword(passwordToSave));
        changeCount++;
      }
      if (dataSource && dataSource !== settingsDataSource) {
        logger.log('Settings', `Persisting: dataSource changed ${settingsDataSource} → ${dataSource}`);
        dispatch(setDataSource(dataSource));
        changeCount++;
      }
      if (mediaStructure && mediaStructure !== settingsMediaStructure) {
        logger.log('Settings', `Persisting: mediaStructure changed ${settingsMediaStructure} → ${mediaStructure}`);
        dispatch(setMediaStructure(mediaStructure));
        changeCount++;
      }
      if (viewOrientation && viewOrientation !== settingsViewOrientation) {
        logger.log('Settings', `Persisting: viewOrientation changed ${settingsViewOrientation} → ${viewOrientation}`);
        dispatch(setViewOrientation(viewOrientation));
        changeCount++;
      }
      if (viewScale && viewScale !== settingsViewScale) {
        logger.log('Settings', `Persisting: viewScale changed ${settingsViewScale} → ${viewScale}`);
        dispatch(setViewScale(viewScale));
        changeCount++;
      }
      if (tmdbApiKey !== settingsTmdbApiKey) {
        logger.log('Settings', 'Persisting: tmdbApiKey changed');
        dispatch(setTmdbApiKey(tmdbApiKey || null));
        changeCount++;
      }
      if (tvdbApiKey !== settingsTvdbApiKey) {
        logger.log('Settings', 'Persisting: tvdbApiKey changed');
        dispatch(setTvdbApiKey(tvdbApiKey || null));
        changeCount++;
      }
      if (tvdbPin !== settingsTvdbPin) {
        logger.log('Settings', 'Persisting: tvdbPin changed');
        dispatch(setTvdbPin(tvdbPin || null));
        changeCount++;
      }
      if (defaultPage && defaultPage !== settingsDefaultPage) {
        logger.log('Settings', `Persisting: defaultPage changed ${settingsDefaultPage} → ${defaultPage}`);
        dispatch(setDefaultPage(defaultPage));
        changeCount++;
      }
      if (enablePosterFetching !== settingsEnablePosterFetching) {
        logger.log('Settings', `Persisting: enablePosterFetching changed ${settingsEnablePosterFetching} → ${enablePosterFetching}`);
        dispatch(setEnablePosterFetching(enablePosterFetching));
        changeCount++;
      }
      if (enableThumbnailGeneration !== settingsEnableThumbnailGeneration) {
        logger.log('Settings', `Persisting: enableThumbnailGeneration changed ${settingsEnableThumbnailGeneration} → ${enableThumbnailGeneration}`);
        dispatch(setEnableThumbnailGeneration(enableThumbnailGeneration));
        changeCount++;
      }
      if (rescanOnStartup !== settingsRescanOnStartup) {
        logger.log('Settings', `Persisting: rescanOnStartup changed ${settingsRescanOnStartup} → ${rescanOnStartup}`);
        dispatch(setRescanOnStartup(rescanOnStartup));
        changeCount++;
      }
      if (fetchEpisodeNames !== settingsFetchEpisodeNames) {
        logger.log('Settings', `Persisting: fetchEpisodeNames changed ${settingsFetchEpisodeNames} → ${fetchEpisodeNames}`);
        dispatch(setFetchEpisodeNames(fetchEpisodeNames));
        changeCount++;
      }
      if (fetchEpisodeThumbnails !== settingsFetchEpisodeThumbnails) {
        logger.log('Settings', `Persisting: fetchEpisodeThumbnails changed ${settingsFetchEpisodeThumbnails} → ${fetchEpisodeThumbnails}`);
        dispatch(setFetchEpisodeThumbnails(fetchEpisodeThumbnails));
        changeCount++;
      }
      if (appColorScheme && appColorScheme !== settingsAppColorScheme) {
        logger.log('Settings', `Persisting: appColorScheme changed ${settingsAppColorScheme} → ${appColorScheme}`);
        dispatch(setAppColorScheme(appColorScheme));
        changeCount++;
      }
      if (sortOrder && sortOrder !== settingsSortOrder) {
        logger.log('Settings', `Persisting: sortOrder changed ${settingsSortOrder} → ${sortOrder}`);
        dispatch(setSortOrder(sortOrder));
        changeCount++;
      }
      if (showSidebarSort !== settingsShowSidebarSort) {
        logger.log('Settings', `Persisting: showSidebarSort changed ${settingsShowSidebarSort} → ${showSidebarSort}`);
        dispatch(setShowSidebarSort(showSidebarSort));
        changeCount++;
      }
      if (videoPlayer && videoPlayer !== settingsVideoPlayer) {
        logger.log('Settings', `Persisting: videoPlayer changed ${settingsVideoPlayer} → ${videoPlayer}`);
        dispatch(setVideoPlayer(videoPlayer));
        changeCount++;
      }
      if (videoShowProgressBar !== settingsVideoShowProgressBar) {
        logger.log('Settings', `Persisting: videoShowProgressBar changed ${settingsVideoShowProgressBar} → ${videoShowProgressBar}`);
        dispatch(setVideoShowProgressBar(videoShowProgressBar));
        changeCount++;
      }
      if (videoTrackPickerEnabled !== settingsVideoTrackPickerEnabled) {
        logger.log('Settings', `Persisting: videoTrackPickerEnabled changed ${settingsVideoTrackPickerEnabled} → ${videoTrackPickerEnabled}`);
        dispatch(setVideoTrackPickerEnabled(videoTrackPickerEnabled));
        changeCount++;
      }
      if (videoSpeedControlEnabled !== settingsVideoSpeedControlEnabled) {
        logger.log('Settings', `Persisting: videoSpeedControlEnabled changed ${settingsVideoSpeedControlEnabled} → ${videoSpeedControlEnabled}`);
        dispatch(setVideoSpeedControlEnabled(videoSpeedControlEnabled));
        changeCount++;
      }
      if (videoAutoPlayNext && videoAutoPlayNext !== settingsVideoAutoPlayNext) {
        logger.log('Settings', `Persisting: videoAutoPlayNext changed ${settingsVideoAutoPlayNext} → ${videoAutoPlayNext}`);
        dispatch(setVideoAutoPlayNext(videoAutoPlayNext));
        changeCount++;
      }
      if (personalLayout !== settingsPersonalLayout) {
        logger.log('Settings', `Persisting: personalLayout changed ${settingsPersonalLayout} → ${personalLayout}`);
        dispatch(setPersonalLayout(personalLayout));
        changeCount++;
      }
      if (audiobookPlayer && audiobookPlayer !== settingsAudiobookPlayer) {
        logger.log('Settings', `Persisting: audiobookPlayer changed ${settingsAudiobookPlayer} → ${audiobookPlayer}`);
        dispatch(setAudiobookPlayer(audiobookPlayer));
        changeCount++;
      }
      if (keyboardHandling && keyboardHandling !== settingsKeyboardHandling) {
        logger.log('Settings', `Persisting: keyboardHandling changed ${settingsKeyboardHandling} → ${keyboardHandling}`);
        dispatch(setKeyboardHandling(keyboardHandling));
        changeCount++;
      }
      if (audiobookRewindSeconds !== settingsAudiobookRewindSeconds) {
        logger.log('Settings', `Persisting: audiobookRewindSeconds changed ${settingsAudiobookRewindSeconds} → ${audiobookRewindSeconds}`);
        dispatch(setAudiobookRewindSeconds(audiobookRewindSeconds));
        changeCount++;
      }
      if (bedtimeEnabled !== settingsBedtimeEnabled) {
        logger.log('Settings', `Persisting: bedtimeEnabled changed ${settingsBedtimeEnabled} → ${bedtimeEnabled}`);
        dispatch(setBedtimeEnabled(bedtimeEnabled));
        changeCount++;
      }
      if (bedtimeStart && bedtimeStart !== normaliseBedtimeTime(settingsBedtimeStart)) {
        logger.log('Settings', `Persisting: bedtimeStart changed ${settingsBedtimeStart} → ${bedtimeStart}`);
        dispatch(setBedtimeStart(bedtimeStart));
        changeCount++;
      }
      if (bedtimeEnd && bedtimeEnd !== normaliseBedtimeTime(settingsBedtimeEnd)) {
        logger.log('Settings', `Persisting: bedtimeEnd changed ${settingsBedtimeEnd} → ${bedtimeEnd}`);
        dispatch(setBedtimeEnd(bedtimeEnd));
        changeCount++;
      }
      if (bedtimeAllowedTypes.length > 0 && bedtimeAllowedTypes.join(',') !== canonicalBedtimeTypes(settingsBedtimeAllowedTypes).join(',')) {
        logger.log('Settings', `Persisting: bedtimeAllowedTypes changed ${settingsBedtimeAllowedTypes.join(',')} → ${bedtimeAllowedTypes.join(',')}`);
        dispatch(setBedtimeAllowedTypes(bedtimeAllowedTypes));
        changeCount++;
      }
      logger.log('Settings', `Save complete – ${changeCount} setting(s) changed and persisted`);
      router.replace('/(drawer)/(home)');
    } catch (e) {
      logger.error('Settings', 'Exception while saving settings', e as Error);
    }
  }, [dispatch, password, settingsPassword, dataSource, settingsDataSource, mediaStructure, settingsMediaStructure, viewOrientation, settingsViewOrientation, viewScale, settingsViewScale, tmdbApiKey, settingsTmdbApiKey, tvdbApiKey, settingsTvdbApiKey, tvdbPin, settingsTvdbPin, defaultPage, settingsDefaultPage, enablePosterFetching, settingsEnablePosterFetching, enableThumbnailGeneration, settingsEnableThumbnailGeneration, rescanOnStartup, settingsRescanOnStartup, fetchEpisodeNames, settingsFetchEpisodeNames, fetchEpisodeThumbnails, settingsFetchEpisodeThumbnails, appColorScheme, settingsAppColorScheme, sortOrder, settingsSortOrder, showSidebarSort, settingsShowSidebarSort, videoPlayer, settingsVideoPlayer, videoShowProgressBar, settingsVideoShowProgressBar, videoTrackPickerEnabled, settingsVideoTrackPickerEnabled, videoSpeedControlEnabled, settingsVideoSpeedControlEnabled, videoAutoPlayNext, settingsVideoAutoPlayNext, audiobookPlayer, settingsAudiobookPlayer, personalLayout, settingsPersonalLayout, keyboardHandling, settingsKeyboardHandling, audiobookRewindSeconds, settingsAudiobookRewindSeconds, bedtimeEnabled, settingsBedtimeEnabled, bedtimeStart, settingsBedtimeStart, bedtimeEnd, settingsBedtimeEnd, bedtimeAllowedTypes, settingsBedtimeAllowedTypes]);

  const navigation = useNavigation();
  const saveRef = useRef(save);
  useEffect(() => { saveRef.current = save; }, [save]);
  useLayoutEffect(() => {
    navigation.setOptions({
      title: onSectionPage ? shownSectionTitle : 'Settings',
      // undefined puts the drawer's own menu button back.
      headerLeft: onSectionPage
        ? ({ tintColor }: { tintColor?: string }) => (
          <HeaderBackButton tintColor={tintColor} onPress={() => setActiveSection(null)} />
        )
        : undefined,
      headerRight: () => <Button title="Save" onPress={() => saveRef.current()} />,
    });
  }, [navigation, onSectionPage, shownSectionTitle]);

  const deleteSource = useCallback((uri: string) => {
    try {
      logger.log('Settings', `Removing media source: ${uri}`);
      dispatch(removeMediaSource(uri));
    } catch (e) {
      logger.error('Settings', 'Exception while removing media source', e as Error);
    }
  }, [dispatch]);

  const scanNow = useCallback(async () => {
    try {
      logger.log('Settings', `Manual rescan triggered for ${safeMediaSources.length} source(s)`);
      setScanning(true);
      setScanComplete(false);
      const scannerModule = await import('@/scripts/FileScanner');
      await scannerModule.FileScanner.getInstance().scanAllSources(safeMediaSources);
      setScanComplete(true);
      setTimeout(() => setScanComplete(false), 4000);
    } catch (e) {
      logger.error('Settings', 'Exception while scanning sources', e as Error);
    } finally {
      setScanning(false);
    }
  }, [safeMediaSources]);

  const handleUIScaleChange = (value: number) => {
    try {
      setLocalViewScale(11 - value);
    } catch (e) {
      logger.error('Settings', 'Exception while applying UI scale change', e as Error);
    }
  };

  const clearThumbnailCache = useCallback(() => {
    Alert.alert(
      'Clear thumbnail cache',
      'This will delete all generated video thumbnails from disk and from memory. They will be regenerated on the next scan.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Clear',
          style: 'destructive',
          onPress: async () => {
            try {
              const { Directory, Paths } = await import('expo-file-system');
              const thumbnailsDir = new Directory(Paths.document, 'smb_thumbnails');
              if (thumbnailsDir.exists) {
                thumbnailsDir.delete();
              }
              dispatch(clearThumbnails());
              thumbnailCache.clear();
              logger.log('Settings', 'Thumbnail cache cleared');
            } catch (e) {
              logger.error('Settings', 'Exception while clearing thumbnail cache', e as Error);
            }
          },
        },
      ],
    );
  }, [dispatch]);

  const clearPosterCache = useCallback(() => {
    Alert.alert(
      'Clear poster overrides',
      'This will delete all downloaded poster images and episode thumbnails from disk and reset any poster overrides. Poster images and episode thumbnails will be re-fetched on the next scan.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Clear',
          style: 'destructive',
          onPress: async () => {
            try {
              const { Directory, Paths } = await import('expo-file-system');
              const postersDir = new Directory(Paths.document, 'smb_posters');
              if (postersDir.exists) {
                postersDir.delete();
              }
              const episodeThumbsDir = new Directory(Paths.document, 'smb_thumbnails_tmdb');
              if (episodeThumbsDir.exists) {
                episodeThumbsDir.delete();
              }
              dispatch(clearPosterOverrides());
              logger.log('Settings', 'Poster overrides cleared');
            } catch (e) {
              logger.error('Settings', 'Exception while clearing poster overrides', e as Error);
            }
          },
        },
      ],
    );
  }, [dispatch]);

  const clearTvdbCache = useCallback(() => {
    Alert.alert(
      'Clear TVDB cache',
      'This will delete all downloaded TVDB poster images and episode thumbnails from disk and reset TVDB poster overrides. Images will be re-fetched on the next scan.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Clear',
          style: 'destructive',
          onPress: async () => {
            try {
              const { Directory, Paths } = await import('expo-file-system');
              const postersTvdbDir = new Directory(Paths.document, 'smb_posters_tvdb');
              if (postersTvdbDir.exists) {
                postersTvdbDir.delete();
              }
              const episodeThumbsTvdbDir = new Directory(Paths.document, 'smb_thumbnails_tvdb');
              if (episodeThumbsTvdbDir.exists) {
                episodeThumbsTvdbDir.delete();
              }
              dispatch(clearTvdbPosterOverrides());
              logger.log('Settings', 'TVDB poster cache cleared');
            } catch (e) {
              logger.error('Settings', 'Exception while clearing TVDB poster cache', e as Error);
            }
          },
        },
      ],
    );
  }, [dispatch]);

  const clearScannedData = useCallback(() => {
    Alert.alert(
      'Clear scanned data',
      'This will remove all scanned TV and movie data from memory. You will need to rescan your sources to see your library again.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Clear',
          style: 'destructive',
          onPress: () => {
            try {
              dispatch(clearLibraryAndMovies());
              logger.log('Settings', 'Scanned data cleared');
            } catch (e) {
              logger.error('Settings', 'Exception while clearing scanned data', e as Error);
            }
          },
        },
      ],
    );
  }, [dispatch]);

  const clearAllOverridesAction = useCallback(() => {
    Alert.alert(
      'Clear all overrides',
      'This will remove all custom overrides including sort titles, display titles, poster selections, and TMDB rematch results. Library data and files on disk are not affected.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Clear',
          style: 'destructive',
          onPress: () => {
            try {
              dispatch(clearAllOverrides());
              logger.log('Settings', 'All overrides cleared');
            } catch (e) {
              logger.error('Settings', 'Exception while clearing all overrides', e as Error);
            }
          },
        },
      ],
    );
  }, [dispatch]);

  const toggleBedtimeType = useCallback((type: contentTypes, value: boolean) => {
    try {
      setLocalBedtimeAllowedTypes(prev => {
        // At least one library must stay available during bedtime (the switch for the last one is disabled).
        const next = value ? [...prev, type] : prev.filter(t => t !== type);
        return next.length > 0 ? canonicalBedtimeTypes(next) : prev;
      });
    } catch (e) {
      logger.error('Settings', 'Exception while toggling bedtime library', e as Error);
    }
  }, []);

  const bedtimeStartsEqualEnd = parseTimeOfDay(bedtimeStart) !== null && parseTimeOfDay(bedtimeStart) === parseTimeOfDay(bedtimeEnd);

  const handleExportJson = useCallback(async () => {
    try {
      const options: JsonExportOptions = {
        includeSettings: exportIncludeSettings,
        includeOverrides: exportIncludeOverrides,
        includeWatched: exportIncludeWatched,
        includeMatches: exportIncludeMatches,
      };
      if (!options.includeSettings && !options.includeOverrides && !options.includeWatched && !options.includeMatches) {
        Alert.alert('Nothing to export', 'Please select at least one section to include in the export.');
        return;
      }
      await exportJson(options);
      Alert.alert('Export complete', 'Settings and metadata have been saved to the selected folder.');
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      if (!msg.includes('denied') && !msg.includes('selected')) {
        Alert.alert('Export failed', msg);
      }
      logger.warn('Settings', 'JSON export failed', e);
    }
  }, [exportIncludeSettings, exportIncludeOverrides, exportIncludeWatched, exportIncludeMatches]);

  const handleImportJson = useCallback(async () => {
    try {
      const { applied } = await importJson();
      Alert.alert('Import complete', `Applied: ${applied.join(', ')}.`);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      if (!msg.includes('No file') && !msg.includes('cancel')) {
        Alert.alert('Import failed', msg);
      }
      logger.warn('Settings', 'JSON import failed', e);
    }
  }, []);

  const handleExportToFilesystem = useCallback(async () => {
    try {
      const { showsExported, moviesExported, failed, skipped } = await exportToFilesystem(safeMediaSources);
      const parts: string[] = [];
      if (showsExported > 0) parts.push(`${showsExported} show(s)`);
      if (moviesExported > 0) parts.push(`${moviesExported} movie(s)`);
      const summary = parts.length > 0 ? parts.join(' and ') : 'nothing';
      const extra: string[] = [];
      if (skipped > 0) extra.push(`${skipped} skipped (no data or no subfolder)`);
      if (failed > 0) extra.push(`${failed} failed`);
      const detail = extra.length > 0 ? `\n\n${extra.join(', ')}.` : '';
      Alert.alert('Export complete', `Exported metadata alongside ${summary}.${detail}`);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      Alert.alert('Export failed', msg);
      logger.warn('Settings', 'Filesystem export failed', e);
    }
  }, [safeMediaSources]);

  // One-line summary under each category in the list, built from the (possibly unsaved) drafts.
  const sectionSummary = (id: SectionId): string => {
    switch (id) {
      case 'library': {
        const count = safeMediaSources.length;
        if (count === 0) return 'No folders added yet';
        return `${count} folder${count === 1 ? '' : 's'}${rescanOnStartup ? ' · rescans on startup' : ''}`;
      }
      case 'metadata': {
        const key = dataSource === 'tvdb' ? tvdbApiKey : tmdbApiKey;
        return `${labelFor(dataSourceOptions, dataSource)}${key ? '' : ' · no API key set'}`;
      }
      case 'appearance':
        return `${labelFor(appColorSchemeOptions, appColorScheme)} theme · ${labelFor(uiTypeOptions, viewOrientation)} view`;
      case 'browsing':
        return `Opens ${labelFor(defaultPageOptions, defaultPage)} · ${labelFor(sortOrderOptions, sortOrder)} · Personal ${labelFor(personalLayoutOptions, personalLayout).toLowerCase()}`;
      case 'video':
        return videoPlayer === 'external' ? 'External app' : 'In-app player';
      case 'audiobook':
        if (audiobookPlayer === 'external') return 'External app';
        return `In-app player${audiobookRewindSeconds > 0 ? ` · rewinds ${audiobookRewindSeconds} s on resume` : ''}`;
      case 'parental':
        return `${password ? 'Password set' : 'No password'} · ${bedtimeEnabled ? `bedtime ${bedtimeStart}–${bedtimeEnd}` : 'bedtime off'}`;
      case 'backup':
        return 'Export or restore settings and metadata';
      case 'troubleshooting':
        return 'Clear caches and reset library data';
    }
  };

  const renderSectionList = () => (
    <>
      {sections.map(section => {
        const selected = twoPane && section.id === shownSection;
        return (
          <TouchableOpacity
            key={section.id}
            style={[styles.navRow, selected && { backgroundColor: surfaces.backgroundSelected }]}
            onPress={() => setActiveSection(section.id)}
            accessibilityRole="button"
            accessibilityState={{ selected }}
          >
            <Ionicons name={section.icon} size={24} color={theme.icon} />
            <View style={styles.navText}>
              <ThemedText style={styles.navTitle}>{section.title}</ThemedText>
              <ThemedText style={styles.navSummary} numberOfLines={1}>{sectionSummary(section.id)}</ThemedText>
            </View>
            {!twoPane && <Ionicons name="chevron-forward" size={18} color={theme.icon} />}
          </TouchableOpacity>
        );
      })}
      <View style={styles.footerContainer}>
        <ThemedText style={styles.footerText}>Version {appVersion}</ThemedText>
      </View>
    </>
  );

  const renderSection = (id: SectionId) => {
    switch (id) {
      case 'library':
        return (
          <>
            <GroupHeading>Folders</GroupHeading>
            {safeMediaSources.length === 0 && (
              <ThemedText style={styles.hintText}>No folders added yet. Pick a type and choose a folder below.</ThemedText>
            )}
            {safeMediaSources.map((source, index) => (
              <View key={source.uri} style={styles.sourceRow}>
                <View style={styles.sourceInfo}>
                  <ThemedText style={styles.sourceType}>
                    {`Library ${index + 1} · ${source.contentType === 'tv' ? '📺 TV' : source.contentType === 'audiobook' ? '🎧 Audiobooks' : source.contentType === 'personal' ? '🎞️ Personal' : '🎬 Movies'}`}
                  </ThemedText>
                  <ThemedText style={styles.sourceUri} numberOfLines={1}>{safeDecodeUri(source.uri)}</ThemedText>
                </View>
                {source.contentType !== 'audiobook' && source.contentType !== 'personal' && (
                  <Dropdown
                    compact
                    options={metadataSourceOptions}
                    value={source.metadataSource ?? 'auto'}
                    onChange={(value) => {
                      try {
                        dispatch(updateMediaSourceMetadata({
                          uri: source.uri,
                          metadataSource: value === 'auto' ? undefined : value,
                        }));
                      } catch (e) {
                        logger.error('Settings', 'Exception while updating media source metadata source', e as Error);
                      }
                    }}
                  />
                )}
                <TouchableOpacity onPress={() => deleteSource(source.uri)} style={styles.deleteButton} accessibilityLabel="Remove folder">
                  <Ionicons name="close" size={20} color={DESTRUCTIVE_COLOR} />
                </TouchableOpacity>
              </View>
            ))}
            <AddMediaSource />
            <ThemedText style={styles.hintText}>Folder changes take effect straight away; they don&apos;t need Save.</ThemedText>

            <GroupHeading>Scanning</GroupHeading>
            <View style={styles.settingRow}>
              <Button title={scanning ? 'Scanning…' : 'Rescan now'} onPress={scanNow} disabled={scanning} />
              {!scanning && scanComplete && <ThemedText style={styles.scanStatus}>✓ Scan complete</ThemedText>}
            </View>
            <SwitchRow
              label="Rescan on startup"
              description="Rescan the library each time the app starts. Turn off to keep the existing library until you rescan manually."
              value={rescanOnStartup}
              onValueChange={setLocalRescanOnStartup}
            />
          </>
        );

      case 'metadata':
        return (
          <>
            <GroupHeading>Provider</GroupHeading>
            <SettingRow label="Data source" description="Used for folders set to Auto.">
              <Dropdown options={dataSourceOptions} value={dataSource} onChange={setLocalDataSource} />
            </SettingRow>

            <GroupHeading>API keys</GroupHeading>
            <ThemedText style={styles.settingLabel}>TMDB API key</ThemedText>
            <ThemedTextInput
              onChangeText={setLocalTmdbApiKey}
              onFocus={handleInputFocus}
              onBlur={handleInputBlur}
              value={tmdbApiKey ?? ""}
              placeholder="Paste your TMDB API key"
              keyboardType="default"
              secureTextEntry={false}
            />
            <ThemedText style={styles.settingDescription}>
              Register for a free key at themoviedb.org. Posters are downloaded and cached locally for offline use.
            </ThemedText>

            <ThemedText style={styles.settingLabel}>TheTVDB API key</ThemedText>
            <ThemedTextInput
              onChangeText={setLocalTvdbApiKey}
              onFocus={handleInputFocus}
              onBlur={handleInputBlur}
              value={tvdbApiKey ?? ""}
              placeholder="Paste your TVDB API key"
              keyboardType="default"
              secureTextEntry={false}
            />
            <ThemedText style={styles.settingDescription}>
              Optional. Register for a free key at thetvdb.com. Used for TV show metadata when TheTVDB is the data source.
            </ThemedText>

            <ThemedText style={styles.settingLabel}>TheTVDB subscriber PIN</ThemedText>
            <ThemedTextInput
              onChangeText={setLocalTvdbPin}
              onFocus={handleInputFocus}
              onBlur={handleInputBlur}
              value={tvdbPin ?? ""}
              placeholder="Optional subscriber PIN"
              keyboardType="default"
              secureTextEntry={false}
            />
            <ThemedText style={styles.settingDescription}>
              Optional. Only needed by subscribers for extended metadata on thetvdb.com.
            </ThemedText>

            <GroupHeading>During scans</GroupHeading>
            <SwitchRow
              label="Fetch posters"
              description="When off, scans skip poster fetching even if an API key is set."
              value={enablePosterFetching}
              onValueChange={setLocalEnablePosterFetching}
            />
            <SwitchRow
              label="Fetch episode names"
              description="Show the provider's episode names in place of the file names."
              value={fetchEpisodeNames}
              onValueChange={setLocalFetchEpisodeNames}
            />
            <SwitchRow
              label="Fetch episode thumbnails"
              description="Use the provider's episode stills as episode artwork."
              value={fetchEpisodeThumbnails}
              onValueChange={setLocalFetchEpisodeThumbnails}
            />
            <SwitchRow
              label="Generate video thumbnails"
              description="Make thumbnails from the video files themselves. Off by default."
              value={enableThumbnailGeneration}
              onValueChange={setLocalEnableThumbnailGeneration}
            />
          </>
        );

      case 'appearance':
        return (
          <>
            <SettingRow label="Color scheme">
              <Dropdown options={appColorSchemeOptions} value={appColorScheme} onChange={setLocalAppColorScheme} />
            </SettingRow>
            <SettingRow label="Interface type" description="Poster grid or a compact list.">
              <Dropdown options={uiTypeOptions} value={viewOrientation} onChange={setLocalViewOrientation} />
            </SettingRow>
            <SettingRow
              label="UI scale"
              description={`Poster view shows about ${mapScaleToColumns(viewScale, PORTRAIT_MIN_COLUMNS, PORTRAIT_MAX_COLUMNS)} columns in portrait and ${mapScaleToColumns(viewScale, LANDSCAPE_MIN_COLUMNS, LANDSCAPE_MAX_COLUMNS)} in landscape.`}
            />
            <Slider
              style={styles.slider}
              minimumValue={1}
              maximumValue={10}
              step={1}
              value={11-viewScale}
              onSlidingComplete={handleUIScaleChange}
              minimumTrackTintColor={colorScheme === 'dark' ? '#ECEDEE' : '#11181C'}
              maximumTrackTintColor={colorScheme === 'dark' ? '#687076' : '#9BA1A6'}
            />
          </>
        );

      case 'browsing':
        return (
          <>
            <SettingRow label="Default page" description="The library shown when the app opens.">
              <Dropdown options={defaultPageOptions} value={defaultPage} onChange={setLocalDefaultPage} />
            </SettingRow>
            <SettingRow label="Sorting">
              <Dropdown options={sortOrderOptions} value={sortOrder} onChange={setLocalSortOrder} />
            </SettingRow>
            <SwitchRow
              label="Sort menu in sidebar"
              description="Adds a sort selector to the sidebar for quick switching."
              value={showSidebarSort}
              onValueChange={setLocalShowSidebarSort}
            />
            <SettingRow label="TV show structure" description={viewTypeOptions.find(o => o.id === mediaStructure)?.title}>
              <Dropdown options={viewTypeOptions} value={mediaStructure} onChange={setLocalMediaStructure} />
            </SettingRow>
            <SettingRow label="Personal library layout" description={personalLayoutOptions.find(o => o.id === personalLayout)?.title}>
              <Dropdown options={personalLayoutOptions} value={personalLayout} onChange={setLocalPersonalLayout} />
            </SettingRow>
          </>
        );

      case 'video': {
        const inAppOnly = videoPlayer === 'external';
        return (
          <>
            <SettingRow label="Play videos with" description="In-app plays videos here and remembers your place. External app hands them to another app.">
              <Dropdown options={videoPlayerOptions} value={videoPlayer} onChange={setLocalVideoPlayer} />
            </SettingRow>
            <SwitchRow
              label="Show progress bars on tiles"
              description="Applies to the library with either player."
              value={videoShowProgressBar}
              onValueChange={setLocalVideoShowProgressBar}
            />

            <GroupHeading>In-app player</GroupHeading>
            {inAppOnly && (
              <ThemedText style={styles.hintText}>These only apply to the in-app player.</ThemedText>
            )}
            <SwitchRow
              label="Subtitle & audio track picker"
              value={videoTrackPickerEnabled}
              onValueChange={setLocalVideoTrackPickerEnabled}
              disabled={inAppOnly}
            />
            <SwitchRow
              label="Playback speed control"
              value={videoSpeedControlEnabled}
              onValueChange={setLocalVideoSpeedControlEnabled}
              disabled={inAppOnly}
            />
            <SettingRow
              label="Auto-play next episode"
              description="Up next shows a card when an episode ends; Countdown also starts the next one after 10 seconds."
              disabled={inAppOnly}
            >
              <Dropdown options={videoAutoPlayNextOptions} value={videoAutoPlayNext} onChange={setLocalVideoAutoPlayNext} disabled={inAppOnly} />
            </SettingRow>
          </>
        );
      }

      case 'audiobook': {
        const inAppOnly = audiobookPlayer === 'external';
        return (
          <>
            <SettingRow label="Play audiobooks with" description="In-app remembers your place in each book and keeps playing in the background. External app hands the files to another app.">
              <Dropdown options={audiobookPlayerOptions} value={audiobookPlayer} onChange={setLocalAudiobookPlayer} />
            </SettingRow>

            <GroupHeading>In-app player</GroupHeading>
            {inAppOnly && (
              <ThemedText style={styles.hintText}>These only apply to the in-app player.</ThemedText>
            )}
            <SettingRow
              label="Rewind on resume"
              description="Steps back a little when you come back after a pause."
              disabled={inAppOnly}
            >
              <Dropdown options={audiobookRewindOptions} value={audiobookRewindSeconds} onChange={setLocalAudiobookRewindSeconds} disabled={inAppOnly} />
            </SettingRow>
            <ThemedText style={styles.hintText}>Playback speed and the sleep timer are set from the player itself.</ThemedText>
          </>
        );
      }

      case 'parental':
        return (
          <>
            <GroupHeading>Password</GroupHeading>
            <ThemedText style={styles.settingLabel}>Settings password</ThemedText>
            <ThemedTextInput
              onChangeText={setLocalPassword}
              onFocus={handleInputFocus}
              onBlur={handleInputBlur}
              value={password ?? ""}
              placeholder="Settings password"
              keyboardType="default"
              secureTextEntry={true}
            />
            <ThemedText style={styles.settingDescription}>
              Needed to open Settings, Debug Logs and edit mode, and to unlock libraries during bedtime. Leave empty for no password.
            </ThemedText>

            <GroupHeading>Bedtime</GroupHeading>
            <SwitchRow
              label="Bedtime mode"
              description="During bedtime only the libraries chosen below can be opened freely; the rest need the settings password. Checked each time the app is opened."
              value={bedtimeEnabled}
              onValueChange={setLocalBedtimeEnabled}
            />
            {bedtimeEnabled && !password && (
              <ThemedText style={styles.warningText}>
                No settings password is set, so anyone can unlock the bedtime libraries. Set one above.
              </ThemedText>
            )}
            <SettingRow label="Start time" disabled={!bedtimeEnabled}>
              <Dropdown options={bedtimeTimeOptions} value={bedtimeStart} onChange={setLocalBedtimeStart} disabled={!bedtimeEnabled} />
            </SettingRow>
            <SettingRow label="End time" description="An end before the start runs overnight (for example 19:00 to 07:00)." disabled={!bedtimeEnabled}>
              <Dropdown options={bedtimeTimeOptions} value={bedtimeEnd} onChange={setLocalBedtimeEnd} disabled={!bedtimeEnabled} />
            </SettingRow>
            {bedtimeStartsEqualEnd && (
              <ThemedText style={styles.warningText}>
                Start and end time are the same, so bedtime will never apply.
              </ThemedText>
            )}
            <ThemedText style={[styles.settingLabel, !bedtimeEnabled && styles.disabled]}>Available during bedtime</ThemedText>
            {bedtimeTypeOptions.map(option => {
              const checked = bedtimeAllowedTypes.includes(option.id);
              const isLastChecked = checked && bedtimeAllowedTypes.length === 1;
              return (
                <SettingRow key={option.id} label={option.label} disabled={!bedtimeEnabled}>
                  <Switch
                    value={checked}
                    disabled={!bedtimeEnabled || isLastChecked}
                    onValueChange={(value) => toggleBedtimeType(option.id, value)}
                  />
                </SettingRow>
              );
            })}
            <ThemedText style={styles.hintText}>
              At least one library must stay available during bedtime.
            </ThemedText>
          </>
        );

      case 'backup':
        return (
          <>
            <GroupHeading>Export to a JSON file</GroupHeading>
            <ThemedText style={styles.settingDescription}>Choose what to include:</ThemedText>
            <SwitchRow label="Settings" description="API keys, view options" value={exportIncludeSettings} onValueChange={setExportIncludeSettings} />
            <SwitchRow label="Overrides" description="Custom titles, sort titles" value={exportIncludeOverrides} onValueChange={setExportIncludeOverrides} />
            <SwitchRow label="Watched marks & playback progress" value={exportIncludeWatched} onValueChange={setExportIncludeWatched} />
            <SwitchRow label="Matches" description="TMDB/TVDB IDs, episode names" value={exportIncludeMatches} onValueChange={setExportIncludeMatches} />
            <ActionRow
              title="📤 Export app state to JSON"
              description="Saves the selected data to a JSON file in a folder you choose."
              onPress={handleExportJson}
            />

            <GroupHeading>Restore</GroupHeading>
            <ActionRow
              title="📥 Import app state from JSON"
              description="Restores settings, overrides, watched marks, playback progress and/or matches from a previously exported JSON file."
              onPress={handleImportJson}
            />

            <GroupHeading>Media folders</GroupHeading>
            <ActionRow
              title="💾 Export metadata to media folders"
              description="Writes smb.json, poster.jpg and episode thumbnails alongside your media files. These are picked up automatically during the next library scan."
              onPress={handleExportToFilesystem}
            />
          </>
        );

      case 'troubleshooting':
        return (
          <>
            <GroupHeading>Experimental</GroupHeading>
            <SettingRow
              label="Keyboard handling"
              description="Testing a replacement for how screens scroll inputs above the keyboard (issue 244). Switch back if text boxes end up hidden."
            >
              <Dropdown options={keyboardHandlingOptions} value={keyboardHandling} onChange={setLocalKeyboardHandling} />
            </SettingRow>

            <GroupHeading>Clear data</GroupHeading>
            <ActionRow destructive title="🗑 Clear thumbnail cache" description="Deletes all generated video thumbnails from disk." onPress={clearThumbnailCache} />
            <ActionRow destructive title="🖼 Clear TMDB poster cache" description="Deletes all TMDB-sourced posters and episode thumbnails, and resets poster overrides." onPress={clearPosterCache} />
            <ActionRow destructive title="🖼 Clear TVDB poster cache" description="Deletes all TheTVDB-sourced posters and episode thumbnails." onPress={clearTvdbCache} />
            <ActionRow destructive title="📂 Clear scanned data" description="Removes all scanned TV and movie data from memory." onPress={clearScannedData} />
            <ActionRow destructive title="🔄 Clear all overrides" description="Removes all custom overrides such as sort titles, display titles, poster selections, and TMDB rematch results." onPress={clearAllOverridesAction} />
          </>
        );
    }
  };

  const sectionPage = shownSection && (
    <KeyboardAwareForm
      // Remount per category so each page opens scrolled to the top.
      key={shownSection}
      keyboard={keyboard}
      keyboardVerticalOffset={headerHeight}
      avoidingViewStyle={styles.container}
      style={containerStyle}
      contentContainerStyle={[styles.pageContent, { paddingBottom: 20 + insets.bottom }]}
      keyboardShouldPersistTaps="handled"
    >
      {twoPane && <ThemedText type="subtitle" style={styles.pageTitle}>{shownSectionTitle}</ThemedText>}
      {renderSection(shownSection)}
    </KeyboardAwareForm>
  );

  return (
    <SettingsErrorBoundary>
      {twoPane ? (
        <View style={[styles.twoPane, { backgroundColor: theme.background }]}>
          <ScrollView
            style={[styles.listPane, { borderRightColor: DIVIDER_COLOR }]}
            contentContainerStyle={[styles.listContent, { paddingBottom: 8 + insets.bottom }]}
          >
            {renderSectionList()}
          </ScrollView>
          <View style={styles.container}>{sectionPage}</View>
        </View>
      ) : onSectionPage ? (
        sectionPage
      ) : (
        <ScrollView
          style={containerStyle}
          contentContainerStyle={[styles.listContent, { paddingBottom: 8 + insets.bottom }]}
        >
          {renderSectionList()}
        </ScrollView>
      )}
    </SettingsErrorBoundary>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  twoPane: {
    flex: 1,
    flexDirection: 'row',
  },
  listPane: {
    width: LIST_PANE_WIDTH,
    flexGrow: 0,
    borderRightWidth: StyleSheet.hairlineWidth,
  },
  listContent: {
    paddingVertical: 8,
  },
  pageContent: {
    padding: 20,
    gap: 12,
    // Keeps lines readable when a tablet's detail pane is very wide.
    maxWidth: 760,
  },
  pageTitle: {
    marginBottom: 4,
  },
  crashContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
    gap: 8,
  },
  navRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    paddingHorizontal: 20,
    paddingVertical: 14,
    minHeight: 64,
  },
  navText: {
    flex: 1,
    gap: 2,
  },
  navTitle: {
    fontSize: 17,
    fontWeight: '500',
  },
  navSummary: {
    fontSize: 13,
    opacity: 0.6,
  },
  groupHeading: {
    fontSize: 13,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    marginTop: 12,
  },
  settingRow: {
    flexDirection: 'row',
    gap: 12,
    alignItems: 'center',
    minHeight: 48,
  },
  settingText: {
    flex: 1,
    gap: 2,
  },
  settingLabel: {
    fontSize: 16,
  },
  settingDescription: {
    fontSize: 13,
    lineHeight: 18,
    opacity: 0.6,
  },
  hintText: {
    opacity: 0.5,
    fontStyle: 'italic',
    fontSize: 13,
  },
  warningText: {
    color: DESTRUCTIVE_COLOR,
    fontSize: 13,
  },
  disabled: {
    opacity: 0.4,
  },
  scanStatus: {
    opacity: 0.7,
    fontStyle: 'italic',
    fontSize: 13,
  },
  sourceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 4,
  },
  sourceInfo: {
    flex: 1,
    gap: 2,
  },
  sourceType: {
    fontWeight: '600',
    fontSize: 13,
  },
  sourceUri: {
    fontSize: 11,
    opacity: 0.6,
  },
  deleteButton: {
    padding: 8,
  },
  footerContainer: {
    marginTop: 16,
    marginBottom: 8,
    alignItems: 'center',
  },
  footerText: {
    fontSize: 12,
    opacity: 0.6,
  },
  slider: {
    alignSelf: 'stretch',
    height: 40,
  },
  actionRow: {
    gap: 2,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: DIVIDER_COLOR,
  },
  actionTitle: {
    fontSize: 15,
    fontWeight: '500',
  },
  destructiveText: {
    color: DESTRUCTIVE_COLOR,
  },
});
