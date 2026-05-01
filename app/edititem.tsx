import { useLocalSearchParams, router } from 'expo-router';
import {
  ActivityIndicator,
  Button,
  FlatList,
  Linking,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  View,
} from 'react-native';
import { Image } from 'expo-image';
import * as DocumentPicker from 'expo-document-picker';
import { ThemedText } from '@/components/ThemedText';
import { ThemedTextInput } from '@/components/ThemedTextInput';
import { ThemedView } from '@/components/ThemedView';
import { useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import {
  selectMediaLibrary,
  selectMediaOverrides,
  selectMovies,
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

async function ensurePostersDir(): Promise<void> {
  const info = await FileSystem.getInfoAsync(POSTERS_DIR);
  if (!info.exists) {
    await FileSystem.makeDirectoryAsync(POSTERS_DIR, { intermediates: true });
  }
}

async function downloadPoster(tmdbId: string, posterPath: string): Promise<string> {
  await ensurePostersDir();
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

/**
 * Copy a locally picked image (file:// or content:// URI) into the app's
 * persistent smb_posters directory and return the local file:// URI.
 */
async function copyPickedPoster(sourceUri: string, key: string): Promise<string> {
  await ensurePostersDir();
  const safeName = key.replace(/[^a-zA-Z0-9_-]/g, '_');
  const localPath = POSTERS_DIR + `${safeName}_custom.jpg`;
  try {
    await FileSystem.copyAsync({ from: sourceUri, to: localPath });
  } catch {
    // Fall back to base64 read/write for SAF content:// URIs.
    const base64 = await FileSystem.StorageAccessFramework.readAsStringAsync(sourceUri, {
      encoding: FileSystem.EncodingType.Base64,
    });
    await FileSystem.writeAsStringAsync(localPath, base64, {
      encoding: FileSystem.EncodingType.Base64,
    });
  }
  return localPath;
}

export default function EditItemScreen() {
  const { itemType, itemKey, currentTitle } = useLocalSearchParams<{
    itemType: 'show' | 'movie' | 'episode';
    itemKey: string;
    currentTitle: string;
  }>();

  const dispatch = useDispatch();
  const mediaOverrides = useSelector(selectMediaOverrides);
  const mediaLibrary = useSelector(selectMediaLibrary);
  const movies = useSelector(selectMovies);
  const tmdbApiKey = useSelector(selectTmdbApiKey);

  const existingOverride = mediaOverrides[itemKey] ?? {};

  const [titleInput, setTitleInput] = useState(existingOverride.title ?? currentTitle ?? '');
  const [sortTitleInput, setSortTitleInput] = useState(existingOverride.sortTitle ?? '');

  // Current poster URI: prefer the override poster, then the library poster.
  const currentLibraryPoster = (() => {
    if (itemType === 'show') {
      const showName = itemKey.replace(/^show:/, '');
      return mediaLibrary[showName]?.poster ?? '';
    } else if (itemType === 'movie') {
      const path = itemKey.replace(/^movie:/, '');
      return movies.find((m) => m.path === path)?.poster ?? '';
    }
    return '';
  })();
  const [activePosterUri, setActivePosterUri] = useState<string>(
    existingOverride.poster || currentLibraryPoster || '',
  );

  // TMDB search state (only for show/movie)
  const [searchQuery, setSearchQuery] = useState(existingOverride.title ?? currentTitle ?? '');
  const [searchResults, setSearchResults] = useState<TmdbResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState('');
  const [applyingMatch, setApplyingMatch] = useState(false);
  const [matchApplied, setMatchApplied] = useState<number | null>(null);

  // Browse-locally state
  const [browsingLocally, setBrowsingLocally] = useState(false);

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

  /** Apply a chosen poster URI to the library and persist it in overrides. */
  const applyPoster = (localUri: string) => {
    setActivePosterUri(localUri);
    if (itemType === 'show') {
      const showName = itemKey.replace(/^show:/, '');
      dispatch(updateShowMetadata({ showName, tmdbId: mediaLibrary[showName]?.ids.tmdb ?? '', poster: localUri }));
    } else if (itemType === 'movie') {
      const path = itemKey.replace(/^movie:/, '');
      const movie = movies.find((m) => m.path === path);
      dispatch(updateMovieMetadata({ path, tmdbId: movie?.ids.tmdb ?? '', poster: localUri }));
    }
    // Persist the poster URI in mediaOverrides so it survives rescans.
    dispatch(setMediaOverride({ key: itemKey, override: { poster: localUri } }));
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

      if (localPosterUri) {
        applyPoster(localPosterUri);
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

  const handleBrowseLocally = async () => {
    setBrowsingLocally(true);
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: ['image/jpeg', 'image/png', 'image/webp'],
        copyToCacheDirectory: false,
      });
      if (result.type === 'cancel') return;
      logger.log('EditItem', `Local image picked: ${result.uri}`);
      const localUri = await copyPickedPoster(result.uri, itemKey);
      applyPoster(localUri);
      logger.log('EditItem', `Custom poster saved: ${localUri}`);
    } catch (e) {
      logger.error('EditItem', 'Browse locally failed', e);
    } finally {
      setBrowsingLocally(false);
    }
  };

  const handleGoogleImageSearch = () => {
    const query = encodeURIComponent(`${currentTitle ?? ''} poster`);
    const url = `https://www.google.com/search?q=${query}&tbm=isch`;
    logger.log('EditItem', `Opening Google Image Search: ${url}`);
    Linking.openURL(url).catch((e) => logger.warn('EditItem', 'Failed to open browser', e));
  };

  const itemTypeLabel =
    itemType === 'show' ? 'TV Show' : itemType === 'movie' ? 'Movie' : 'Episode';

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <ThemedView style={styles.header}>
        <ThemedText type="subtitle">Edit {itemTypeLabel}</ThemedText>
        <ThemedText style={styles.subtitle} numberOfLines={2}>{currentTitle}</ThemedText>
      </ThemedView>

      {/* Current poster preview + poster editing options (shows and movies only) */}
      {(itemType === 'show' || itemType === 'movie') && (
        <ThemedView style={styles.section}>
          <ThemedText type="defaultSemiBold" style={styles.sectionTitle}>Poster</ThemedText>

          {activePosterUri ? (
            <Image
              source={{ uri: activePosterUri }}
              style={styles.posterPreview}
              contentFit="contain"
            />
          ) : (
            <View style={styles.posterPlaceholder}>
              <ThemedText style={styles.placeholderIcon}>🎬</ThemedText>
              <ThemedText style={styles.hint}>No poster set</ThemedText>
            </View>
          )}

          <ThemedView style={styles.posterButtonRow}>
            <TouchableOpacity
              style={styles.posterButton}
              onPress={handleGoogleImageSearch}
            >
              <ThemedText style={styles.posterButtonText}>🔍 Google Images</ThemedText>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.posterButton}
              onPress={handleBrowseLocally}
              disabled={browsingLocally}
            >
              <ThemedText style={styles.posterButtonText}>
                {browsingLocally ? 'Picking…' : '📁 Browse Locally'}
              </ThemedText>
            </TouchableOpacity>
          </ThemedView>
          <ThemedText style={styles.hint}>
            Google Images opens your browser to search for a poster. Browse Locally lets you pick any image file from your device and copies it for offline use.
          </ThemedText>
        </ThemedView>
      )}

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
            Search TMDB for Poster
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
            Add a TMDB API key in Settings to enable TMDB poster search.
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
  posterPreview: {
    width: 120,
    height: 180,
    borderRadius: 6,
    backgroundColor: '#222',
    alignSelf: 'center',
  },
  posterPlaceholder: {
    width: 120,
    height: 180,
    borderRadius: 6,
    backgroundColor: '#333',
    alignSelf: 'center',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  posterButtonRow: {
    flexDirection: 'row',
    gap: 8,
    flexWrap: 'wrap',
  },
  posterButton: {
    flex: 1,
    backgroundColor: '#0a7ea4',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    alignItems: 'center',
  },
  posterButtonText: {
    color: '#fff',
    fontWeight: '600',
    fontSize: 13,
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
