import Ionicons from '@expo/vector-icons/Ionicons';
import { Button, StyleSheet, Text, View, TouchableOpacity } from 'react-native';
import { ThemedTextInput } from '@/components/ThemedTextInput';
import ParallaxScrollView from '@/components/ParallaxScrollView';
import { ThemedText } from '@/components/ThemedText';
import { ThemedView } from '@/components/ThemedView';
import { useCallback, useEffect, useRef, useState } from 'react';
import { router } from 'expo-router';
import { useDispatch, useSelector } from 'react-redux';
import { dataSources, selectDataSource, selectMediaSources, selectMediaStructure, selectPassword, selectViewOrientation, selectViewScale, setDataSource, setMediaStructure, setPassword, setViewOrientation, setViewScale, viewOrientations, viewTypes, removeMediaSource } from '@/store/settingsReducer';
import SelectDropdown from 'react-native-select-dropdown';
import Slider from '@react-native-community/slider';
import { FileScanner } from '@/scripts/FileScanner';
import { useColorScheme } from '@/hooks/useColorScheme';
import { Colors } from '@/constants/Colors';
import { AddMediaSource } from '@/components/UI/AddMediaSource';
import { logger } from '@/scripts/Logger';

export default function SettingsPrompt() {
  const colorScheme = useColorScheme() ?? 'light';
  const theme = Colors[colorScheme];

  const dropdownBg = colorScheme === 'dark' ? '#353636' : '#E9ECEF';
  const dropdownSelectedBg = colorScheme === 'dark' ? '#4A4A4A' : '#D2D9DF';

  const [password, setLocalPassword] = useState(null as string | null);
  const [dataSource, setLocalDataSource] = useState("" as dataSources);
  const [mediaStructure, setLocalMediaStructure] = useState("" as viewTypes);
  const [structureDescription, setStructureDescription] = useState("");
  const [viewOrientation, setLocalViewOrientation] = useState("" as viewOrientations);
  const [viewScale, setLocalViewScale] = useState(2);

  const dispatch = useDispatch();
  const settingsPassword = useSelector(selectPassword);
  const mediaSources = useSelector(selectMediaSources);
  const settingsDataSource = useSelector(selectDataSource);
  const settingsMediaStructure = useSelector(selectMediaStructure);
  const settingsViewOrientation = useSelector(selectViewOrientation);
  const settingsViewScale = useSelector(selectViewScale);
  
  const dataSourceRef = useRef(null);
  const mediaStructureRef = useRef(null);
  const viewOrientationRef = useRef(null);

  const dataSourceOptions = [
    {id: 'tvdb', label: 'TVDB'},
  ];

  const viewTypeOptions = [
    {id: 'flat', label: 'Flat', title: 'All episodes of all shows visible in one list'},
    {id: 'show', label: 'Show', title: 'A folder for each show, with all episodes of that show then visible in each folder'},
    {id: 'show+season', label: 'Show + Season', title: 'A folder for each show and season, with the episodes of that season in the folder'},
    {id: 'show/season', label: 'Show/Season', title: 'A folder for each show, with a further folder for each season, with episodes then visible within'},
  ];
  
  const uiTypeOptions = [
    {id: 'poster', label: 'Poster'},
    {id: 'banner', label: 'Banner'},
  ];

  useEffect(() => {
    logger.log('Settings', `Screen mounted. Current state: dataSource=${settingsDataSource}, mediaStructure=${settingsMediaStructure}, viewOrientation=${settingsViewOrientation}, viewScale=${settingsViewScale}, sources=${mediaSources.length}`);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    setLocalPassword(settingsPassword as string);
    if (dataSourceRef.current) (dataSourceRef.current as any).selectIndex(dataSourceOptions.findIndex(o => o.id === settingsDataSource));
    if (mediaStructureRef.current) (mediaStructureRef.current as any).selectIndex(viewTypeOptions.findIndex(o => o.id === settingsMediaStructure));
    if (viewOrientationRef.current) (viewOrientationRef.current as any).selectIndex(uiTypeOptions.findIndex(o => o.id === settingsViewOrientation));
    setStructureDescription(viewTypeOptions.find(o => o.id === settingsMediaStructure)?.title ?? "");
  }, [settingsPassword, settingsDataSource, settingsMediaStructure, settingsViewOrientation, settingsViewScale]);

  const save = () => {
    logger.log('Settings', 'Save pressed – evaluating changes');
    let changeCount = 0;
    if (password && password !== settingsPassword) {
      logger.log('Settings', 'Persisting: password changed');
      dispatch(setPassword(password));
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
    logger.log('Settings', `Save complete – ${changeCount} setting(s) changed and persisted`);
    router.replace('/(drawer)')
  };

  const deleteSource = useCallback((uri: string) => {
    logger.log('Settings', `Removing media source: ${uri}`);
    dispatch(removeMediaSource(uri));
  }, [dispatch]);

  const scanNow = useCallback(async () => {
    logger.log('Settings', `Manual rescan triggered for ${mediaSources.length} source(s)`);
    await FileScanner.getInstance().scanAllSources(mediaSources);
  }, [mediaSources]);

  const handleUIScaleChange = (value: number) => {
    setLocalViewScale(11-value);
  }
  
  return (
    <ParallaxScrollView
      headerBackgroundColor={{ light: '#D0D0D0', dark: '#353636' }}
      headerImage={<Ionicons size={310} name="code-slash" style={styles.headerImage} />}>
      <ThemedView style={styles.titleContainer}>
        <ThemedText type="title">Settings</ThemedText>
      </ThemedView>

      {/* Password */}
      <ThemedView style={styles.titleContainer}>
        <ThemedText>Password for settings:</ThemedText>
        <ThemedTextInput
          onChangeText={setLocalPassword}
          value={password ?? ""}
          placeholder="Settings password"
          keyboardType="default"
          secureTextEntry={true}
        />
      </ThemedView>

      {/* Media Sources */}
      <ThemedView style={styles.sectionContainer}>
        <ThemedText type="subtitle">Media Sources</ThemedText>
        {mediaSources.length === 0 && (
          <ThemedText style={styles.emptyText}>No sources added yet.</ThemedText>
        )}
        {mediaSources.map((source) => (
          <ThemedView key={source.uri} style={styles.sourceRow}>
            <ThemedView style={styles.sourceInfo}>
              <ThemedText style={styles.sourceType}>{source.contentType === 'tv' ? '📺 TV' : '🎬 Movies'}</ThemedText>
              <ThemedText style={styles.sourceUri} numberOfLines={1}>{decodeURIComponent(source.uri)}</ThemedText>
            </ThemedView>
            <TouchableOpacity onPress={() => deleteSource(source.uri)} style={styles.deleteButton}>
              <ThemedText style={styles.deleteButtonText}>✕</ThemedText>
            </TouchableOpacity>
          </ThemedView>
        ))}

        {/* Add new source */}
        <AddMediaSource />
      </ThemedView>

      {/* Rescan */}
      <ThemedView style={styles.titleContainer}>
        <Button title="Rescan now" onPress={scanNow} />
      </ThemedView>

      {/* Data source */}
      <ThemedView style={styles.titleContainer}>
        <ThemedText>Data source:</ThemedText>
        <SelectDropdown
          ref={dataSourceRef}
          data={dataSourceOptions}
          defaultValue={settingsDataSource}
          onSelect={(selectedItem) => {
            setLocalDataSource(selectedItem.id);
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
      </ThemedView>

      {/* Media structure */}
      <ThemedView style={styles.titleContainer}>
        <ThemedText>Media structure (TV):</ThemedText>
        <SelectDropdown
          ref={mediaStructureRef}
          data={viewTypeOptions}
          defaultValue={settingsMediaStructure}
          onSelect={(selectedItem) => {
            if (selectedItem.title) setStructureDescription(selectedItem.title);
            setLocalMediaStructure(selectedItem.id);
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
      </ThemedView>
      <ThemedView>
        <ThemedText>{structureDescription}</ThemedText>
      </ThemedView>

      {/* Interface type */}
      <ThemedView style={styles.titleContainer}>
        <ThemedText>Interface type:</ThemedText>
        <SelectDropdown
          ref={viewOrientationRef}
          data={uiTypeOptions}
          defaultValue={settingsViewOrientation}
          onSelect={(selectedItem) => {
            setLocalViewOrientation(selectedItem.id);
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
      </ThemedView>

      {/* UI scale */}
      <ThemedView style={styles.titleContainer}>
        <ThemedText>UI scale:</ThemedText>
        <Slider
          style={{width: 200, height: 40}}
          minimumValue={1}
          maximumValue={10}
          step={1}
          value={11-settingsViewScale}
          onSlidingComplete={handleUIScaleChange}
          minimumTrackTintColor={colorScheme === 'dark' ? '#ECEDEE' : '#11181C'}
          maximumTrackTintColor={colorScheme === 'dark' ? '#687076' : '#9BA1A6'}
        />
      </ThemedView>

      {/* Save */}
      <ThemedView style={styles.titleContainer}>
        <Button title="Save" onPress={save} />
      </ThemedView>
    </ParallaxScrollView>
  );
}

const styles = StyleSheet.create({
  headerImage: {
    color: '#808080',
    bottom: -90,
    left: -35,
    position: 'absolute',
  },
  titleContainer: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'center',
  },
  sectionContainer: {
    gap: 8,
  },
  emptyText: {
    opacity: 0.5,
    fontStyle: 'italic',
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
    color: '#E55',
  },
  dropdownButtonStyle: {
    width: 140,
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
  dropdownItemIconStyle: {
    fontSize: 28,
    marginRight: 8,
  },
});
