import { useLocalSearchParams, router } from 'expo-router';
import {
  ActivityIndicator,
  Button,
  FlatList,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  View,
} from 'react-native';
import { Image } from 'expo-image';
import { ThemedText } from '@/components/ThemedText';
import { ThemedTextInput } from '@/components/ThemedTextInput';
import { ThemedView } from '@/components/ThemedView';
import { useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import {
  selectMediaOverrides,
  setMediaOverride,
  updateShowMetadata,
  updateMovieMetadata,
} from '@/store/libraryReducer';
import { selectTmdbApiKey } from '@/store/settingsReducer';
import { logger } from '@/scripts/Logger';
import * as FileSystem from 'expo-file-system';

const TMDB_BASE_URL = 'https://api.themoviedb.org/3';
const POSTER_THUMB_URL = 'https://image.tmdb.org/t/p/w185';
const POSTER_FULL_URL = 'https://image.tmdb.org/t/p/w500';
const POSTERS_DIR = (FileSystem.documentDirectory ?? '') + 'smb_posters/';

interface TmdbResult {
  id: number;
  title?: string;
  name?: string;
  poster_path: string | null;
  release_date?: string;
  first_air_date?: string;
}

async function downloadPoster(tmdbId: string, posterPath: string): Promise<string> {
  const info = await FileSystem.getInfoAsync(POSTERS_DIR);
  if (!info.exists) {
    await FileSystem.makeDirectoryAsync(POSTERS_DIR, { intermediates: true });
  }
  const safeName = tmdbId.replace(/[^a-zA-Z0-9_-]/g, '_');
  const localPath = POSTERS_DIR + `${safeName}.jpg`;
  const existing = await FileSystem.getInfoAsync(localPath);
  if (existing.exists) {
    return localPath;
  }
  const remoteUrl = POSTER_FULL_URL + posterPath;
  const result = await FileSystem.downloadAsync(remoteUrl, localPath);
  return result.uri;
}

export default function EditItemScreen() {
  const { itemType, itemKey, currentTitle } = useLocalSearchParams<{
    itemType: 'show' | 'movie' | 'episode';
    itemKey: string;
    currentTitle: string;
  }>();

  const dispatch = useDispatch();
  const mediaOverrides = useSelector(selectMediaOverrides);
  const tmdbApiKey = useSelector(selectTmdbApiKey);

  const existingOverride = mediaOverrides[itemKey] ?? {};

  const [titleInput, setTitleInput] = useState(existingOverride.title ?? currentTitle ?? '');
  const [sortTitleInput, setSortTitleInput] = useState(existingOverride.sortTitle ?? '');

  // TMDB search state (only for show/movie)
  const [searchQuery, setSearchQuery] = useState(existingOverride.title ?? currentTitle ?? '');
  const [searchResults, setSearchResults] = useState<TmdbResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState('');
  const [applyingMatch, setApplyingMatch] = useState(false);
  const [matchApplied, setMatchApplied] = useState<number | null>(null);

  const canRematch = (itemType === 'show' || itemType === 'movie') && !!tmdbApiKey;

  const handleSave = () => {
    logger.log('EditItem', `Saving overrides for ${itemKey}: title="${titleInput}" sortTitle="${sortTitleInput}"`);
    dispatch(setMediaOverride({
      key: itemKey,
      override: {
        title: titleInput.trim() || undefined,
        sortTitle: sortTitleInput.trim() || undefined,
      },
    }));
    router.back();
  };

  const handleSearch = async () => {
    if (!tmdbApiKey || !searchQuery.trim()) return;
    setSearching(true);
    setSearchError('');
    setSearchResults([]);
    try {
      const endpoint = itemType === 'movie' ? 'movie' : 'tv';
      const url =
        `${TMDB_BASE_URL}/search/${endpoint}` +
        `?api_key=${encodeURIComponent(tmdbApiKey)}` +
        `&query=${encodeURIComponent(searchQuery.trim())}` +
        `&language=en-US&page=1`;
      logger.log('EditItem', `TMDB search: ${endpoint} query="${searchQuery.trim()}"`);
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const data = await response.json();
      setSearchResults(data.results ?? []);
      if ((data.results ?? []).length === 0) {
        setSearchError('No results found.');
      }
    } catch (e) {
      logger.error('EditItem', 'TMDB search failed', e);
      setSearchError('Search failed. Check your API key and connection.');
    } finally {
      setSearching(false);
    }
  };

  const handleSelectResult = async (result: TmdbResult) => {
    if (!tmdbApiKey) return;
    setApplyingMatch(true);
    try {
      const tmdbId = String(result.id);
      const dateStr = result.release_date ?? result.first_air_date ?? '';
      const year = dateStr ? parseInt(dateStr.substring(0, 4), 10) : undefined;

      let localPosterUri: string | undefined;
      if (result.poster_path) {
        try {
          localPosterUri = await downloadPoster(tmdbId, result.poster_path);
        } catch (e) {
          logger.warn('EditItem', 'Poster download failed', e);
        }
      }

      // Update the in-library poster so it shows up immediately in the grid
      if (itemType === 'show') {
        // itemKey is "show:<showName>"
        const showName = itemKey.replace(/^show:/, '');
        dispatch(updateShowMetadata({
          showName,
          tmdbId,
          poster: localPosterUri ?? '',
        }));
      } else if (itemType === 'movie') {
        // itemKey is "movie:<path>"
        const path = itemKey.replace(/^movie:/, '');
        dispatch(updateMovieMetadata({
          path,
          tmdbId,
          poster: localPosterUri ?? '',
        }));
      }

      // Store override metadata (tmdbId + year) so it survives rescans
      dispatch(setMediaOverride({
        key: itemKey,
        override: { tmdbId, year },
      }));

      setMatchApplied(result.id);
      logger.log('EditItem', `Rematch applied: TMDB ID ${tmdbId}, year=${year}`);
    } catch (e) {
      logger.error('EditItem', 'Failed to apply rematch', e);
      setSearchError('Failed to apply match.');
    } finally {
      setApplyingMatch(false);
    }
  };

  const itemTypeLabel =
    itemType === 'show' ? 'TV Show' : itemType === 'movie' ? 'Movie' : 'Episode';

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <ThemedView style={styles.header}>
        <ThemedText type="subtitle">Edit {itemTypeLabel}</ThemedText>
        <ThemedText style={styles.subtitle} numberOfLines={2}>{currentTitle}</ThemedText>
      </ThemedView>

      {/* Title override */}
      <ThemedView style={styles.field}>
        <ThemedText style={styles.label}>Display Title</ThemedText>
        <ThemedTextInput
          value={titleInput}
          onChangeText={setTitleInput}
          placeholder="Override display title"
        />
      </ThemedView>

      {/* Sort title */}
      <ThemedView style={styles.field}>
        <ThemedText style={styles.label}>Sort Title</ThemedText>
        <ThemedTextInput
          value={sortTitleInput}
          onChangeText={setSortTitleInput}
          placeholder="Override sort order (e.g. 'Dark Knight, The')"
        />
        <ThemedText style={styles.hint}>
          Used to order the item in the grid. Leave empty to sort by display title.
        </ThemedText>
      </ThemedView>

      {/* TMDB Rematch (shows and movies only) */}
      {canRematch && (
        <ThemedView style={styles.section}>
          <ThemedText type="defaultSemiBold" style={styles.sectionTitle}>
            Rematch on TMDB
          </ThemedText>

          <ThemedView style={styles.searchRow}>
            <ThemedTextInput
              value={searchQuery}
              onChangeText={setSearchQuery}
              placeholder="Search TMDB…"
              style={styles.searchInput}
              onSubmitEditing={handleSearch}
              returnKeyType="search"
            />
            <TouchableOpacity
              style={styles.searchButton}
              onPress={handleSearch}
              disabled={searching || applyingMatch}
            >
              <ThemedText style={styles.searchButtonText}>Search</ThemedText>
            </TouchableOpacity>
          </ThemedView>

          {searching && <ActivityIndicator style={styles.spinner} />}
          {searchError !== '' && (
            <ThemedText style={styles.errorText}>{searchError}</ThemedText>
          )}
          {applyingMatch && (
            <ThemedText style={styles.hint}>Applying match…</ThemedText>
          )}

          {searchResults.length > 0 && (
            <FlatList
              data={searchResults}
              keyExtractor={(item) => String(item.id)}
              scrollEnabled={false}
              renderItem={({ item }) => {
                const title = item.title ?? item.name ?? '';
                const year = (item.release_date ?? item.first_air_date ?? '').substring(0, 4);
                const isSelected = matchApplied === item.id;
                return (
                  <TouchableOpacity
                    style={[styles.resultRow, isSelected && styles.resultRowSelected]}
                    onPress={() => handleSelectResult(item)}
                    disabled={applyingMatch}
                  >
                    {item.poster_path ? (
                      <Image
                        source={{ uri: POSTER_THUMB_URL + item.poster_path }}
                        style={styles.resultPoster}
                        contentFit="cover"
                      />
                    ) : (
                      <View style={[styles.resultPoster, styles.resultPosterPlaceholder]}>
                        <ThemedText style={styles.placeholderIcon}>🎬</ThemedText>
                      </View>
                    )}
                    <View style={styles.resultInfo}>
                      <ThemedText style={styles.resultTitle}>{title}</ThemedText>
                      {year !== '' && (
                        <ThemedText style={styles.resultYear}>{year}</ThemedText>
                      )}
                      {isSelected && (
                        <ThemedText style={styles.selectedLabel}>✔ Matched</ThemedText>
                      )}
                    </View>
                  </TouchableOpacity>
                );
              }}
            />
          )}
        </ThemedView>
      )}

      {!tmdbApiKey && (itemType === 'show' || itemType === 'movie') && (
        <ThemedView style={styles.section}>
          <ThemedText style={styles.hint}>
            Add a TMDB API key in Settings to enable rematching.
          </ThemedText>
        </ThemedView>
      )}

      {/* Save */}
      <ThemedView style={styles.saveRow}>
        <Button title="Save" onPress={handleSave} />
      </ThemedView>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    padding: 16,
    gap: 16,
  },
  header: {
    gap: 4,
    paddingBottom: 8,
  },
  subtitle: {
    opacity: 0.6,
    fontSize: 13,
  },
  field: {
    gap: 6,
  },
  label: {
    fontWeight: '600',
    fontSize: 14,
  },
  hint: {
    opacity: 0.6,
    fontSize: 12,
    fontStyle: 'italic',
  },
  section: {
    gap: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#CCC',
    paddingTop: 12,
  },
  sectionTitle: {
    fontSize: 15,
  },
  searchRow: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'center',
  },
  searchInput: {
    flex: 1,
  },
  searchButton: {
    backgroundColor: '#0a7ea4',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
  },
  searchButtonText: {
    color: '#fff',
    fontWeight: '600',
  },
  spinner: {
    marginVertical: 8,
  },
  errorText: {
    color: '#E55',
    fontSize: 13,
  },
  resultRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#CCC',
  },
  resultRowSelected: {
    backgroundColor: 'rgba(10,126,164,0.12)',
    borderRadius: 6,
  },
  resultPoster: {
    width: 50,
    height: 75,
    borderRadius: 4,
    backgroundColor: '#333',
  },
  resultPosterPlaceholder: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  placeholderIcon: {
    fontSize: 24,
  },
  resultInfo: {
    flex: 1,
    gap: 2,
  },
  resultTitle: {
    fontWeight: '600',
    fontSize: 14,
  },
  resultYear: {
    opacity: 0.6,
    fontSize: 12,
  },
  selectedLabel: {
    color: '#0a7ea4',
    fontSize: 12,
    fontWeight: '600',
  },
  saveRow: {
    paddingVertical: 8,
  },
});
