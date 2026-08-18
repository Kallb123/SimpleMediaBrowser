import { Button, StyleSheet, Text, View, TouchableOpacity, Switch, ScrollView, Alert } from 'react-native';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import { useHeaderHeight } from '@react-navigation/elements';
import { ThemedTextInput } from '@/components/ThemedTextInput';
import { ThemedText } from '@/components/ThemedText';
import { ThemedView } from '@/components/ThemedView';
import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { router } from 'expo-router';
import { useNavigation } from '@react-navigation/native';
import { useDispatch, useSelector } from 'react-redux';
import { dataSources, IMediaSource, selectDataSource, selectMediaSources, selectMediaStructure, selectPassword, selectViewOrientation, selectViewScale, setDataSource, setMediaStructure, setPassword, setViewOrientation, setViewScale, viewOrientations, viewTypes, removeMediaSource, updateMediaSourceMetadata, selectTmdbApiKey, setTmdbApiKey, selectTvdbApiKey, setTvdbApiKey, selectTvdbPin, setTvdbPin, defaultPages, selectDefaultPage, setDefaultPage, selectEnablePosterFetching, setEnablePosterFetching, selectEnableThumbnailGeneration, setEnableThumbnailGeneration, selectRescanOnStartup, setRescanOnStartup, selectFetchEpisodeNames, setFetchEpisodeNames, selectFetchEpisodeThumbnails, setFetchEpisodeThumbnails, appColorSchemes, selectAppColorScheme, setAppColorScheme, sortOrders, selectSortOrder, setSortOrder } from '@/store/settingsReducer';
import { clearLibraryAndMovies, clearPosterOverrides, clearTvdbPosterOverrides, clearThumbnails, clearAllOverrides, setScanList } from '@/store/libraryReducer';
import SelectDropdown from 'react-native-select-dropdown';
import Slider from '@react-native-community/slider';
import { useColorScheme } from '@/hooks/useColorScheme';
import { Colors } from '@/constants/Colors';
import { AddMediaSource } from '@/components/ui/AddMediaSource';
import { useKeyboardAwareScroll } from '@/hooks/useKeyboardAwareScroll';
import { logger } from '@/scripts/Logger';
import Constants from 'expo-constants';
import { useEditMode } from '@/contexts/EditModeContext';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { exportJson, importJson, exportToFilesystem } from '@/scripts/ImportExportService';
import type { JsonExportOptions } from '@/scripts/ImportExportService';
import { LANDSCAPE_MAX_COLUMNS, LANDSCAPE_MIN_COLUMNS, PORTRAIT_MAX_COLUMNS, PORTRAIT_MIN_COLUMNS, mapScaleToColumns } from '@/utils/viewScale';

const DIVIDER_COLOR = 'rgba(128,128,128,0.35)';
const DESTRUCTIVE_COLOR = '#E55';

const dataSourceOptions = [
  {id: 'tmdb', label: 'TMDB'},
  {id: 'tvdb', label: 'TheTVDB'},
];

const metadataSourceOptions: { id: dataSources | 'auto'; label: string }[] = [
  { id: 'auto', label: '🌐 Auto' },
  { id: 'tmdb', label: 'TMDB' },
  { id: 'tvdb', label: 'TheTVDB' },
];

const viewTypeOptions = [
  {id: 'flat', label: 'Flat', title: 'All episodes of all shows visible in one list'},
  {id: 'show', label: 'Show', title: 'A folder for each show, with all episodes of that show then visible in each folder'},
  {id: 'show+season', label: 'Show + Season', title: 'A folder for each show and season, with the episodes of that season in the folder'},
  {id: 'show/season', label: 'Show/Season', title: 'A folder for each show, with a further folder for each season, with episodes then visible within'},
];

const uiTypeOptions = [
  {id: 'poster', label: 'Poster'},
  {id: 'list', label: 'List'},
];

const defaultPageOptions = [
  {id: 'home', label: 'Home (All)'},
  {id: 'tv', label: 'TV'},
  {id: 'movies', label: 'Movies'},
  {id: 'audiobooks', label: 'Audiobooks'},
];

const appColorSchemeOptions: { id: appColorSchemes; label: string }[] = [
  {id: 'system', label: 'System'},
  {id: 'light', label: 'Light'},
  {id: 'dark', label: 'Dark'},
];

const sortOrderOptions: { id: sortOrders; label: string }[] = [
  {id: 'alphabetical', label: 'A > Z'},
  {id: 'reverseAlphabetical', label: 'Z > A'},
  {id: 'lastOpened', label: 'Last opened'},
  {id: 'recentlyAdded', label: 'Recently added'},
];

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
          <ThemedText style={styles.emptyText}>Error: {this.state.message}</ThemedText>
          <ThemedText style={styles.emptyText}>Open Debug Logs for stack details.</ThemedText>
        </ThemedView>
      );
    }

    return this.props.children;
  }
}

