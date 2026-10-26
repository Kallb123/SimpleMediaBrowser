import { useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Linking,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  View,
} from 'react-native';
import { Image } from 'expo-image';
import * as DocumentPicker from 'expo-document-picker';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useDispatch } from 'react-redux';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ThemedText } from '@/components/ThemedText';
import { ThemedView } from '@/components/ThemedView';
import { ProviderToggle } from '@/components/edit/ProviderToggle';
import { ResultRow } from '@/components/edit/ResultRow';
import { SearchBar } from '@/components/edit/SearchBar';
import { useEditTarget } from '@/hooks/useEditTarget';
import type { EditItemType } from '@/hooks/useEditTarget';
import { useProviderSearch } from '@/hooks/useProviderSearch';
import { logger } from '@/scripts/Logger';
import { AudiobookProvider } from '@/scripts/providers/AudiobookProvider';
import type { AudiobookResult } from '@/scripts/providers/AudiobookProvider';
import {
  copyPickedPoster,
  downloadProviderPoster,
  fetchPosterGallery,
  hasProviderKey,
} from '@/scripts/posterSources';
import type { GalleryPoster, ProviderSearchResult, TmdbSearchType } from '@/scripts/posterSources';
import { setMediaOverride, updateAudiobookMetadata } from '@/store/libraryReducer';
import type { dataSources } from '@/store/libraryReducer';

const DIVIDER_COLOR = 'rgba(128,128,128,0.35)';

/** Key for per-result gallery state: ids are only unique within a provider. */
const galleryKey = (result: ProviderSearchResult) => `${result.provider}:${result.id}`;

/** Status line for a provider result row, matching the wording of the old modal. */
function galleryStatus(expanded: boolean, loading: boolean, posters: GalleryPoster[] | undefined): string {
  if (loading) return 'Loading posters…';
  if (!expanded) return 'Tap to browse posters';
  if (posters === undefined) return '…';
  return posters.length === 0
    ? 'No posters available'
    : `${posters.length} poster${posters.length !== 1 ? 's' : ''} available`;
}

