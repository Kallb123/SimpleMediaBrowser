import { useLocalSearchParams, router, Stack } from 'expo-router';
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
import { useEffect, useState } from 'react';
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
import { File, Directory, Paths } from 'expo-file-system';

const TMDB_BASE_URL = 'https://api.themoviedb.org/3';
const POSTER_THUMB_URL = 'https://image.tmdb.org/t/p/w185';
const POSTER_FULL_URL = 'https://image.tmdb.org/t/p/w500';
const POSTERS_DIR = new Directory(Paths.document, 'smb_posters');
const DIVIDER_COLOR = 'rgba(128,128,128,0.35)';

/**
 * Remove common year suffixes so TMDB can find titles like "Breaking Bad (2008)"
 * or "Movie Title 2008". Strips patterns like "(2008)", "[2008]", or " 2008" at
 * the end of the string.
 */
function stripYearSuffix(title: string): string {
  return title.replace(/\s*[\[(]?\d{4}[\])]?\s*$/, '').trim();
}

interface TmdbResult {
  id: number;
  title?: string;
  name?: string;
  poster_path: string | null;
  release_date?: string;
  first_air_date?: string;
}

function ensurePostersDir(): void {
  if (!POSTERS_DIR.exists) {
    POSTERS_DIR.create({ intermediates: true, idempotent: true });
  }
}

/**
 * Download a TMDB poster image to local storage and return the local file URI.
 * `cacheKey` is used as the filename (sanitised); using the poster path
 * basename (e.g. "aBcDeFg123" from "/aBcDeFg123.jpg") ensures each unique
 * TMDB image path maps to its own cached file.
 */
async function downloadPoster(cacheKey: string, posterPath: string): Promise<string> {
  ensurePostersDir();
  const safeName = cacheKey.replace(/[^a-zA-Z0-9_-]/g, '_');
  const localFile = new File(POSTERS_DIR, `${safeName}.jpg`);
  if (localFile.exists) {
    return localFile.uri;
  }
  const remoteUrl = POSTER_FULL_URL + posterPath;
  await File.downloadFileAsync(remoteUrl, localFile);
  return localFile.uri;
}

/**
 * Copy a locally picked image (file:// or content:// URI) into the app's
 * persistent smb_posters directory and return the local file:// URI.
 */
