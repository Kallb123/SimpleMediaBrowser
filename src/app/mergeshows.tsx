import { useLocalSearchParams, router, Stack } from 'expo-router';
import {
  Button,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  View,
} from 'react-native';
import { Image } from 'expo-image';
import { ThemedText } from '@/components/ThemedText';
import { ThemedView } from '@/components/ThemedView';
import { useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { selectMediaLibrary, selectMediaOverrides, mergeDuplicateShows } from '@/store/libraryReducer';
import { useEditMode } from '@/contexts/EditModeContext';
import { logger } from '@/scripts/Logger';

export default function MergeShowsScreen() {
  const { showKeys: showKeysParam } = useLocalSearchParams<{ showKeys: string }>();
  const showKeys: string[] = (() => {
    try {
      const parsed = JSON.parse(showKeysParam ?? '[]');
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  })();

  const dispatch = useDispatch();
  const mediaLibrary = useSelector(selectMediaLibrary);
  const mediaOverrides = useSelector(selectMediaOverrides);
  const { clearShowSelection } = useEditMode();

  const [keepKey, setKeepKey] = useState<string>(showKeys[0] ?? '');

  const handleMerge = () => {
    if (!keepKey || showKeys.length < 2) return;
    const removeKeys = showKeys.filter((k) => k !== keepKey);
    logger.log('MergeShows', `Merging: keeping "${keepKey}", removing [${removeKeys.map((k) => `"${k}"`).join(', ')}]`);
    dispatch(mergeDuplicateShows({ keepKey, removeKeys }));
    clearShowSelection();
    router.back();
  };

  if (showKeys.length < 2) {
    return (
      <ThemedView style={styles.screen}>
        <Stack.Screen options={{ title: 'Merge Shows' }} />
        <ThemedText style={styles.errorText}>Not enough shows selected to merge.</ThemedText>
      </ThemedView>
    );
  }

  return (
    <ThemedView style={styles.screen}>
      <Stack.Screen
        options={{
          title: 'Merge Shows',
          headerRight: () => (
            <Button
              title="Merge"
              onPress={handleMerge}
              disabled={!keepKey}
            />
          ),
        }}
      />
      <ScrollView contentContainerStyle={styles.content}>
        <ThemedText style={styles.instructions}>
          Select the show entry to keep as the canonical version. All episodes from the other
          entries will be merged into it.
        </ThemedText>

        {showKeys.map((showKey) => {
          const show = mediaLibrary[showKey];
          const displayTitle = mediaOverrides[`show:${showKey}`]?.title ?? show?.title ?? showKey;
          const poster = mediaOverrides[`show:${showKey}`]?.poster || show?.poster || '';
          const episodeCount = show
            ? Object.values(show.seasons).reduce(
                (total, season) => total + Object.keys(season.episodes).length,
                0,
              )
            : 0;
          const rawNames = show?.rawNames ?? [];
          const isKeep = keepKey === showKey;

          return (
            <TouchableOpacity
              key={showKey}
              style={[styles.showRow, isKeep && styles.showRowSelected]}
              onPress={() => setKeepKey(showKey)}
              accessibilityRole="radio"
              accessibilityState={{ checked: isKeep }}
            >
              {poster ? (
                <Image source={{ uri: poster }} style={styles.poster} contentFit="cover" />
              ) : (
                <View style={[styles.poster, styles.posterPlaceholder]}>
                  <ThemedText style={styles.posterPlaceholderIcon}>📺</ThemedText>
                </View>
              )}

              <View style={styles.showInfo}>
                <ThemedText style={styles.showTitle} numberOfLines={2}>
                  {displayTitle}
                </ThemedText>
                {show?.year ? (
                  <ThemedText style={styles.showMeta}>{show.year}</ThemedText>
                ) : null}
                <ThemedText style={styles.showMeta}>
                  {episodeCount} {episodeCount === 1 ? 'episode' : 'episodes'}
                </ThemedText>
                {rawNames.length > 0 && (
                  <ThemedText style={styles.showRawNames} numberOfLines={2}>
                    Also known as: {rawNames.join(', ')}
                  </ThemedText>
                )}
                {show?.ids.tmdb ? (
                  <ThemedText style={styles.tmdbBadge}>TMDB ✓</ThemedText>
                ) : null}
              </View>

              <View style={[styles.radioOuter, isKeep && styles.radioOuterSelected]}>
                {isKeep && <View style={styles.radioInner} />}
              </View>
            </TouchableOpacity>
          );
        })}

        <ThemedText style={styles.hint}>
          Long-press any show in the library to edit its details individually.
        </ThemedText>
      </ScrollView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  content: {
    padding: 16,
    gap: 12,
  },
  instructions: {
    fontSize: 14,
    opacity: 0.75,
    marginBottom: 4,
  },
  showRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(128,128,128,0.3)',
    padding: 10,
  },
  showRowSelected: {
    borderColor: '#0a7ea4',
    borderWidth: 2,
    backgroundColor: 'rgba(10,126,164,0.1)',
  },
  poster: {
    width: 56,
    height: 84,
    borderRadius: 6,
    backgroundColor: '#333',
  },
  posterPlaceholder: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  posterPlaceholderIcon: {
    fontSize: 24,
  },
  showInfo: {
    flex: 1,
    gap: 2,
  },
  showTitle: {
    fontSize: 15,
    fontWeight: '600',
  },
  showMeta: {
    fontSize: 12,
    opacity: 0.65,
  },
  showRawNames: {
    fontSize: 11,
    opacity: 0.55,
    fontStyle: 'italic',
  },
  tmdbBadge: {
    fontSize: 11,
    color: '#0a7ea4',
    fontWeight: '600',
    marginTop: 2,
  },
  radioOuter: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    borderColor: 'rgba(128,128,128,0.5)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioOuterSelected: {
    borderColor: '#0a7ea4',
  },
  radioInner: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: '#0a7ea4',
  },
  hint: {
    fontSize: 12,
    opacity: 0.55,
    textAlign: 'center',
    marginTop: 8,
  },
  errorText: {
    padding: 16,
    fontSize: 14,
    opacity: 0.7,
  },
});