export default function EditPosterScreen() {
  const { itemType, itemKey, currentTitle, query, year } = useLocalSearchParams<{
    itemType: EditItemType;
    itemKey: string;
    currentTitle: string;
    /** Draft title from the details screen. */
    query?: string;
    /** Draft year from the details screen (audiobooks). */
    year?: string;
  }>();

  const dispatch = useDispatch();
  const insets = useSafeAreaInsets();
  const {
    override,
    currentPoster,
    resolvedProvider,
    hasProviderSupport,
    credentials,
    applyPoster,
  } = useEditTarget(itemType, itemKey);

  const isAudiobook = itemType === 'audiobook';
  const noun = isAudiobook ? 'cover' : 'poster';
  const initialQuery = query || override.title || currentTitle || '';
  const audiobookFolderKey = isAudiobook ? itemKey.replace(/^audiobook:/, '') : '';
  const { tmdbApiKey, tvdbApiKey } = credentials;

  // Fall back to whichever provider has a key if the item's own provider has none.
  const initialProvider: dataSources = hasProviderKey(resolvedProvider, credentials)
    ? resolvedProvider
    : resolvedProvider === 'tvdb' ? 'tmdb' : 'tvdb';

  const [browsingLocally, setBrowsingLocally] = useState(false);
  const [localError, setLocalError] = useState('');

  // --- Audiobook cover search (iTunes, no key required) ---
  const [audiobookQuery, setAudiobookQuery] = useState(initialQuery);
  const [audiobookSearching, setAudiobookSearching] = useState(false);
  const [audiobookError, setAudiobookError] = useState('');
  const [audiobookResults, setAudiobookResults] = useState<AudiobookResult[]>([]);
  const [audiobookApplying, setAudiobookApplying] = useState(false);

  // --- Show/movie provider poster search ---
  const providerSearch = useProviderSearch(initialProvider, initialQuery, credentials);
  const { provider, setProvider, results, searching, error: searchError, setError: setSearchError } = providerSearch;
  // Content type lets users browse posters across types (e.g. a TV-show poster for a movie entry).
  const [tmdbType, setTmdbType] = useState<TmdbSearchType>(itemType === 'movie' ? 'movie' : 'tv');
  // The type the current results were searched with; galleries must use it, not the toggle.
  const [searchedType, setSearchedType] = useState<TmdbSearchType>(tmdbType);
  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  const [loadingKey, setLoadingKey] = useState<string | null>(null);
  const [galleries, setGalleries] = useState<Record<string, GalleryPoster[]>>({});
  const [posterApplying, setPosterApplying] = useState(false);

  const busy = posterApplying || audiobookApplying || browsingLocally;

  const clearGalleryState = () => {
    setExpandedKey(null);
    setLoadingKey(null);
    setGalleries({});
  };

  // ─── Poster override (Google Images / Browse Locally) ────────────────────────

  const handleGoogleImageSearch = () => {
    const searchTerm = query || currentTitle || '';
    const url = `https://www.google.com/search?q=${encodeURIComponent(`${searchTerm} poster`)}&tbm=isch`;
    logger.log('EditItem', `Opening Google Image Search: ${url}`);
    Linking.openURL(url).catch((e) => logger.warn('EditItem', 'Failed to open browser', e));
  };

  const handleBrowseLocally = async () => {
    setBrowsingLocally(true);
    setLocalError('');
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
      router.back();
    } catch (e) {
      logger.error('EditItem', 'Browse locally failed', e);
      setLocalError(`Failed to apply ${noun}.`);
    } finally {
      setBrowsingLocally(false);
    }
  };

  // ─── Audiobook cover search ──────────────────────────────────────────────────

  const handleAudiobookSearch = async () => {
    const trimmed = audiobookQuery.trim();
    if (!trimmed) return;
    setAudiobookSearching(true);
    setAudiobookError('');
    setAudiobookResults([]);
    try {
      let found = await new AudiobookProvider().searchAudiobook(trimmed);
      // When a year is set, prioritise editions matching it. Different narrator
      // releases usually differ by year, so this surfaces the right cover first.
      const targetYear = parseInt((year ?? '').trim(), 10);
      if (Number.isFinite(targetYear) && targetYear > 0) {
        found = [...found].sort((a, b) => {
          const da = a.year > 0 ? Math.abs(a.year - targetYear) : 9999;
          const db = b.year > 0 ? Math.abs(b.year - targetYear) : 9999;
          return da - db;
        });
      }
      logger.log('EditItem', `Audiobook cover search: query="${trimmed}" results=${found.length}`);
      setAudiobookResults(found);
      if (found.length === 0) setAudiobookError('No results found.');
    } catch (e) {
      logger.error('EditItem', 'Audiobook cover search failed', e);
      setAudiobookError('Search failed. Check your connection.');
    } finally {
      setAudiobookSearching(false);
    }
  };

  const handleApplyAudiobookCover = async (result: AudiobookResult) => {
    if (!result.coverUrl) return;
    setAudiobookApplying(true);
    setAudiobookError('');
    try {
      const localUri = await new AudiobookProvider().downloadCover(result.id, result.coverUrl);
      applyPoster(localUri);
      dispatch(updateAudiobookMetadata({
        folderKey: audiobookFolderKey,
        itunesId: result.id,
        author: result.author,
      }));
      // Adopt the edition's year if none is stored, as a proxy for this narrator/release.
      if (result.year > 0 && !override.year) {
        dispatch(setMediaOverride({ key: itemKey, override: { year: result.year } }));
      }
      logger.log('EditItem', `Audiobook cover applied from iTunes ID ${result.id}`);
      router.back();
    } catch (e) {
      logger.error('EditItem', 'Failed to apply audiobook cover', e);
      setAudiobookError('Failed to apply cover.');
    } finally {
      setAudiobookApplying(false);
    }
  };

  // ─── Provider poster search (shows and movies) ───────────────────────────────

  const handleProviderChange = (next: dataSources) => {
    setProvider(next);
    clearGalleryState();
  };

  const handleTypeChange = (next: TmdbSearchType) => {
    setTmdbType(next);
    clearGalleryState();
  };

  const handleProviderSearch = async () => {
    clearGalleryState();
    setSearchedType(tmdbType);
    await providerSearch.search(tmdbType);
  };

  /** Expand/collapse a result's gallery; the first expansion fetches its posters. */
  const handleToggleGallery = async (result: ProviderSearchResult) => {
    const key = galleryKey(result);
    if (expandedKey === key) {
      setExpandedKey(null);
      return;
    }
    setExpandedKey(key);
    if (galleries[key] !== undefined) return;

    setLoadingKey(key);
    try {
      const posters = await fetchPosterGallery(result, searchedType, credentials);
      setGalleries((prev) => ({ ...prev, [key]: posters }));
    } catch (e) {
      logger.warn('EditItem', 'Failed to fetch poster gallery', e);
      setExpandedKey((current) => (current === key ? null : current));
    } finally {
      setLoadingKey((current) => (current === key ? null : current));
    }
  };

  /** Download a provider poster and apply it — poster image only, no metadata change. */
  const handleApplyProviderPoster = async (result: ProviderSearchResult, poster: GalleryPoster) => {
    setPosterApplying(true);
    setSearchError('');
    try {
      const localUri = await downloadProviderPoster(result.provider, result.id, poster.ref);
      applyPoster(localUri);
      logger.log('EditItem', `Poster-only applied from ${result.provider.toUpperCase()} ID ${result.id}, ref=${poster.ref}`);
      router.back();
    } catch (e) {
      logger.error('EditItem', `Failed to apply ${result.provider.toUpperCase()} poster`, e);
      setSearchError('Failed to apply poster.');
    } finally {
      setPosterApplying(false);
    }
  };

  const renderGallery = (result: ProviderSearchResult) => {
    const key = galleryKey(result);
    const posters = galleries[key] ?? [];
    return (
      <View style={styles.posterGallery}>
        {loadingKey === key ? (
          <ActivityIndicator style={styles.spinner} />
        ) : posters.length > 0 ? (
          <FlatList
            data={posters}
            keyExtractor={(poster) => poster.ref}
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.posterGalleryContent}
            renderItem={({ item: poster }) => (
              <TouchableOpacity
                onPress={() => handleApplyProviderPoster(result, poster)}
                disabled={busy}
                style={styles.galleryPosterWrapper}
              >
                <Image source={{ uri: poster.thumbUrl }} style={styles.galleryPoster} contentFit="cover" />
              </TouchableOpacity>
            )}
          />
        ) : (
          <ThemedText style={styles.hint}>No posters available.</ThemedText>
        )}
      </View>
    );
  };

  return (
    <ThemedView style={styles.screen}>
      <Stack.Screen options={{ title: isAudiobook ? 'Choose Cover' : 'Choose Poster' }} />
      <ScrollView
        style={styles.screen}
        contentContainerStyle={[styles.content, { paddingBottom: 16 + insets.bottom }]}
        keyboardShouldPersistTaps="handled"
      >
        {/* Current poster preview */}
        <View style={styles.currentRow}>
          {currentPoster ? (
            <Image source={{ uri: currentPoster }} style={styles.currentPoster} contentFit="cover" />
          ) : (
            <View style={[styles.currentPoster, styles.currentPosterPlaceholder]}>
              <ThemedText style={styles.placeholderIcon}>{isAudiobook ? '🎧' : '🎬'}</ThemedText>
            </View>
          )}
          <View style={styles.currentInfo}>
            <ThemedText type="defaultSemiBold" numberOfLines={2}>{currentTitle}</ThemedText>
            <ThemedText style={styles.hintPlain}>
              {currentPoster ? `Current ${noun}` : `No ${noun} set`}
            </ThemedText>
          </View>
        </View>

        {/* Poster/cover override */}
        <View style={styles.section}>
          <ThemedText type="defaultSemiBold" style={styles.sectionTitle}>
            {isAudiobook ? 'Cover Override' : 'Poster Override'}
          </ThemedText>
          <View style={styles.buttonRow}>
            <TouchableOpacity style={styles.actionButton} onPress={handleGoogleImageSearch}>
              <ThemedText style={styles.actionButtonText}>🔍 Google Images</ThemedText>
            </TouchableOpacity>
            <TouchableOpacity style={styles.actionButton} onPress={handleBrowseLocally} disabled={busy}>
              <ThemedText style={styles.actionButtonText}>
                {browsingLocally ? 'Picking…' : '📁 Browse Locally'}
              </ThemedText>
            </TouchableOpacity>
          </View>
          <ThemedText style={styles.hint}>
            Google Images opens your browser to search for a {noun}. Browse Locally lets you pick any image file from your device and copies it for offline use.
          </ThemedText>
          {localError !== '' && <ThemedText style={styles.errorText}>{localError}</ThemedText>}
        </View>

        {/* Cover Search (audiobooks) — iTunes Search API, no key required */}
        {isAudiobook && (
          <View style={styles.section}>
            <ThemedText type="defaultSemiBold" style={styles.sectionTitle}>Cover Search</ThemedText>
            <ThemedText style={styles.hint}>
              Search Apple Books / iTunes for cover art. Each result is a separate
              edition — different narrator releases appear as different results with
              their own covers. Set the Year on the details screen to bring the closest
              edition to the top. Tap a result to apply its cover.
            </ThemedText>

            <SearchBar
              value={audiobookQuery}
              onChangeText={setAudiobookQuery}
              onSearch={handleAudiobookSearch}
              placeholder="Search audiobooks…"
              disabled={audiobookSearching || busy}
            />

            {audiobookSearching && <ActivityIndicator style={styles.spinner} />}
            {audiobookError !== '' && <ThemedText style={styles.errorText}>{audiobookError}</ThemedText>}
            {audiobookApplying && <ThemedText style={styles.hint}>Applying cover…</ThemedText>}

            {audiobookResults.map((item) => (
              <ResultRow
                key={item.id}
                thumbUrl={item.coverThumbUrl}
                placeholderIcon="🎧"
                title={item.title}
                subtitles={[item.author, item.year > 0 ? item.year : null]}
                status="Tap to apply cover"
                disabled={busy || !item.coverUrl}
                onPress={() => handleApplyAudiobookCover(item)}
              />
            ))}
          </View>
        )}

        {/* Poster Search (shows and movies only, requires API key) */}
        {hasProviderSupport && (
          <View style={styles.section}>
            <ThemedText type="defaultSemiBold" style={styles.sectionTitle}>Poster Search</ThemedText>
            <ThemedText style={styles.hint}>
              Search TMDB or TheTVDB and browse poster images. Selecting a poster
              only updates the image — it does not change the metadata match or
              episode data. Use the TMDB content-type toggle to search TV shows
              even for a movie entry (or vice versa).
            </ThemedText>

            {!!(tmdbApiKey && tvdbApiKey) && (
              <ProviderToggle value={provider} onChange={handleProviderChange} disabled={busy} />
            )}

            {provider === 'tmdb' && !!tmdbApiKey && (
              <View style={styles.typeRow}>
                <TouchableOpacity
                  style={[styles.typeButton, tmdbType === 'tv' && styles.typeButtonActive]}
                  onPress={() => handleTypeChange('tv')}
                  disabled={busy}
                >
                  <ThemedText style={[styles.typeButtonText, tmdbType === 'tv' && styles.typeButtonTextActive]}>TV Shows</ThemedText>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.typeButton, tmdbType === 'movie' && styles.typeButtonActive]}
                  onPress={() => handleTypeChange('movie')}
                  disabled={busy}
                >
                  <ThemedText style={[styles.typeButtonText, tmdbType === 'movie' && styles.typeButtonTextActive]}>Movies</ThemedText>
                </TouchableOpacity>
              </View>
            )}

            <SearchBar
              value={providerSearch.query}
              onChangeText={providerSearch.setQuery}
              onSearch={handleProviderSearch}
              placeholder={provider === 'tvdb' ? 'Search TheTVDB…' : 'Search TMDB…'}
              disabled={searching || busy}
            />

            {searching && <ActivityIndicator style={styles.spinner} />}
            {searchError !== '' && <ThemedText style={styles.errorText}>{searchError}</ThemedText>}
            {posterApplying && <ThemedText style={styles.hint}>Applying poster…</ThemedText>}

            {results.map((result) => {
              const key = galleryKey(result);
              const expanded = expandedKey === key;
              return (
                <ResultRow
                  key={key}
                  thumbUrl={result.thumbUrl}
                  placeholderIcon={result.provider === 'tvdb' ? '📺' : '🎬'}
                  title={result.title}
                  subtitles={[result.year]}
                  status={galleryStatus(expanded, loadingKey === key, galleries[key])}
                  expanded={expanded}
                  disabled={busy}
                  onPress={() => handleToggleGallery(result)}
                >
                  {expanded && renderGallery(result)}
                </ResultRow>
              );
            })}
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
  content: {
    padding: 16,
    gap: 20,
  },
  currentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  currentPoster: {
    width: 50,
    height: 75,
    borderRadius: 4,
    backgroundColor: '#333',
  },
  currentPosterPlaceholder: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  placeholderIcon: {
    fontSize: 24,
  },
  currentInfo: {
    flex: 1,
    gap: 2,
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
  hint: {
    opacity: 0.6,
    fontSize: 12,
    fontStyle: 'italic',
  },
  hintPlain: {
    opacity: 0.6,
    fontSize: 12,
  },
  buttonRow: {
    flexDirection: 'row',
    gap: 8,
    flexWrap: 'wrap',
  },
  actionButton: {
    flex: 1,
    backgroundColor: '#0a7ea4',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    alignItems: 'center',
  },
  actionButtonText: {
    color: '#fff',
    fontWeight: '600',
    fontSize: 13,
  },
  spinner: {
    marginVertical: 8,
  },
  errorText: {
    color: '#E55',
    fontSize: 13,
  },
  typeRow: {
    flexDirection: 'row',
    gap: 8,
  },
  typeButton: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(128,128,128,0.5)',
  },
  typeButtonActive: {
    backgroundColor: 'rgba(128,128,128,0.25)',
    borderColor: 'rgba(128,128,128,0.8)',
  },
  typeButtonText: {
    fontSize: 13,
    fontWeight: '600',
    opacity: 0.7,
  },
  typeButtonTextActive: {
    opacity: 1,
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
  },
  galleryPoster: {
    width: 80,
    height: 120,
    borderRadius: 4,
    backgroundColor: '#333',
  },
});