async function copyPickedPoster(sourceUri: string, key: string): Promise<string> {
  ensurePostersDir();
  const safeName = key.replace(/[^a-zA-Z0-9_-]/g, '_');
  const localFile = new File(POSTERS_DIR, `${safeName}_custom.jpg`);
  try {
    const source = new File(sourceUri);
    await source.copy(localFile);
  } catch {
    // Fall back to base64 read/write for SAF content:// URIs.
    const source = new File(sourceUri);
    const base64 = await source.base64();
    await localFile.write(base64, { encoding: 'base64' });
  }
  return localFile.uri;
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
  // Tracks which specific poster was last applied, scoped to a result ID to avoid
  // false highlights if two results share the same poster path.
  const [selectedPoster, setSelectedPoster] = useState<{ resultId: number; posterPath: string } | null>(null);

  // Per-result expandable poster gallery
  const [expandedResultId, setExpandedResultId] = useState<number | null>(null);
  const [postersByResultId, setPostersByResultId] = useState<Record<number, string[]>>({});
  const [loadingPostersForId, setLoadingPostersForId] = useState<number | null>(null);

  // Browse-locally state
  const [browsingLocally, setBrowsingLocally] = useState(false);

  const canRematch = (itemType === 'show' || itemType === 'movie') && !!tmdbApiKey;

  useEffect(() => {
    const overridesSummary = Object.keys(existingOverride).length > 0
      ? JSON.stringify(existingOverride)
      : 'none';
    logger.log('EditItem', `Screen opened – type=${itemType} key="${itemKey}" title="${currentTitle}" existingOverrides=${overridesSummary}`);
  // Log only once on mount; params come from navigation and do not change during the screen's lifetime.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
      const parsedPath = itemKey.replace(/^movie:/, '');
      const movie = movies.find((m) => m.parsedPath === parsedPath);
      dispatch(updateMovieMetadata({ path: movie?.path ?? parsedPath, tmdbId: movie?.ids.tmdb ?? '', poster: localUri }));
    }
    // Persist the poster URI in mediaOverrides so it survives rescans.
    dispatch(setMediaOverride({ key: itemKey, override: { poster: localUri } }));
  };

  const handleSearch = async () => {
    if (!tmdbApiKey || !searchQuery.trim()) return;
    setSearching(true);
    setSearchError('');
    setSearchResults([]);
    // Reset expanded state so stale galleries from prior searches are cleared.
    setExpandedResultId(null);
    setPostersByResultId({});
    setLoadingPostersForId(null);
    try {
      const endpoint = itemType === 'movie' ? 'movie' : 'tv';
      const tmdbQuery = stripYearSuffix(searchQuery.trim());
      const url =
        `${TMDB_BASE_URL}/search/${endpoint}` +
        `?api_key=${encodeURIComponent(tmdbApiKey)}` +
        `&query=${encodeURIComponent(tmdbQuery)}` +
        `&language=en-US&page=1`;
      logger.log('EditItem', `TMDB search: ${endpoint} query="${tmdbQuery}"`);
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

  /**
   * Toggle the poster gallery for a search result.
   * First expansion fetches all poster images from the TMDB images endpoint.
   */
  const fetchAndExpandResult = async (result: TmdbResult) => {
    if (!tmdbApiKey) return;
    const id = result.id;

    if (expandedResultId === id) {
      setExpandedResultId(null);
      return;
    }
    setExpandedResultId(id);

    if (postersByResultId[id] !== undefined) return; // already fetched

    setLoadingPostersForId(id);
    try {
      const endpoint = itemType === 'movie' ? 'movie' : 'tv';
      const url =
        `${TMDB_BASE_URL}/${endpoint}/${id}/images` +
        `?api_key=${encodeURIComponent(tmdbApiKey)}` +
        `&include_image_language=en,null`;
      logger.log('EditItem', `Fetching TMDB images for ${endpoint} ID ${id}`);
      const response = await fetch(url);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      const paths = (data.posters ?? []).map((p: { file_path: string }) => p.file_path) as string[];
      // Fall back to the search-result thumbnail if no dedicated posters are returned.
      const resolved = paths.length > 0 ? paths : (result.poster_path ? [result.poster_path] : []);
      // Only cache when there's something to show; an empty result is not cached
      // so the user can retry by collapsing and re-expanding.
      if (resolved.length > 0) {
        setPostersByResultId((prev) => ({ ...prev, [id]: resolved }));
      }
    } catch (e) {
      logger.warn('EditItem', 'Failed to fetch TMDB images', e);
      // Do not cache on error so the user can retry by collapsing and re-expanding.
      // Clear the expanded state so the gallery is closed on failure.
      setExpandedResultId(null);
    } finally {
      setLoadingPostersForId(null);
    }
  };

  /** Download a specific TMDB poster and apply it to the item. */
  const handleSelectPoster = async (result: TmdbResult, posterPath: string) => {
    if (!tmdbApiKey) return;
    setApplyingMatch(true);
    try {
      const tmdbId = String(result.id);
      const dateStr = result.release_date ?? result.first_air_date ?? '';
      const year = dateStr ? parseInt(dateStr.substring(0, 4), 10) : undefined;

      // Use the poster path basename (e.g. "aBcDeFg123" from "/aBcDeFg123.jpg")
      // as the cache key so each distinct TMDB image gets its own local file.
      const cacheKey = posterPath.replace(/^\//, '').replace(/\.[^.]+$/, '');
      let localPosterUri: string | undefined;
      try {
        localPosterUri = await downloadPoster(cacheKey, posterPath);
      } catch (e) {
        logger.warn('EditItem', 'Poster download failed', e);
      }

      if (localPosterUri) {
        applyPoster(localPosterUri);
      }

      dispatch(setMediaOverride({ key: itemKey, override: { tmdbId, year } }));
      setMatchApplied(result.id);
      setSelectedPoster({ resultId: result.id, posterPath });
      logger.log('EditItem', `Poster applied: TMDB ID ${tmdbId}, path=${posterPath}, year=${year}`);
    } catch (e) {
      logger.error('EditItem', 'Failed to apply poster', e);
      setSearchError('Failed to apply poster.');
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
      if (result.canceled) return;
      logger.log('EditItem', `Local image picked: ${result.assets[0].uri}`);
      const localUri = await copyPickedPoster(result.assets[0].uri, itemKey);
      applyPoster(localUri);
      logger.log('EditItem', `Custom poster saved: ${localUri}`);
    } catch (e) {
      logger.error('EditItem', 'Browse locally failed', e);
    } finally {
      setBrowsingLocally(false);
    }
  };

  const handleGoogleImageSearch = () => {
    const searchTerm = titleInput.trim() || currentTitle || '';
    const query = encodeURIComponent(`${searchTerm} poster`);
    const url = `https://www.google.com/search?q=${query}&tbm=isch`;
    logger.log('EditItem', `Opening Google Image Search: ${url}`);
    Linking.openURL(url).catch((e) => logger.warn('EditItem', 'Failed to open browser', e));
  };

  const itemTypeLabel =
    itemType === 'show' ? 'TV Show' : itemType === 'movie' ? 'Movie' : 'Episode';

  return (
    <ThemedView style={styles.screen}>
      <ScrollView style={styles.container} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Stack.Screen options={{ headerRight: () => <Button title="Save" onPress={handleSave} /> }} />
        <View style={styles.header}>
          <ThemedText type="subtitle">Edit {itemTypeLabel}</ThemedText>
          <ThemedText style={styles.subtitle} numberOfLines={2}>{currentTitle}</ThemedText>
        </View>

        {/* Title override */}
        <View style={styles.section}>
          <ThemedText type="defaultSemiBold" style={styles.sectionTitle}>Title</ThemedText>
          <View style={styles.field}>
            <ThemedText style={styles.label}>Display Title</ThemedText>
            <ThemedTextInput
              value={titleInput}
              onChangeText={setTitleInput}
              placeholder="Override display title"
            />
          </View>
          <View style={styles.field}>
            <ThemedText style={styles.label}>Sort Title</ThemedText>
            <ThemedTextInput
              value={sortTitleInput}
              onChangeText={setSortTitleInput}
              placeholder="Override sort order (e.g. 'Dark Knight, The')"
            />
            <ThemedText style={styles.hint}>
              Used to order the item in the grid. Leave empty to sort by display title.
            </ThemedText>
          </View>
        </View>

        {/* Poster override (shows and movies only) */}
        {(itemType === 'show' || itemType === 'movie') && (
          <View style={styles.section}>
            <ThemedText type="defaultSemiBold" style={styles.sectionTitle}>Poster Override</ThemedText>

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

            <View style={styles.posterButtonRow}>
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
            </View>
            <ThemedText style={styles.hint}>
              Google Images opens your browser to search for a poster. Browse Locally lets you pick any image file from your device and copies it for offline use.
            </ThemedText>
          </View>
        )}

        {/* TMDB Rematch (shows and movies only) */}
        {canRematch && (
          <View style={styles.section}>
            <ThemedText type="defaultSemiBold" style={styles.sectionTitle}>
              Search TMDB for Poster
            </ThemedText>

            <View style={styles.searchRow}>
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
            </View>

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
                  const isMatched = matchApplied === item.id;
                  const isExpanded = expandedResultId === item.id;
                  const isLoadingPosters = loadingPostersForId === item.id;
                  const posters: string[] = postersByResultId[item.id] ?? [];
                  const posterCount = isExpanded && !isLoadingPosters ? posters.length : null;
                  return (
                    <View style={[styles.resultRow, isMatched && styles.resultRowSelected]}>
                      {/* Header row: thumbnail + title/year + expand button */}
                      <TouchableOpacity
                        style={styles.resultHeader}
                        onPress={() => fetchAndExpandResult(item)}
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
                          {isMatched && (
                            <ThemedText style={styles.selectedLabel}>✔ Matched</ThemedText>
                          )}
                          <ThemedText style={styles.posterCountLabel}>
                            {isLoadingPosters
                              ? 'Loading posters…'
                              : posterCount !== null
                                ? posterCount === 0
                                  ? 'No posters available'
                                  : `${posterCount} poster${posterCount !== 1 ? 's' : ''} available`
                                : isExpanded
                                  ? '…'
                                  : 'Tap to browse posters'}
                          </ThemedText>
                        </View>
                        <ThemedText style={styles.expandChevron}>
                          {isExpanded ? '▲' : '▼'}
                        </ThemedText>
                      </TouchableOpacity>

                      {/* Expanded poster gallery */}
                      {isExpanded && (
                        <View style={styles.posterGallery}>
                          {isLoadingPosters ? (
                            <ActivityIndicator style={styles.spinner} />
                          ) : posters.length > 0 ? (
                            <FlatList
                              data={posters}
                              keyExtractor={(path) => path}
                              horizontal
                              showsHorizontalScrollIndicator={false}
                              contentContainerStyle={styles.posterGalleryContent}
                              renderItem={({ item: posterPath }) => {
                                const isChosen =
                                    isMatched &&
                                    selectedPoster?.resultId === item.id &&
                                    selectedPoster?.posterPath === posterPath;
                                return (
                                  <TouchableOpacity
                                    onPress={() => handleSelectPoster(item, posterPath)}
                                    disabled={applyingMatch}
                                    style={[styles.galleryPosterWrapper, isChosen && styles.galleryPosterWrapperChosen]}
                                  >
                                    <Image
                                      source={{ uri: POSTER_THUMB_URL + posterPath }}
                                      style={styles.galleryPoster}
                                      contentFit="cover"
                                    />
                                    {isChosen && (
                                      <View style={styles.galleryCheckOverlay}>
                                        <ThemedText style={styles.galleryCheckIcon}>✔</ThemedText>
                                      </View>
                                    )}
                                  </TouchableOpacity>
                                );
                              }}
                            />
                          ) : (
                            <ThemedText style={styles.hint}>No posters available.</ThemedText>
                          )}
                        </View>
                      )}
                    </View>
                  );
                }}
              />
            )}
          </View>
        )}

        {!tmdbApiKey && (itemType === 'show' || itemType === 'movie') && (
          <View style={styles.section}>
            <ThemedText style={styles.hint}>
              Add a TMDB API key in Settings to enable TMDB poster search.
            </ThemedText>
          </View>
        )}
      </ScrollView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  container: {
    flex: 1,
  },
  content: {
    padding: 16,
    gap: 20,
  },
  header: {
    gap: 4,
    paddingBottom: 4,
  },
  subtitle: {
    opacity: 0.6,
    fontSize: 13,
  },
  section: {
    gap: 10,
    paddingTop: 16,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: DIVIDER_COLOR,
  },
  sectionTitle: {
    fontSize: 15,
    marginBottom: 2,
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
    flexDirection: 'column',
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: DIVIDER_COLOR,
  },
  resultRowSelected: {
    backgroundColor: 'rgba(10,126,164,0.12)',
    borderRadius: 6,
  },
  resultHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
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
  posterCountLabel: {
    opacity: 0.7,
    fontSize: 12,
    marginTop: 2,
  },
  expandChevron: {
    fontSize: 12,
    opacity: 0.6,
    paddingHorizontal: 4,
  },
  posterGallery: {
    marginTop: 10,
  },
  posterGalleryContent: {
    gap: 8,
    paddingBottom: 4,
  },
  galleryPosterWrapper: {
    borderRadius: 6,
    overflow: 'hidden',
    borderWidth: 2,
    borderColor: 'transparent',
  },
  galleryPosterWrapperChosen: {
    borderColor: '#0a7ea4',
  },
  galleryPoster: {
    width: 80,
    height: 120,
    borderRadius: 4,
    backgroundColor: '#333',
  },
  galleryCheckOverlay: {
    position: 'absolute',
    top: 4,
    right: 4,
    backgroundColor: '#0a7ea4',
    borderRadius: 10,
    width: 20,
    height: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  galleryCheckIcon: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '700',
  },
});
