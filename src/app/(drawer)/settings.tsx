import { Button, StyleSheet, Text, View, TouchableOpacity, Switch, ScrollView, Alert } from 'react-native';
import { ThemedTextInput } from '@/components/ThemedTextInput';
import { ThemedText } from '@/components/ThemedText';
import { ThemedView } from '@/components/ThemedView';
import React from 'react';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { router } from 'expo-router';
import { useNavigation } from '@react-navigation/native';
import { useDispatch, useSelector } from 'react-redux';
import { dataSources, IMediaSource, selectDataSource, selectMediaSources, selectMediaStructure, selectPassword, selectViewOrientation, selectViewScale, setDataSource, setMediaStructure, setPassword, setViewOrientation, setViewScale, viewOrientations, viewTypes, removeMediaSource, selectTmdbApiKey, setTmdbApiKey, defaultPages, selectDefaultPage, setDefaultPage, selectEnablePosterFetching, setEnablePosterFetching, selectEnableThumbnailGeneration, setEnableThumbnailGeneration } from '@/store/settingsReducer';
import { clearLibraryAndMovies, clearPosterOverrides, clearThumbnails, clearAllOverrides, setScanList } from '@/store/libraryReducer';
import SelectDropdown from 'react-native-select-dropdown';
import Slider from '@react-native-community/slider';
import { useColorScheme } from '@/hooks/useColorScheme';
import { Colors } from '@/constants/Colors';
import { AddMediaSource } from '@/components/ui/AddMediaSource';
import { logger } from '@/scripts/Logger';
import Constants from 'expo-constants';
import { useEditMode } from '@/contexts/EditModeContext';

const DIVIDER_COLOR = 'rgba(128,128,128,0.35)';
const DESTRUCTIVE_COLOR = '#E55';

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

  const dropdownBg = colorScheme === 'dark' ? '#353636' : '#E9ECEF';
  const dropdownSelectedBg = colorScheme === 'dark' ? '#4A4A4A' : '#D2D9DF';
  const containerStyle = useMemo(
    () => [styles.container, { backgroundColor: theme.background }],
    [theme.background],
  );

  const [password, setLocalPassword] = useState(null as string | null);
  const [tmdbApiKey, setLocalTmdbApiKey] = useState(null as string | null);
  const [dataSource, setLocalDataSource] = useState("" as dataSources);
  const [mediaStructure, setLocalMediaStructure] = useState("" as viewTypes);
  const [structureDescription, setStructureDescription] = useState("");
  const [viewOrientation, setLocalViewOrientation] = useState("" as viewOrientations);
  const [viewScale, setLocalViewScale] = useState(2);
  const [defaultPage, setLocalDefaultPage] = useState("home" as defaultPages);
  const [enablePosterFetching, setLocalEnablePosterFetching] = useState(true);
  const [enableThumbnailGeneration, setLocalEnableThumbnailGeneration] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [scanComplete, setScanComplete] = useState(false);
  const [troubleshootingExpanded, setTroubleshootingExpanded] = useState(false);

  const dispatch = useDispatch();
  const settingsPassword = useSelector(selectPassword);
  const mediaSources = useSelector(selectMediaSources);
  const settingsDataSource = useSelector(selectDataSource);
  const settingsTmdbApiKey = useSelector(selectTmdbApiKey);
  const settingsMediaStructure = useSelector(selectMediaStructure);
  const settingsViewOrientation = useSelector(selectViewOrientation);
  const settingsViewScale = useSelector(selectViewScale);
  const settingsDefaultPage = useSelector(selectDefaultPage);
  const settingsEnablePosterFetching = useSelector(selectEnablePosterFetching);
  const settingsEnableThumbnailGeneration = useSelector(selectEnableThumbnailGeneration);

  const dataSourceRef = useRef(null);
  const mediaStructureRef = useRef(null);
  const viewOrientationRef = useRef(null);
  const defaultPageRef = useRef(null);

  const dataSourceOptions = [
    {id: 'tmdb', label: 'TMDB'},
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
    {id: 'home', label: 'Home (TV + Movies)'},
    {id: 'tv', label: 'TV'},
    {id: 'movies', label: 'Movies'},
  ];

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
        const typeOk = source.contentType === 'tv' || source.contentType === 'movie';
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
      logger.log('Settings', `Screen mounted. Current state: dataSource=${settingsDataSource}, mediaStructure=${settingsMediaStructure}, viewOrientation=${settingsViewOrientation}, viewScale=${settingsViewScale}, sources=${safeMediaSources.length}, posters=${settingsEnablePosterFetching}, thumbnails=${settingsEnableThumbnailGeneration}`);
    } catch (e) {
      logger.error('Settings', 'Exception while logging settings mount state', e as Error);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    try {
      setLocalPassword(settingsPassword);
      setLocalTmdbApiKey(settingsTmdbApiKey);
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
      setStructureDescription(viewTypeOptions.find(o => o.id === settingsMediaStructure)?.title ?? "");
    } catch (e) {
      logger.error('Settings', 'Exception while syncing local settings state', e as Error);
    }
  }, [settingsPassword, settingsTmdbApiKey, settingsDataSource, settingsMediaStructure, settingsViewOrientation, settingsViewScale, settingsDefaultPage, settingsEnablePosterFetching, settingsEnableThumbnailGeneration]);

  const save = () => {
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
      logger.log('Settings', `Save complete – ${changeCount} setting(s) changed and persisted`);
      router.replace('/(drawer)');
    } catch (e) {
      logger.error('Settings', 'Exception while saving settings', e as Error);
    }
  };

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
      'This will delete all downloaded poster images from disk and reset any poster overrides. Posters will be re-fetched on the next scan.',
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
  
  return (
    <SettingsErrorBoundary>
    <ScrollView style={containerStyle} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">

      {/* Access */}
      <View style={styles.section}>
        <ThemedText type="subtitle" style={styles.sectionTitle}>Access</ThemedText>
        <View style={styles.row}>
          <ThemedText style={styles.rowLabel}>Password for settings:</ThemedText>
          <ThemedTextInput
            onChangeText={setLocalPassword}
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
        {safeMediaSources.map((source) => (
          <View key={source.uri} style={styles.sourceRow}>
            <View style={styles.sourceInfo}>
              <ThemedText style={styles.sourceType}>{source.contentType === 'tv' ? '📺 TV' : '🎬 Movies'}</ThemedText>
              <ThemedText style={styles.sourceUri} numberOfLines={1}>{safeDecodeUri(source.uri)}</ThemedText>
            </View>
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
          value={tmdbApiKey ?? ""}
          placeholder="Paste your TMDB API key"
          keyboardType="default"
          secureTextEntry={false}
        />
        <ThemedText style={styles.emptyText}>
          Register for a free key at themoviedb.org. Posters are downloaded and cached locally for offline use.
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
          Enabled by default. When off, scans skip TMDB poster fetching even if an API key is configured.
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
            value={11-settingsViewScale}
            onSlidingComplete={handleUIScaleChange}
            minimumTrackTintColor={colorScheme === 'dark' ? '#ECEDEE' : '#11181C'}
            maximumTrackTintColor={colorScheme === 'dark' ? '#687076' : '#9BA1A6'}
          />
        </View>

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
              <ThemedText style={styles.troubleshootingButtonText}>🖼 Clear poster overrides</ThemedText>
              <ThemedText style={styles.troubleshootingButtonDesc}>Deletes all downloaded posters and resets poster overrides.</ThemedText>
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
});
