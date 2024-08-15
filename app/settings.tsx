import Ionicons from '@expo/vector-icons/Ionicons';
import { Button, StyleSheet, Text, TextInput, View } from 'react-native';
import ParallaxScrollView from '@/components/ParallaxScrollView';
import { ThemedText } from '@/components/ThemedText';
import { ThemedView } from '@/components/ThemedView';
import { useCallback, useEffect, useRef, useState } from 'react';
import { router } from 'expo-router';
import * as ScopedStorage from "react-native-scoped-storage";
import { useDispatch, useSelector } from 'react-redux';
import { contentTypes, dataSources, selectDataSource, selectDirectory, selectMediaStructure, selectMediaType, selectPassword, selectViewOrientation, selectViewScale, setDataSource, setDirectory, setMediaStructure, setMediaType, setPassword, setViewOrientation, setViewScale, viewOrientations, viewTypes } from '@/store/settingsReducer';
import SelectDropdown from 'react-native-select-dropdown';
import Slider from '@react-native-community/slider';

export default function SettingsPrompt() {
  const [directory, setLocalDirectory] = useState(null as string | null);
  const [password, setLocalPassword] = useState(null as string | null);
  const [mediaType, setLocalMediaType] = useState("" as contentTypes);
  const [dataSource, setLocalDataSource] = useState("" as dataSources);
  const [mediaStructure, setLocalMediaStructure] = useState("" as viewTypes);
  const [structureDescription, setStructureDescription] = useState("");
  const [viewOrientation, setLocalViewOrientation] = useState("" as viewOrientations);
  const [viewScale, setLocalViewScale] = useState(2);

  const dispatch = useDispatch();
  const settingsPassword = useSelector(selectPassword);
  const settingsDirectory = useSelector(selectDirectory);
  const settingsMediaType = useSelector(selectMediaType);
  const settingsDataSource = useSelector(selectDataSource);
  const settingsMediaStructure = useSelector(selectMediaStructure);
  const settingsViewOrientation = useSelector(selectViewOrientation);
  const settingsViewScale = useSelector(selectViewScale);
  
  const mediaTypeRef = useRef(null);
  const dataSourceRef = useRef(null);
  const mediaStructureRef = useRef(null);
  const viewOrientationRef = useRef(null);

  const mediaTypeOptions = [
    {id: 'tv', label: 'TV'},
    {id: 'movies', label: 'Movies'},
  ];

  const dataSourceOptions = [
    {id: 'tvdb', label: 'TVDB'},
    // {id: 'imdb', label: 'IMDB'},
    // {id: 'moviedb', label: 'TheMovieDB'},
  ];

  const viewTypeOptions = [
    {id: 'flat', label: 'Flat', title: 'All episodes of all shows visible in one list'},
    {id: 'show', label: 'Show', title: 'A folder for each show, with all episodes of that show then visible in each folder'},
    {id: 'showplusseason', label: 'Show + Season', title: 'A folder for each show and season, with the episodes of that season in the folder'},
    {id: 'showslashseason', label: 'Show/Season', title: 'A folder for each show, with a further folder for each season, with episodes then visible within'},
  ];
  
  const uiTypeOptions = [
    {id: 'poster', label: 'Poster'},
    {id: 'banner', label: 'Banner'},
  ];
  
  useEffect(() => {
    console.log(`Got dir: ${settingsDirectory}, pass: ${settingsPassword}, media: ${settingsMediaType}, dataSource: ${settingsDataSource}, mediaStructure: ${settingsMediaStructure}, orientation: ${settingsViewOrientation}, scale: ${settingsViewScale}`);
    setLocalDirectory(settingsDirectory as string);
    setLocalPassword(settingsPassword as string);
    if (mediaTypeRef.current) (mediaTypeRef.current as any).selectIndex(mediaTypeOptions.findIndex(o => o.id === settingsMediaType));
    if (dataSourceRef.current) (dataSourceRef.current as any).selectIndex(dataSourceOptions.findIndex(o => o.id === settingsDataSource));
    if (mediaStructureRef.current) (mediaStructureRef.current as any).selectIndex(viewTypeOptions.findIndex(o => o.id === settingsMediaStructure));
    if (viewOrientationRef.current) (viewOrientationRef.current as any).selectIndex(uiTypeOptions.findIndex(o => o.id === settingsViewOrientation));

    setStructureDescription(viewTypeOptions.find(o => o.id === settingsMediaStructure)?.title ?? "");
  }, [settingsDirectory, settingsPassword, settingsMediaType, settingsDataSource, settingsMediaStructure, settingsViewOrientation, settingsViewScale]);

  const save = () => {
    console.log(`Saving dir: ${directory}, pass: ${password}, media: ${mediaType}, dataSource: ${dataSource}, mediaStructure: ${mediaStructure}, orientation: ${viewOrientation}, scale: ${viewScale}`);
    if (directory) {
      dispatch(setDirectory(directory));
    }
    if (password) {
      dispatch(setPassword(password));
    }
    if (mediaType) {
      dispatch(setMediaType(mediaType));
    }
    if (dataSource) {
      dispatch(setDataSource(dataSource));
    }
    if (mediaStructure) {
      dispatch(setMediaStructure(mediaStructure));
    }
    if (viewOrientation) {
      dispatch(setViewOrientation(viewOrientation));
    }
    if (viewScale) {
      dispatch(setViewScale(viewScale));
    }
    router.replace('/(drawer)')
  };

  const selectNewDirectory = useCallback(async () => {
    let selectedDir;
    try {
        selectedDir = await ScopedStorage.openDocumentTree(true);
    } catch (eNew) {
        // Toast to say selection cancelled?
        return;
    }
    setLocalDirectory(selectedDir.uri);
  }, []);

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
      <ThemedView style={styles.titleContainer}>
        <ThemedText>Password for settings:</ThemedText>
        <TextInput
          // style={styles.input}
          onChangeText={setLocalPassword}
          value={password ?? ""}
          placeholder="Settings password"
          keyboardType="default"
          secureTextEntry={false}
        />
      </ThemedView>
      <ThemedView style={styles.titleContainer}>
        <ThemedText>Select a directory:</ThemedText>
        <Button
            title="Change Directory"
            onPress={selectNewDirectory}
        />
      </ThemedView>
      <ThemedText>Directory is: {directory}</ThemedText>
      <ThemedView style={styles.titleContainer}>
        <ThemedText>Media type:</ThemedText>
        <SelectDropdown
          ref={mediaTypeRef}
          data={mediaTypeOptions}
          defaultValue={settingsMediaType}
          onSelect={(selectedItem, index) => {
            setLocalMediaType(selectedItem.id);
          }}
          renderButton={(selectedItem, isOpened) => {
            return (
              <View style={styles.dropdownButtonStyle}>
                <Text style={styles.dropdownButtonTxtStyle}>
                  {(selectedItem && selectedItem.label) || 'Please select...'}
                </Text>
                <Text>{isOpened ? "🔼" : "🔽"}</Text>
              </View>
            );
          }}
          renderItem={(item, index, isSelected) => {
            return (
              <View style={{...styles.dropdownItemStyle, ...(isSelected && {backgroundColor: '#D2D9DF'})}}>
                <Text style={styles.dropdownItemTxtStyle}>{item.label}</Text>
              </View>
            );
          }}
          showsVerticalScrollIndicator={false}
          dropdownStyle={styles.dropdownMenuStyle}
        />
      </ThemedView>
      <ThemedView style={styles.titleContainer}>
        <ThemedText>Data source:</ThemedText>
        <SelectDropdown
          ref={dataSourceRef}
          data={dataSourceOptions}
          defaultValue={settingsDataSource}
          onSelect={(selectedItem, index) => {
            setLocalDataSource(selectedItem.id);
          }}
          renderButton={(selectedItem, isOpened) => {
            return (
              <View style={styles.dropdownButtonStyle}>
                <Text style={styles.dropdownButtonTxtStyle}>
                  {(selectedItem && selectedItem.label) || 'Please select...'}
                </Text>
                <Text>{isOpened ? "🔼" : "🔽"}</Text>
              </View>
            );
          }}
          renderItem={(item, index, isSelected) => {
            return (
              <View style={{...styles.dropdownItemStyle, ...(isSelected && {backgroundColor: '#D2D9DF'})}}>
                <Text style={styles.dropdownItemTxtStyle}>{item.label}</Text>
              </View>
            );
          }}
          showsVerticalScrollIndicator={false}
          dropdownStyle={styles.dropdownMenuStyle}
        />
      </ThemedView>
      <ThemedView style={styles.titleContainer}>
        <ThemedText>Media structure:</ThemedText>
        <SelectDropdown
          ref={mediaStructureRef}
          data={viewTypeOptions}
          defaultValue={settingsMediaStructure}
          onSelect={(selectedItem, index) => {
            if (selectedItem.title) setStructureDescription(selectedItem.title);
            setLocalMediaStructure(selectedItem.id);
          }}
          renderButton={(selectedItem, isOpened) => {
            return (
              <View style={styles.dropdownButtonStyle}>
                <Text style={styles.dropdownButtonTxtStyle}>
                  {(selectedItem && selectedItem.label) || 'Please select...'}
                </Text>
                <Text>{isOpened ? "🔼" : "🔽"}</Text>
              </View>
            );
          }}
          renderItem={(item, index, isSelected) => {
            return (
              <View style={{...styles.dropdownItemStyle, ...(isSelected && {backgroundColor: '#D2D9DF'})}}>
                <Text style={styles.dropdownItemTxtStyle}>{item.label}</Text>
              </View>
            );
          }}
          showsVerticalScrollIndicator={false}
          dropdownStyle={styles.dropdownMenuStyle}
        />
      </ThemedView>
      <ThemedView>
        <ThemedText>{structureDescription}</ThemedText>
      </ThemedView>
      <ThemedView style={styles.titleContainer}>
        <ThemedText>Interface type:</ThemedText>
        <SelectDropdown
          ref={viewOrientationRef}
          data={uiTypeOptions}
          defaultValue={settingsViewOrientation}
          onSelect={(selectedItem, index) => {
            setLocalViewOrientation(selectedItem.id);
          }}
          renderButton={(selectedItem, isOpened) => {
            return (
              <View style={styles.dropdownButtonStyle}>
                <Text style={styles.dropdownButtonTxtStyle}>
                  {(selectedItem && selectedItem.label) || 'Please select...'}
                </Text>
                <Text>{isOpened ? "🔼" : "🔽"}</Text>
              </View>
            );
          }}
          renderItem={(item, index, isSelected) => {
            return (
              <View style={{...styles.dropdownItemStyle, ...(isSelected && {backgroundColor: '#D2D9DF'})}}>
                <Text style={styles.dropdownItemTxtStyle}>{item.label}</Text>
              </View>
            );
          }}
          showsVerticalScrollIndicator={false}
          dropdownStyle={styles.dropdownMenuStyle}
        />
      </ThemedView>
      <ThemedView style={styles.titleContainer}>
        <ThemedText>UI scale:</ThemedText>
        <Slider
          style={{width: 200, height: 40}}
          minimumValue={1}
          maximumValue={10}
          step={1}
          value={11-settingsViewScale}
          onSlidingComplete={handleUIScaleChange}
          minimumTrackTintColor="#FFFFFF"
          maximumTrackTintColor="#000000"
        />
      </ThemedView>
      <ThemedView style={styles.titleContainer}>
        <Button
            title="Save"
            onPress={save}
        />
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
  },
  dropdownButtonStyle: {
    width: 200,
    height: 50,
    backgroundColor: '#E9ECEF',
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
    color: '#151E26',
  },
  dropdownButtonArrowStyle: {
    fontSize: 28,
  },
  dropdownButtonIconStyle: {
    fontSize: 28,
    marginRight: 8,
  },
  dropdownMenuStyle: {
    backgroundColor: '#E9ECEF',
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
    color: '#151E26',
  },
  dropdownItemIconStyle: {
    fontSize: 28,
    marginRight: 8,
  },
});