export default function SettingsPrompt() {
  const colorScheme = useColorScheme() === 'dark' ? 'dark' : 'light';
  const theme = Colors[colorScheme];
  const appVersion = Constants.expoConfig?.version ?? 'unknown';
  const { drawerUnlocked } = useEditMode();
  const insets = useSafeAreaInsets();
  // See edititem.tsx for why we use the real header height here instead of
  // KeyboardAvoidingView's automaticOffset heuristic.
  const headerHeight = useHeaderHeight();
  const { scrollViewProps, extraBottomSpace, handleInputFocus, handleInputBlur } = useKeyboardAwareScroll();

  const dropdownBg = colorScheme === 'dark' ? '#353636' : '#E9ECEF';
  const dropdownSelectedBg = colorScheme === 'dark' ? '#4A4A4A' : '#D2D9DF';
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
  const [structureDescription, setStructureDescription] = useState("");
  const [viewOrientation, setLocalViewOrientation] = useState("" as viewOrientations);
  const [viewScale, setLocalViewScale] = useState(2);
  const [defaultPage, setLocalDefaultPage] = useState("home" as defaultPages);
  const [enablePosterFetching, setLocalEnablePosterFetching] = useState(true);
  const [enableThumbnailGeneration, setLocalEnableThumbnailGeneration] = useState(false);
  const [rescanOnStartup, setLocalRescanOnStartup] = useState(true);
  const [fetchEpisodeNames, setLocalFetchEpisodeNames] = useState(true);
  const [fetchEpisodeThumbnails, setLocalFetchEpisodeThumbnails] = useState(true);
  const [appColorScheme, setLocalAppColorScheme] = useState('system' as appColorSchemes);
  const [sortOrder, setLocalSortOrder] = useState('alphabetical' as sortOrders);
  const [scanning, setScanning] = useState(false);
  const [scanComplete, setScanComplete] = useState(false);
  const [troubleshootingExpanded, setTroubleshootingExpanded] = useState(false);
  const [importExportExpanded, setImportExportExpanded] = useState(false);
  const [exportIncludeSettings, setExportIncludeSettings] = useState(true);
  const [exportIncludeOverrides, setExportIncludeOverrides] = useState(true);
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

  const dataSourceRef = useRef(null);
  const mediaStructureRef = useRef(null);
  const viewOrientationRef = useRef(null);
  const defaultPageRef = useRef(null);
  const appColorSchemeRef = useRef(null);
  const sortOrderRef = useRef(null);

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
        const typeOk = source.contentType === 'tv' || source.contentType === 'movie' || source.contentType === 'audiobook';
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
    if (!drawerUnlocked) {
      logger.warn('Settings', 'Blocked settings access while drawer is locked');
      router.replace('/(drawer)');
      return;
    }
  }, [drawerUnlocked]);

  useEffect(() => {
    try {
      logger.log('Settings', `Screen mounted. Current state: dataSource=${settingsDataSource}, mediaStructure=${settingsMediaStructure}, viewOrientation=${settingsViewOrientation}, viewScale=${settingsViewScale}, sources=${safeMediaSources.length}, posters=${settingsEnablePosterFetching}, thumbnails=${settingsEnableThumbnailGeneration}, rescanOnStartup=${settingsRescanOnStartup}, fetchEpisodeNames=${settingsFetchEpisodeNames}, fetchEpisodeThumbnails=${settingsFetchEpisodeThumbnails}`);
    } catch (e) {
      logger.error('Settings', 'Exception while logging settings mount state', e as Error);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    try {
      setLocalPassword(settingsPassword);
      setLocalTmdbApiKey(settingsTmdbApiKey);
      setLocalTvdbApiKey(settingsTvdbApiKey);
      setLocalTvdbPin(settingsTvdbPin);
      const dataSourceIndex = dataSourceOptions.findIndex(o => o.id === settingsDataSource);
      if (dataSourceRef.current && dataSourceIndex >= 0) {
        (dataSourceRef.current as any).selectIndex(dataSourceIndex);
      }

      const mediaStructureIndex = viewTypeOptions.findIndex(o => o.id === settingsMediaStructure);
      if (mediaStructureRef.current && mediaStructureIndex >= 0) {
        (mediaStructureRef.current as any).selectIndex(mediaStructureIndex);
      }

      const viewOrientationIndex = uiTypeOptions.findIndex(o => o.id === settingsViewOrientation);
      if (viewOrientationRef.current && viewOrientationIndex >= 0) {
        (viewOrientationRef.current as any).selectIndex(viewOrientationIndex);
      }

      const defaultPageIndex = defaultPageOptions.findIndex(o => o.id === settingsDefaultPage);
      if (defaultPageRef.current && defaultPageIndex >= 0) {
        (defaultPageRef.current as any).selectIndex(defaultPageIndex);
      }

      setLocalViewScale(settingsViewScale);
      setLocalEnablePosterFetching(settingsEnablePosterFetching);
      setLocalEnableThumbnailGeneration(settingsEnableThumbnailGeneration);
      setLocalRescanOnStartup(settingsRescanOnStartup);
      setLocalFetchEpisodeNames(settingsFetchEpisodeNames);
      setLocalFetchEpisodeThumbnails(settingsFetchEpisodeThumbnails);

      const appColorSchemeIndex = appColorSchemeOptions.findIndex(o => o.id === settingsAppColorScheme);
      if (appColorSchemeRef.current && appColorSchemeIndex >= 0) {
        (appColorSchemeRef.current as any).selectIndex(appColorSchemeIndex);
      }
      setLocalAppColorScheme(settingsAppColorScheme);
      setStructureDescription(viewTypeOptions.find(o => o.id === settingsMediaStructure)?.title ?? "");

      const sortOrderIndex = sortOrderOptions.findIndex(o => o.id === settingsSortOrder);
      if (sortOrderRef.current && sortOrderIndex >= 0) {
        (sortOrderRef.current as any).selectIndex(sortOrderIndex);
      }
      setLocalSortOrder(settingsSortOrder);
    } catch (e) {
      logger.error('Settings', 'Exception while syncing local settings state', e as Error);
    }
  }, [settingsPassword, settingsTmdbApiKey, settingsTvdbApiKey, settingsTvdbPin, settingsDataSource, settingsMediaStructure, settingsViewOrientation, settingsViewScale, settingsDefaultPage, settingsEnablePosterFetching, settingsEnableThumbnailGeneration, settingsRescanOnStartup, settingsFetchEpisodeNames, settingsFetchEpisodeThumbnails, settingsAppColorScheme, settingsSortOrder]);

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
      logger.log('Settings', `Save complete – ${changeCount} setting(s) changed and persisted`);
      router.replace('/(drawer)');
    } catch (e) {
      logger.error('Settings', 'Exception while saving settings', e as Error);
    }
  }, [dispatch, password, settingsPassword, dataSource, settingsDataSource, mediaStructure, settingsMediaStructure, viewOrientation, settingsViewOrientation, viewScale, settingsViewScale, tmdbApiKey, settingsTmdbApiKey, tvdbApiKey, settingsTvdbApiKey, tvdbPin, settingsTvdbPin, defaultPage, settingsDefaultPage, enablePosterFetching, settingsEnablePosterFetching, enableThumbnailGeneration, settingsEnableThumbnailGeneration, rescanOnStartup, settingsRescanOnStartup, fetchEpisodeNames, settingsFetchEpisodeNames, fetchEpisodeThumbnails, settingsFetchEpisodeThumbnails, appColorScheme, settingsAppColorScheme, sortOrder, settingsSortOrder]);

  const navigation = useNavigation();
  const saveRef = useRef(save);
  useEffect(() => { saveRef.current = save; }, [save]);
  useLayoutEffect(() => {
    navigation.setOptions({
      headerRight: () => <Button title="Save" onPress={() => saveRef.current()} />,
    });
  }, [navigation]);

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
              dispatch(setScanList([]));
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

  const handleExportJson = useCallback(async () => {
    try {
      const options: JsonExportOptions = {
        includeSettings: exportIncludeSettings,
        includeOverrides: exportIncludeOverrides,
        includeMatches: exportIncludeMatches,
      };
      if (!options.includeSettings && !options.includeOverrides && !options.includeMatches) {
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
  }, [exportIncludeSettings, exportIncludeOverrides, exportIncludeMatches]);

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

  return (
    <SettingsErrorBoundary>
    <KeyboardAvoidingView style={styles.container} behavior="padding" keyboardVerticalOffset={headerHeight}>
    <ScrollView
      {...scrollViewProps}
      style={containerStyle}
      contentContainerStyle={[styles.content, { paddingBottom: 20 + insets.bottom + extraBottomSpace }]}
      keyboardShouldPersistTaps="handled"
    >

      {/* Access */}
      <View style={styles.section}>
        <ThemedText type="subtitle" style={styles.sectionTitle}>Access</ThemedText>
        <View style={styles.row}>
          <ThemedText style={styles.rowLabel}>Password for settings:</ThemedText>
          <ThemedTextInput
            onChangeText={setLocalPassword}
            onFocus={handleInputFocus}
            onBlur={handleInputBlur}
            value={password ?? ""}
            placeholder="Settings password"
            keyboardType="default"
            secureTextEntry={true}
          />
        </View>
      </View>

      {/* Media Sources */}
      <View style={styles.section}>
        <ThemedText type="subtitle" style={styles.sectionTitle}>Media Sources</ThemedText>
        {safeMediaSources.length === 0 && (
          <ThemedText style={styles.emptyText}>No sources added yet.</ThemedText>
        )}
        {safeMediaSources.map((source, index) => (
          <View key={source.uri} style={styles.sourceRow}>
            <View style={styles.sourceInfo}>
              <ThemedText style={styles.sourceType}>
                {`Library ${index + 1} · ${source.contentType === 'tv' ? '📺 TV' : source.contentType === 'audiobook' ? '🎧 Audiobooks' : '🎬 Movies'}`}
              </ThemedText>
              <ThemedText style={styles.sourceUri} numberOfLines={1}>{safeDecodeUri(source.uri)}</ThemedText>
            </View>
            {source.contentType !== 'audiobook' && (
            <SelectDropdown
              data={metadataSourceOptions}
              defaultValue={metadataSourceOptions.find(o => o.id === (source.metadataSource ?? 'auto'))}
              onSelect={(item) => {
                try {
                  dispatch(updateMediaSourceMetadata({
                    uri: source.uri,
                    metadataSource: item.id === 'auto' ? undefined : item.id as dataSources,
                  }));
                } catch (e) {
                  logger.error('Settings', 'Exception while updating media source metadata source', e as Error);
                }
              }}
              renderButton={(selectedItem, isOpened) => (
                <View style={[styles.sourceMetaDropdownButton, { backgroundColor: dropdownBg }]}>
                  <Text style={[styles.sourceMetaDropdownText, { color: theme.text }]}>
                    {selectedItem ? selectedItem.label : '🌐 Auto'}
                  </Text>
                  <Text>{isOpened ? '🔼' : '🔽'}</Text>
                </View>
              )}
              renderItem={(item, _index, isSelected) => (
                <View style={[styles.sourceMetaDropdownItem, { backgroundColor: isSelected ? dropdownSelectedBg : dropdownBg }]}>
                  <Text style={[styles.sourceMetaDropdownItemText, { color: theme.text }]}>{item.label}</Text>
                </View>
              )}
              showsVerticalScrollIndicator={false}
              dropdownStyle={[styles.dropdownMenuStyle, { backgroundColor: dropdownBg }]}
            />
            )}
            <TouchableOpacity onPress={() => deleteSource(source.uri)} style={styles.deleteButton}>
              <ThemedText style={styles.deleteButtonText}>✕</ThemedText>
            </TouchableOpacity>
          </View>
        ))}
        <AddMediaSource />
        <View style={styles.row}>
          <Button title={scanning ? 'Scanning…' : 'Rescan now'} onPress={scanNow} disabled={scanning} />
          {!scanning && scanComplete && <ThemedText style={styles.scanStatus}>✓ Scan complete</ThemedText>}
        </View>
        <View style={styles.row}>
          <ThemedText style={styles.rowLabel}>Rescan on startup:</ThemedText>
          <Switch
            value={rescanOnStartup}
            onValueChange={(value) => {
              try {
                setLocalRescanOnStartup(value);
              } catch (e) {
                logger.error('Settings', 'Exception while toggling rescan on startup', e as Error);
              }
            }}
          />
        </View>
        <ThemedText style={styles.emptyText}>
          When on, the library is automatically rescanned each time the app starts. Turn off to keep the existing library until you rescan manually.
        </ThemedText>
      </View>

      {/* Metadata */}
      <View style={styles.section}>
        <ThemedText type="subtitle" style={styles.sectionTitle}>Media Metadata</ThemedText>
        <View style={styles.row}>
          <ThemedText style={styles.rowLabel}>Data source:</ThemedText>
          <SelectDropdown
            ref={dataSourceRef}
            data={dataSourceOptions}
            defaultValue={dataSourceOptions.find(o => o.id === settingsDataSource)}
            onSelect={(selectedItem) => {
              try {
                setLocalDataSource(selectedItem.id);
              } catch (e) {
                logger.error('Settings', 'Exception while selecting data source', e as Error);
              }
            }}
            renderButton={(selectedItem, isOpened) => (
              <View style={[styles.dropdownButtonStyle, { backgroundColor: dropdownBg }]}>
                <Text style={[styles.dropdownButtonTxtStyle, { color: theme.text }]}>
                  {(selectedItem && selectedItem.label) || 'Please select...'}
                </Text>
                <Text>{isOpened ? "🔼" : "🔽"}</Text>
              </View>
            )}
            renderItem={(item, index, isSelected) => (
              <View style={{...styles.dropdownItemStyle, backgroundColor: isSelected ? dropdownSelectedBg : dropdownBg}}>
                <Text style={[styles.dropdownItemTxtStyle, { color: theme.text }]}>{item.label}</Text>
              </View>
            )}
            showsVerticalScrollIndicator={false}
            dropdownStyle={[styles.dropdownMenuStyle, { backgroundColor: dropdownBg }]}
          />
        </View>

        <ThemedText style={styles.rowLabel}>TMDB API Key:</ThemedText>
        <ThemedTextInput
          onChangeText={setLocalTmdbApiKey}
          onFocus={handleInputFocus}
          onBlur={handleInputBlur}
          value={tmdbApiKey ?? ""}
          placeholder="Paste your TMDB API key"
          keyboardType="default"
          secureTextEntry={false}
        />
        <ThemedText style={styles.emptyText}>
          Register for a free key at themoviedb.org. Posters are downloaded and cached locally for offline use.
        </ThemedText>

        <ThemedText style={styles.rowLabel}>TheTVDB API Key:</ThemedText>
        <ThemedTextInput
          onChangeText={setLocalTvdbApiKey}
          onFocus={handleInputFocus}
          onBlur={handleInputBlur}
          value={tvdbApiKey ?? ""}
          placeholder="Paste your TVDB API key"
          keyboardType="default"
          secureTextEntry={false}
        />
        <ThemedText style={styles.emptyText}>
          Optional. Register for a free key at thetvdb.com. Used for TV show metadata when TheTVDB is selected as the data source.
        </ThemedText>
        <ThemedText style={styles.rowLabel}>TheTVDB Subscriber PIN:</ThemedText>
        <ThemedTextInput
          onChangeText={setLocalTvdbPin}
          onFocus={handleInputFocus}
          onBlur={handleInputBlur}
          value={tvdbPin ?? ""}
          placeholder="Optional subscriber PIN"
          keyboardType="default"
          secureTextEntry={false}
        />
        <ThemedText style={styles.emptyText}>
          Optional. Required only for subscribers accessing extended metadata on thetvdb.com.
        </ThemedText>
        <View style={styles.row}>
          <ThemedText style={styles.rowLabel}>Fetch posters during scan:</ThemedText>
          <Switch
            value={enablePosterFetching}
            onValueChange={(value) => {
              try {
                setLocalEnablePosterFetching(value);
              } catch (e) {
                logger.error('Settings', 'Exception while toggling poster fetching', e as Error);
              }
            }}
          />
        </View>
        <ThemedText style={styles.emptyText}>
          Enabled by default. When off, scans skip metadata poster fetching even if an API key is configured.
        </ThemedText>
        <View style={styles.row}>
          <ThemedText style={styles.rowLabel}>Fetch episode names:</ThemedText>
          <Switch
            value={fetchEpisodeNames}
            onValueChange={(value) => {
              try {
                setLocalFetchEpisodeNames(value);
              } catch (e) {
                logger.error('Settings', 'Exception while toggling fetch episode names', e as Error);
              }
            }}
          />
        </View>
        <ThemedText style={styles.emptyText}>
          Enabled by default. When on, episode names are fetched from TMDB and displayed in place of locally-scanned titles.
        </ThemedText>
        <View style={styles.row}>
          <ThemedText style={styles.rowLabel}>Fetch episode thumbnails:</ThemedText>
          <Switch
            value={fetchEpisodeThumbnails}
            onValueChange={(value) => {
              try {
                setLocalFetchEpisodeThumbnails(value);
              } catch (e) {
                logger.error('Settings', 'Exception while toggling fetch episode thumbnails', e as Error);
              }
            }}
          />
        </View>
        <ThemedText style={styles.emptyText}>
          Enabled by default. When on, episode still images are fetched from TMDB and used as episode artwork in the grid.
        </ThemedText>
        <View style={styles.row}>
          <ThemedText style={styles.rowLabel}>Generate video thumbnails:</ThemedText>
          <Switch
            value={enableThumbnailGeneration}
            onValueChange={(value) => {
              try {
                setLocalEnableThumbnailGeneration(value);
              } catch (e) {
                logger.error('Settings', 'Exception while toggling thumbnail generation', e as Error);
              }
            }}
          />
        </View>
        <ThemedText style={styles.emptyText}>
          Disabled by default. When off, scans skip thumbnail generation. When on, scans generate thumbnails from the local video files.
        </ThemedText>
      </View>

      {/* Appearance */}
      <View style={styles.section}>
        <ThemedText type="subtitle" style={styles.sectionTitle}>Appearance and Layout</ThemedText>
        <View style={styles.row}>
          <ThemedText style={styles.rowLabel}>Color scheme:</ThemedText>
          <SelectDropdown
            ref={appColorSchemeRef}
            data={appColorSchemeOptions}
            defaultValue={appColorSchemeOptions.find(o => o.id === settingsAppColorScheme)}
            onSelect={(selectedItem) => {
              try {
                setLocalAppColorScheme(selectedItem.id as appColorSchemes);
              } catch (e) {
                logger.error('Settings', 'Exception while selecting color scheme', e as Error);
              }
            }}
            renderButton={(selectedItem, isOpened) => (
              <View style={[styles.dropdownButtonStyle, { backgroundColor: dropdownBg }]}>
                <Text style={[styles.dropdownButtonTxtStyle, { color: theme.text }]}>
                  {(selectedItem && selectedItem.label) || 'Please select...'}
                </Text>
                <Text>{isOpened ? "🔼" : "🔽"}</Text>
              </View>
            )}
            renderItem={(item, index, isSelected) => (
              <View style={{...styles.dropdownItemStyle, backgroundColor: isSelected ? dropdownSelectedBg : dropdownBg}}>
                <Text style={[styles.dropdownItemTxtStyle, { color: theme.text }]}>{item.label}</Text>
              </View>
            )}
            showsVerticalScrollIndicator={false}
            dropdownStyle={[styles.dropdownMenuStyle, { backgroundColor: dropdownBg }]}
          />
        </View>

        <View style={styles.row}>
          <ThemedText style={styles.rowLabel}>Sorting:</ThemedText>
          <SelectDropdown
            ref={sortOrderRef}
            data={sortOrderOptions}
            defaultValue={sortOrderOptions.find(o => o.id === settingsSortOrder)}
            onSelect={(selectedItem) => {
              try {
                setLocalSortOrder(selectedItem.id as sortOrders);
              } catch (e) {
                logger.error('Settings', 'Exception while selecting sort order', e as Error);
              }
            }}
            renderButton={(selectedItem, isOpened) => (
              <View style={[styles.dropdownButtonStyle, { backgroundColor: dropdownBg }]}>
                <Text style={[styles.dropdownButtonTxtStyle, { color: theme.text }]}>
                  {(selectedItem && selectedItem.label) || 'Please select...'}
                </Text>
                <Text>{isOpened ? "🔼" : "🔽"}</Text>
              </View>
            )}
            renderItem={(item, index, isSelected) => (
              <View style={{...styles.dropdownItemStyle, backgroundColor: isSelected ? dropdownSelectedBg : dropdownBg}}>
                <Text style={[styles.dropdownItemTxtStyle, { color: theme.text }]}>{item.label}</Text>
              </View>
            )}
            showsVerticalScrollIndicator={false}
            dropdownStyle={[styles.dropdownMenuStyle, { backgroundColor: dropdownBg }]}
          />
        </View>

        <View style={styles.row}>
          <ThemedText style={styles.rowLabel}>TV Show Navigation Structure:</ThemedText>
          <SelectDropdown
            ref={mediaStructureRef}
            data={viewTypeOptions}
            defaultValue={viewTypeOptions.find(o => o.id === settingsMediaStructure)}
            onSelect={(selectedItem) => {
              try {
                if (selectedItem.title) setStructureDescription(selectedItem.title);
                setLocalMediaStructure(selectedItem.id);
              } catch (e) {
                logger.error('Settings', 'Exception while selecting media structure', e as Error);
              }
            }}
            renderButton={(selectedItem, isOpened) => (
              <View style={[styles.dropdownButtonStyle, { backgroundColor: dropdownBg }]}>
                <Text style={[styles.dropdownButtonTxtStyle, { color: theme.text }]}>
                  {(selectedItem && selectedItem.label) || 'Please select...'}
                </Text>
                <Text>{isOpened ? "🔼" : "🔽"}</Text>
              </View>
            )}
            renderItem={(item, index, isSelected) => (
              <View style={{...styles.dropdownItemStyle, backgroundColor: isSelected ? dropdownSelectedBg : dropdownBg}}>
                <Text style={[styles.dropdownItemTxtStyle, { color: theme.text }]}>{item.label}</Text>
              </View>
            )}
            showsVerticalScrollIndicator={false}
            dropdownStyle={[styles.dropdownMenuStyle, { backgroundColor: dropdownBg }]}
          />
        </View>
        {structureDescription && (
          <ThemedText style={styles.emptyText}>{structureDescription}</ThemedText>
        )}

        <View style={styles.row}>
          <ThemedText style={styles.rowLabel}>Interface type:</ThemedText>
          <SelectDropdown
            ref={viewOrientationRef}
            data={uiTypeOptions}
            defaultValue={uiTypeOptions.find(o => o.id === settingsViewOrientation)}
            onSelect={(selectedItem) => {
              try {
                setLocalViewOrientation(selectedItem.id);
              } catch (e) {
                logger.error('Settings', 'Exception while selecting view orientation', e as Error);
              }
            }}
            renderButton={(selectedItem, isOpened) => (
              <View style={[styles.dropdownButtonStyle, { backgroundColor: dropdownBg }]}>
                <Text style={[styles.dropdownButtonTxtStyle, { color: theme.text }]}>
                  {(selectedItem && selectedItem.label) || 'Please select...'}
                </Text>
                <Text>{isOpened ? "🔼" : "🔽"}</Text>
              </View>
            )}
            renderItem={(item, index, isSelected) => (
              <View style={{...styles.dropdownItemStyle, backgroundColor: isSelected ? dropdownSelectedBg : dropdownBg}}>
                <Text style={[styles.dropdownItemTxtStyle, { color: theme.text }]}>{item.label}</Text>
              </View>
            )}
            showsVerticalScrollIndicator={false}
            dropdownStyle={[styles.dropdownMenuStyle, { backgroundColor: dropdownBg }]}
          />
        </View>

        <View style={styles.row}>
          <ThemedText style={styles.rowLabel}>UI scale:</ThemedText>
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
        </View>
        <ThemedText style={styles.emptyText}>
          {`Poster view will show about ${mapScaleToColumns(viewScale, PORTRAIT_MIN_COLUMNS, PORTRAIT_MAX_COLUMNS)} columns in portrait and ${mapScaleToColumns(viewScale, LANDSCAPE_MIN_COLUMNS, LANDSCAPE_MAX_COLUMNS)} columns in landscape.`}
        </ThemedText>

        <View style={styles.row}>
          <ThemedText style={styles.rowLabel}>Default page:</ThemedText>
          <SelectDropdown
            ref={defaultPageRef}
            data={defaultPageOptions}
            defaultValue={defaultPageOptions.find(o => o.id === settingsDefaultPage)}
            onSelect={(selectedItem) => {
              try {
                setLocalDefaultPage(selectedItem.id as defaultPages);
              } catch (e) {
                logger.error('Settings', 'Exception while selecting default page', e as Error);
              }
            }}
            renderButton={(selectedItem, isOpened) => (
              <View style={[styles.dropdownButtonStyle, { backgroundColor: dropdownBg }]}>
                <Text style={[styles.dropdownButtonTxtStyle, { color: theme.text }]}>
                  {(selectedItem && selectedItem.label) || 'Please select...'}
                </Text>
                <Text>{isOpened ? "🔼" : "🔽"}</Text>
              </View>
            )}
            renderItem={(item, index, isSelected) => (
              <View style={{...styles.dropdownItemStyle, backgroundColor: isSelected ? dropdownSelectedBg : dropdownBg}}>
                <Text style={[styles.dropdownItemTxtStyle, { color: theme.text }]}>{item.label}</Text>
              </View>
            )}
            showsVerticalScrollIndicator={false}
            dropdownStyle={[styles.dropdownMenuStyle, { backgroundColor: dropdownBg }]}
          />
        </View>
      </View>

      {/* Import / Export */}
      <View style={styles.section}>
        <TouchableOpacity
          style={styles.troubleshootingHeader}
          onPress={() => setImportExportExpanded(prev => !prev)}
          accessibilityRole="button"
          accessibilityState={{ expanded: importExportExpanded }}
        >
          <ThemedText type="subtitle" style={styles.sectionTitle}>Import / Export</ThemedText>
          <ThemedText style={styles.troubleshootingChevron}>{importExportExpanded ? '▲' : '▼'}</ThemedText>
        </TouchableOpacity>
        {importExportExpanded && (
          <View style={styles.troubleshootingContent}>
            {/* JSON export options */}
            <ThemedText style={styles.importExportLabel}>Export to JSON file: select what to include:</ThemedText>
            <View style={styles.row}>
              <Switch value={exportIncludeSettings} onValueChange={setExportIncludeSettings} />
              <ThemedText style={styles.rowLabel}>Settings (API keys, view options)</ThemedText>
            </View>
            <View style={styles.row}>
              <Switch value={exportIncludeOverrides} onValueChange={setExportIncludeOverrides} />
              <ThemedText style={styles.rowLabel}>Overrides (custom titles, sort titles)</ThemedText>
            </View>
            <View style={styles.row}>
              <Switch value={exportIncludeMatches} onValueChange={setExportIncludeMatches} />
              <ThemedText style={styles.rowLabel}>Matches (TMDB/TVDB IDs, episode names)</ThemedText>
            </View>
            <TouchableOpacity style={styles.importExportButton} onPress={handleExportJson}>
              <ThemedText style={styles.importExportButtonText}>📤 Export app state to JSON</ThemedText>
              <ThemedText style={styles.troubleshootingButtonDesc}>Saves selected data to a JSON file in a folder you choose.</ThemedText>
            </TouchableOpacity>
            <TouchableOpacity style={styles.importExportButton} onPress={handleImportJson}>
              <ThemedText style={styles.importExportButtonText}>📥 Import app state from JSON</ThemedText>
              <ThemedText style={styles.troubleshootingButtonDesc}>Restores settings, overrides and/or matches from a previously exported JSON file.</ThemedText>
            </TouchableOpacity>
            {/* Filesystem export */}
            <TouchableOpacity style={styles.importExportButton} onPress={handleExportToFilesystem}>
              <ThemedText style={styles.importExportButtonText}>💾 Export metadata to media folders</ThemedText>
              <ThemedText style={styles.troubleshootingButtonDesc}>Writes smb.json, poster.jpg and episode thumbnails alongside your media files. These are picked up automatically during the next library scan.</ThemedText>
            </TouchableOpacity>
          </View>
        )}
      </View>

      {/* Troubleshooting */}
      <View style={styles.section}>
        <TouchableOpacity
          style={styles.troubleshootingHeader}
          onPress={() => setTroubleshootingExpanded(prev => !prev)}
          accessibilityRole="button"
          accessibilityState={{ expanded: troubleshootingExpanded }}
        >
          <ThemedText type="subtitle" style={styles.sectionTitle}>Troubleshooting</ThemedText>
          <ThemedText style={styles.troubleshootingChevron}>{troubleshootingExpanded ? '▲' : '▼'}</ThemedText>
        </TouchableOpacity>
        {troubleshootingExpanded && (
          <View style={styles.troubleshootingContent}>
            <TouchableOpacity style={styles.troubleshootingButton} onPress={clearThumbnailCache}>
              <ThemedText style={styles.troubleshootingButtonText}>🗑 Clear thumbnail cache</ThemedText>
              <ThemedText style={styles.troubleshootingButtonDesc}>Deletes all generated video thumbnails from disk.</ThemedText>
            </TouchableOpacity>
            <TouchableOpacity style={styles.troubleshootingButton} onPress={clearPosterCache}>
              <ThemedText style={styles.troubleshootingButtonText}>🖼 Clear TMDB poster cache</ThemedText>
              <ThemedText style={styles.troubleshootingButtonDesc}>Deletes all TMDB-sourced posters and episode thumbnails, and resets poster overrides.</ThemedText>
            </TouchableOpacity>
            <TouchableOpacity style={styles.troubleshootingButton} onPress={clearTvdbCache}>
              <ThemedText style={styles.troubleshootingButtonText}>🖼 Clear TVDB poster cache</ThemedText>
              <ThemedText style={styles.troubleshootingButtonDesc}>Deletes all TheTVDB-sourced posters and episode thumbnails.</ThemedText>
            </TouchableOpacity>
            <TouchableOpacity style={styles.troubleshootingButton} onPress={clearScannedData}>
              <ThemedText style={styles.troubleshootingButtonText}>📂 Clear scanned data</ThemedText>
              <ThemedText style={styles.troubleshootingButtonDesc}>Removes all scanned TV and movie data from memory.</ThemedText>
            </TouchableOpacity>
            <TouchableOpacity style={styles.troubleshootingButton} onPress={clearAllOverridesAction}>
              <ThemedText style={styles.troubleshootingButtonText}>🔄 Clear all overrides</ThemedText>
              <ThemedText style={styles.troubleshootingButtonDesc}>Removes all custom overrides such as sort titles, display titles, poster selections, and TMDB rematch results.</ThemedText>
            </TouchableOpacity>
          </View>
        )}
      </View>

      <View style={styles.footerContainer}>
        <ThemedText style={styles.footerText}>Version {appVersion}</ThemedText>
      </View>
    </ScrollView>
    </KeyboardAvoidingView>
    </SettingsErrorBoundary>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    padding: 20,
    gap: 0,
  },
  crashContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
    gap: 8,
  },
  section: {
    gap: 12,
    paddingTop: 20,
    paddingBottom: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: DIVIDER_COLOR,
  },
  sectionTitle: {
    marginBottom: 2,
  },
  row: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'center',
  },
  rowLabel: {
    flex: 1,
  },
  emptyText: {
    opacity: 0.5,
    fontStyle: 'italic',
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
  deleteButtonText: {
    fontSize: 16,
    color: DESTRUCTIVE_COLOR,
  },
  sourceMetaDropdownButton: {
    height: 36,
    borderRadius: 8,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    gap: 4,
  },
  sourceMetaDropdownText: {
    fontSize: 13,
    fontWeight: '500',
  },
  sourceMetaDropdownItem: {
    width: '100%',
    flexDirection: 'row',
    paddingHorizontal: 12,
    paddingVertical: 8,
    alignItems: 'center',
  },
  sourceMetaDropdownItemText: {
    fontSize: 14,
    fontWeight: '500',
  },
  dropdownButtonStyle: {
    width: 220,
    height: 50,
    borderRadius: 12,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 12,
  },
  dropdownButtonTxtStyle: {
    flex: 1,
    fontSize: 18,
    fontWeight: '500',
  },
  dropdownButtonArrowStyle: {
    fontSize: 28,
  },
  dropdownButtonIconStyle: {
    fontSize: 28,
    marginRight: 8,
  },
  dropdownMenuStyle: {
    borderRadius: 8,
  },
  dropdownItemStyle: {
    width: '100%',
    flexDirection: 'row',
    paddingHorizontal: 12,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 8,
  },
  dropdownItemTxtStyle: {
    flex: 1,
    fontSize: 18,
    fontWeight: '500',
  },
  footerContainer: {
    marginTop: 24,
    marginBottom: 8,
    alignItems: 'center',
  },
  footerText: {
    fontSize: 12,
    opacity: 0.6,
  },
  slider: {
    width: 200,
    height: 40,
  },
  troubleshootingHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  troubleshootingChevron: {
    fontSize: 14,
    opacity: 0.6,
  },
  troubleshootingContent: {
    gap: 12,
  },
  troubleshootingButton: {
    gap: 2,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: DIVIDER_COLOR,
  },
  troubleshootingButtonText: {
    fontSize: 15,
    fontWeight: '500',
    color: DESTRUCTIVE_COLOR,
  },
  troubleshootingButtonDesc: {
    fontSize: 12,
    opacity: 0.55,
    fontStyle: 'italic',
  },
  importExportButton: {
    gap: 2,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: DIVIDER_COLOR,
  },
  importExportButtonText: {
    fontSize: 15,
    fontWeight: '500',
  },
  importExportLabel: {
    fontSize: 13,
    opacity: 0.7,
    fontStyle: 'italic',
  },
});
