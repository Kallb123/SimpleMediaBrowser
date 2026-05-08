import { Button, StyleSheet, Text, View } from 'react-native';
import { useCallback, useRef, useState } from 'react';
import { StorageAccessFramework } from 'expo-file-system/legacy';
import SelectDropdown from 'react-native-select-dropdown';
import { useDispatch } from 'react-redux';
import { addMediaSource, contentTypes, dataSources, IMediaSource } from '@/store/settingsReducer';
import { useColorScheme } from '@/hooks/useColorScheme';
import { Colors } from '@/constants/Colors';
import { logger } from '@/scripts/Logger';

const MEDIA_TYPE_OPTIONS: { id: contentTypes; label: string }[] = [
  { id: 'tv', label: '📺 TV' },
  { id: 'movie', label: '🎬 Movies' },
];

/**
 * Metadata source options. 'auto' means inherit the global setting.
 * Because 'auto' is not a value of `dataSources`, we handle it separately.
 */
const METADATA_SOURCE_OPTIONS: { id: dataSources | 'auto'; label: string }[] = [
  { id: 'auto', label: '🌐 Auto' },
  { id: 'tmdb', label: 'TMDB' },
  { id: 'tvdb', label: 'TheTVDB' },
];

export interface AddMediaSourceProps {
  /** Optional callback invoked after a new source has been added to the store. */
  onAdded?: (source: IMediaSource) => void;
}

/**
 * A reusable row that lets the user pick a content type (TV / Movies) and an
 * optional metadata source override, then select a directory.
 * On success it dispatches `addMediaSource` to the Redux store and optionally
 * calls `onAdded`.
 */
export function AddMediaSource({ onAdded }: AddMediaSourceProps) {
  const colorScheme = useColorScheme() === 'dark' ? 'dark' : 'light';
  const theme = Colors[colorScheme];
  const dropdownBg = colorScheme === 'dark' ? '#353636' : '#E9ECEF';
  const dropdownSelectedBg = colorScheme === 'dark' ? '#4A4A4A' : '#D2D9DF';

  const [selectedType, setSelectedType] = useState<contentTypes>('tv');
  const [selectedMetadataSource, setSelectedMetadataSource] = useState<dataSources | 'auto'>('auto');
  const dropdownRef = useRef(null);
  const metadataDropdownRef = useRef(null);
  const dispatch = useDispatch();

  const pickDirectory = useCallback(async () => {
    logger.log('AddMediaSource', `Opening directory picker for type: ${selectedType}, metadataSource: ${selectedMetadataSource}`);
    const result = await StorageAccessFramework.requestDirectoryPermissionsAsync();
    if (!result.granted) {
      logger.warn('AddMediaSource', 'User cancelled directory picker or permission was denied');
      return;
    }
    const uri = result.directoryUri;
    logger.log('AddMediaSource', `Directory selected: uri=${uri} type=${selectedType} metadataSource=${selectedMetadataSource}`);
    const source: IMediaSource = {
      uri,
      contentType: selectedType,
      metadataSource: selectedMetadataSource === 'auto' ? undefined : selectedMetadataSource,
    };
    dispatch(addMediaSource(source));
    logger.log('AddMediaSource', `Dispatched addMediaSource for uri=${uri}`);
    onAdded?.(source);
  }, [selectedType, selectedMetadataSource, dispatch, onAdded]);

  return (
    <View style={styles.container}>
      <View style={styles.row}>
        <SelectDropdown
          ref={dropdownRef}
          data={MEDIA_TYPE_OPTIONS}
          defaultValue={MEDIA_TYPE_OPTIONS[0]}
          onSelect={(item) => setSelectedType(item.id)}
          renderButton={(selectedItem, isOpened) => (
            <View style={[styles.dropdownButton, { backgroundColor: dropdownBg }]}>
              <Text style={[styles.dropdownButtonText, { color: theme.text }]}>
                {selectedItem ? selectedItem.label : 'Type…'}
              </Text>
              <Text>{isOpened ? '🔼' : '🔽'}</Text>
            </View>
          )}
          renderItem={(item, _index, isSelected) => (
            <View
              style={[
                styles.dropdownItem,
                { backgroundColor: isSelected ? dropdownSelectedBg : dropdownBg },
              ]}
            >
              <Text style={[styles.dropdownItemText, { color: theme.text }]}>{item.label}</Text>
            </View>
          )}
          showsVerticalScrollIndicator={false}
          dropdownStyle={[styles.dropdownMenu, { backgroundColor: dropdownBg }]}
        />
        <SelectDropdown
          ref={metadataDropdownRef}
          data={METADATA_SOURCE_OPTIONS}
          defaultValue={METADATA_SOURCE_OPTIONS[0]}
          onSelect={(item) => setSelectedMetadataSource(item.id)}
          renderButton={(selectedItem, isOpened) => (
            <View style={[styles.dropdownButton, { backgroundColor: dropdownBg }]}>
              <Text style={[styles.dropdownButtonText, { color: theme.text }]}>
                {selectedItem ? selectedItem.label : 'Source…'}
              </Text>
              <Text>{isOpened ? '🔼' : '🔽'}</Text>
            </View>
          )}
          renderItem={(item, _index, isSelected) => (
            <View
              style={[
                styles.dropdownItem,
                { backgroundColor: isSelected ? dropdownSelectedBg : dropdownBg },
              ]}
            >
              <Text style={[styles.dropdownItemText, { color: theme.text }]}>{item.label}</Text>
            </View>
          )}
          showsVerticalScrollIndicator={false}
          dropdownStyle={[styles.dropdownMenu, { backgroundColor: dropdownBg }]}
        />
        <Button title="Add Source" onPress={pickDirectory} accessibilityLabel="Add media source directory" />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: 4,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexWrap: 'wrap',
  },
  dropdownButton: {
    width: 120,
    height: 50,
    borderRadius: 12,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 12,
  },
  dropdownButtonText: {
    flex: 1,
    fontSize: 14,
    fontWeight: '500',
  },
  dropdownMenu: {
    borderRadius: 8,
  },
  dropdownItem: {
    width: '100%',
    flexDirection: 'row',
    paddingHorizontal: 12,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 8,
  },
  dropdownItemText: {
    flex: 1,
    fontSize: 16,
    fontWeight: '500',
  },
});


