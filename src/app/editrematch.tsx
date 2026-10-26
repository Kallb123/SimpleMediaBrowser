import { useLocalSearchParams, router } from 'expo-router';
import { useHeaderHeight } from '@react-navigation/elements';
import { ActivityIndicator, ScrollView, StyleSheet, View } from 'react-native';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import { useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { ThemedText } from '@/components/ThemedText';
import { ThemedView } from '@/components/ThemedView';
import { ProviderIdBadges } from '@/components/edit/ProviderIdBadges';
import { ProviderToggle } from '@/components/edit/ProviderToggle';
import { ResultRow } from '@/components/edit/ResultRow';
import { SearchBar } from '@/components/edit/SearchBar';
import { useEditTarget, type EditItemType } from '@/hooks/useEditTarget';
import { useKeyboardAwareScroll } from '@/hooks/useKeyboardAwareScroll';
import { useProviderSearch } from '@/hooks/useProviderSearch';
import { selectMovies, setMediaOverride, updateMovieMetadata, updateShowMetadata } from '@/store/libraryReducer';
import { logger } from '@/scripts/Logger';
import { MetadataService } from '@/scripts/MetadataService';
import { downloadProviderPoster } from '@/scripts/posterSources';
import type { ProviderSearchResult, TmdbSearchType } from '@/scripts/posterSources';

export default function EditRematchScreen() {
  const { itemType, itemKey, currentTitle } = useLocalSearchParams<{
    itemType: EditItemType;
    itemKey: string;
    currentTitle: string;
  }>();

  const dispatch = useDispatch();
  const navigation = useNavigation();
  const movies = useSelector(selectMovies);
  const insets = useSafeAreaInsets();
  // See edititem.tsx: the native header is outside this component's layout tree,
  // so KeyboardAvoidingView needs the real header height from React Navigation.
  const headerHeight = useHeaderHeight();
  const { scrollViewProps, extraBottomSpace, handleInputFocus, handleInputBlur } = useKeyboardAwareScroll();

  const { override, currentTmdbId, currentTvdbId, resolvedProvider, hasProviderSupport, credentials, applyPoster } =
    useEditTarget(itemType, itemKey ?? '');
  const { provider, setProvider, query, setQuery, results, searching, error, setError, search } =
    useProviderSearch(resolvedProvider, override.title ?? currentTitle ?? '', credentials);

  const [applying, setApplying] = useState(false);
  // True while episode metadata is being re-fetched after a rematch.
  const [isRematching, setIsRematching] = useState(false);
  const busy = applying || isRematching;

  const searchType: TmdbSearchType = itemType === 'movie' ? 'movie' : 'tv';
  const bothKeys = !!credentials.tmdbApiKey && !!credentials.tvdbApiKey;
  const typeLabel = itemType === 'movie' ? 'movie' : 'show';

  /**
   * Apply a match — updates the metadata ID, downloads the poster, and
   * re-enriches episodes (for shows), then returns to the details screen.
   */
  const handleApply = async (result: ProviderSearchResult) => {
    setApplying(true);
    setError('');
    // These are live from the store, so capture them before dispatching.
    const previousId = result.provider === 'tvdb' ? currentTvdbId : currentTmdbId;
    try {
      const { id, year } = result;
      const showName = itemType === 'show' ? itemKey.replace(/^show:/, '') : '';
      const movie = itemType === 'movie'
        ? movies.find((m) => m.parsedPath === itemKey.replace(/^movie:/, ''))
        : undefined;

      if (result.provider === 'tvdb') {
        if (itemType === 'show') {
          dispatch(updateShowMetadata({ showName, providerId: id, source: 'tvdb' }));
        } else if (movie) {
          dispatch(updateMovieMetadata({ path: movie.path, providerId: id, source: 'tvdb' }));
        }
        dispatch(setMediaOverride({
          key: itemKey,
          override: { tvdbId: id, year, metadataSourceOverride: 'tvdb' },
        }));
      } else {
        dispatch(setMediaOverride({ key: itemKey, override: { tmdbId: id, year } }));
        if (itemType === 'show') {
          dispatch(updateShowMetadata({ showName, providerId: id }));
        } else if (movie) {
          dispatch(updateMovieMetadata({ path: movie.path, providerId: id }));
        }
      }

      // Download and apply the poster from the matched result.
      if (result.posterRef) {
        try {
          const localPosterUri = await downloadProviderPoster(result.provider, id, result.posterRef);
          applyPoster(localPosterUri);
        } catch (e) {
          logger.warn('EditItem', `Failed to download poster during ${result.provider.toUpperCase()} rematch`, e);
        }
      }

      logger.log('EditItem', `${result.provider.toUpperCase()} rematch applied: ID ${id}, year=${year}`);

      if (itemType === 'show' && id !== previousId) {
        logger.log('EditItem', `${result.provider.toUpperCase()} ID changed (${previousId} → ${id}), re-enriching episodes for "${showName}"`);
        setIsRematching(true);
        try {
          await MetadataService.getInstance().rematchSingleShow(showName, id, result.provider);
        } catch (e) {
          logger.error('EditItem', `Episode re-enrichment failed after ${result.provider.toUpperCase()} rematch`, e);
        } finally {
          setIsRematching(false);
        }
      }

      // The user may have backed out while this was awaiting; don't pop the details screen too.
      if (navigation.isFocused()) router.back();
    } catch (e) {
      logger.error('EditItem', `Failed to apply ${result.provider.toUpperCase()} rematch`, e);
      setError('Failed to apply rematch.');
    } finally {
      setApplying(false);
    }
  };

  if ((itemType !== 'show' && itemType !== 'movie') || !itemKey || !hasProviderSupport) {
    return (
      <ThemedView style={styles.screen}>
        <View style={styles.content}>
          <ThemedText style={styles.hint}>
            {itemType === 'show' || itemType === 'movie'
              ? 'Add a TMDB or TVDB API key in Settings to enable metadata re-matching.'
              : 'Metadata re-matching is only available for TV shows and movies.'}
          </ThemedText>
        </View>
      </ThemedView>
    );
  }

  return (
    <ThemedView style={styles.screen}>
      <KeyboardAvoidingView style={styles.screen} behavior="padding" keyboardVerticalOffset={headerHeight}>
        <ScrollView
          {...scrollViewProps}
          style={styles.screen}
          contentContainerStyle={[styles.content, { paddingBottom: 16 + insets.bottom + extraBottomSpace }]}
          keyboardShouldPersistTaps="handled"
        >
          <View style={styles.header}>
            <ThemedText type="subtitle">Re-match Metadata</ThemedText>
            <ThemedText style={styles.subtitle} numberOfLines={2}>{currentTitle}</ThemedText>
          </View>

          <ThemedText style={styles.hint}>
            Search for this {typeLabel} and tap a result to assign its metadata. The currently
            matched entry is highlighted.
            {itemType === 'show' ? ' For TV shows, re-matching also re-fetches episode names and thumbnails.' : ''}
            {' '}Re-matching also replaces the poster with the match&apos;s poster.
          </ThemedText>

          {bothKeys && <ProviderToggle value={provider} onChange={setProvider} disabled={busy} />}

          {/* Current provider IDs */}
          <ProviderIdBadges tmdbId={currentTmdbId} tvdbId={currentTvdbId} />

          <SearchBar
            value={query}
            onChangeText={setQuery}
            onSearch={() => search(searchType)}
            onFocus={handleInputFocus}
            onBlur={handleInputBlur}
            placeholder={provider === 'tvdb' ? 'Search TheTVDB…' : 'Search TMDB…'}
            disabled={searching || busy}
          />

          {searching && <ActivityIndicator style={styles.spinner} />}
          {error !== '' && <ThemedText style={styles.errorText}>{error}</ThemedText>}
          {applying && !isRematching && <ThemedText style={styles.hint}>Applying match…</ThemedText>}
          {isRematching && (
            <View style={styles.rematchingRow}>
              <ActivityIndicator size="small" />
              <ThemedText style={styles.hint}>Re-fetching episode data for new match…</ThemedText>
            </View>
          )}

          {results.map((result) => {
            const isCurrent = result.id === (result.provider === 'tvdb' ? currentTvdbId : currentTmdbId);
            return (
              <ResultRow
                key={`${result.provider}:${result.id}`}
                thumbUrl={result.thumbUrl}
                placeholderIcon={result.provider === 'tvdb' ? '📺' : '🎬'}
                title={result.title}
                subtitles={[result.year]}
                status={isCurrent ? '✔ Current Match' : 'Tap to match'}
                statusHighlighted={isCurrent}
                highlighted={isCurrent}
                disabled={busy}
                onPress={() => handleApply(result)}
              />
            );
          })}
        </ScrollView>
      </KeyboardAvoidingView>
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
  header: {
    gap: 4,
    paddingBottom: 4,
  },
  subtitle: {
    opacity: 0.6,
    fontSize: 13,
  },
  hint: {
    opacity: 0.6,
    fontSize: 12,
    fontStyle: 'italic',
  },
  spinner: {
    marginVertical: 8,
  },
  rematchingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginVertical: 4,
  },
  errorText: {
    color: '#E55',
    fontSize: 13,
  },
});
