import { Button, StyleSheet, Text, View } from 'react-native';
import { useCallback, useRef, useState } from 'react';
import * as ScopedStorage from 'react-native-scoped-storage';
import SelectDropdown from 'react-native-select-dropdown';
import { useDispatch } from 'react-redux';
import { addMediaSource, contentTypes, IMediaSource } from '@/store/settingsReducer';
import { useColorScheme } from '@/hooks/useColorScheme';
import { Colors } from '@/constants/Colors';

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
  const colorScheme = useColorScheme() ?? 'light';
  const theme = Colors[colorScheme];
  const dropdownBg = colorScheme === 'dark' ? '#353636' : '#E9ECEF';
  const dropdownSelectedBg = colorScheme === 'dark' ? '#4A4A4A' : '#D2D9DF';

  const [selectedType, setSelectedType] = useState<contentTypes>('tv');
  const dropdownRef = useRef(null);
  const dispatch = useDispatch();

  const pickDirectory = useCallback(async () => {
    let selectedDir;
    try {
      selectedDir = await ScopedStorage.openDocumentTree(true);
    } catch {
      // User cancelled the picker
      return;
    }
    const source: IMediaSource = { uri: selectedDir.uri, contentType: selectedType };
    dispatch(addMediaSource(source));
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
