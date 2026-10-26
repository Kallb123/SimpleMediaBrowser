import { Button, StyleSheet, View } from 'react-native';
import { useCallback, useState } from 'react';
import { StorageAccessFramework } from 'expo-file-system/legacy';
import { Dropdown } from '@/components/Dropdown';
import { useDispatch } from 'react-redux';
import { addMediaSource, contentTypes, dataSources, IMediaSource } from '@/store/settingsReducer';
import { logger } from '@/scripts/Logger';

const MEDIA_TYPE_OPTIONS: { id: contentTypes; label: string }[] = [
  { id: 'tv', label: '📺 TV' },
  { id: 'movie', label: '🎬 Movies' },
  { id: 'audiobook', label: '🎧 Audiobooks' },
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
  const [selectedType, setSelectedType] = useState<contentTypes>('tv');
  const [selectedMetadataSource, setSelectedMetadataSource] = useState<dataSources | 'auto'>('auto');
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
        <Dropdown
          compact
          options={MEDIA_TYPE_OPTIONS}
          value={selectedType}
          onChange={setSelectedType}
          accessibilityLabel="Folder type"
        />
        <Dropdown
          compact
          options={METADATA_SOURCE_OPTIONS}
          value={selectedMetadataSource}
          onChange={setSelectedMetadataSource}
          accessibilityLabel="Metadata source"
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
});