const MEDIA_TYPE_OPTIONS: { id: contentTypes; label: string }[] = [
  { id: 'tv', label: '📺 TV' },
  { id: 'movie', label: '🎬 Movies' },
];

export interface AddMediaSourceProps {
  /** Optional callback invoked after a new source has been added to the store. */
  onAdded?: (source: IMediaSource) => void;
}

/**
 * A reusable row that lets the user pick a content type (TV / Movies) and then
 * select a directory. On success it dispatches `addMediaSource` to the Redux store
 * and optionally calls `onAdded`.
 */
export function AddMediaSource({ onAdded }: AddMediaSourceProps) {
  const colorScheme = useColorScheme() === 'dark' ? 'dark' : 'light';
  const theme = Colors[colorScheme];
  const dropdownBg = colorScheme === 'dark' ? '#353636' : '#E9ECEF';
  const dropdownSelectedBg = colorScheme === 'dark' ? '#4A4A4A' : '#D2D9DF';

  const [selectedType, setSelectedType] = useState<contentTypes>('tv');
  const dropdownRef = useRef(null);
  const dispatch = useDispatch();

  const pickDirectory = useCallback(async () => {
    logger.log('AddMediaSource', `Opening directory picker for type: ${selectedType}`);
    const result = await StorageAccessFramework.requestDirectoryPermissionsAsync();
    if (!result.granted) {
      logger.warn('AddMediaSource', 'User cancelled directory picker or permission was denied');
      return;
    }
    const uri = result.directoryUri;
    logger.log('AddMediaSource', `Directory selected: uri=${uri} type=${selectedType}`);
    const source: IMediaSource = { uri, contentType: selectedType };
    dispatch(addMediaSource(source));
    logger.log('AddMediaSource', `Dispatched addMediaSource for uri=${uri}`);
    onAdded?.(source);
  }, [selectedType, dispatch, onAdded]);

  return (
    <View style={styles.row}>
      <SelectDropdown
        ref={dropdownRef}
        data={MEDIA_TYPE_OPTIONS}
        defaultValue={MEDIA_TYPE_OPTIONS[0]}
        onSelect={(item) => setSelectedType(item.id)}
        renderButton={(selectedItem, isOpened) => (
          <View style={[styles.dropdownButton, { backgroundColor: dropdownBg }]}>
            <Text style={[styles.dropdownButtonText, { color: theme.text }]}>
              {selectedItem ? selectedItem.label : 'Type…'}
            </Text>
            <Text>{isOpened ? '🔼' : '🔽'}</Text>
          </View>
        )}
        renderItem={(item, _index, isSelected) => (
          <View
            style={[
              styles.dropdownItem,
              { backgroundColor: isSelected ? dropdownSelectedBg : dropdownBg },
            ]}
          >
            <Text style={[styles.dropdownItemText, { color: theme.text }]}>{item.label}</Text>
          </View>
        )}
        showsVerticalScrollIndicator={false}
        dropdownStyle={[styles.dropdownMenu, { backgroundColor: dropdownBg }]}
      />
      <Button title="Add Source" onPress={pickDirectory} accessibilityLabel="Add media source directory" />
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  dropdownButton: {
    width: 140,
    height: 50,
    borderRadius: 12,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 12,
  },
  dropdownButtonText: {
    flex: 1,
    fontSize: 16,
    fontWeight: '500',
  },
  dropdownMenu: {
    borderRadius: 8,
  },
  dropdownItem: {
    width: '100%',
    flexDirection: 'row',
    paddingHorizontal: 12,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 8,
  },
  dropdownItemText: {
    flex: 1,
    fontSize: 16,
    fontWeight: '500',
  },
});
