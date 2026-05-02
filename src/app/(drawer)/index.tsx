import { BackHandler, Dimensions, Linking, StyleSheet, TouchableOpacity, View } from 'react-native';
import { ThemedText } from '@/components/ThemedText';
import { ThemedView } from '@/components/ThemedView';
import { Image } from 'expo-image';
import { Link, router } from 'expo-router';
import { useEffect, useMemo, useCallback, useState } from 'react';
import { useSelector } from 'react-redux';
import { selectMediaSources, selectMediaStructure, selectPassword, selectViewScale, selectViewOrientation } from '@/store/settingsReducer';
import { selectMediaLibrary, selectMovies, selectIsScanning, selectThumbnails, selectMediaOverrides } from '@/store/libraryReducer';
import { FlashList } from '@shopify/flash-list';
import { FileScanner, IMediaObject } from '@/scripts/FileScanner';
import type { IMediaLibrary } from '@/store/libraryReducer';
import type { IMediaOverride } from '@/store/libraryReducer';
import type { viewTypes } from '@/store/settingsReducer';
import { logger } from '@/scripts/Logger';
import { useEditMode } from '@/contexts/EditModeContext';

// ── Navigation types ─────────────────────────────────────────────────────────

type NavLevel = {
  label: string;
  showName?: string;
  seasonKey?: string;
};

type DisplayItem =
  | { kind: 'folder'; label: string; key: string; thumbnailUri?: string; onPress: () => void; mediaType: 'show' | 'season' }
  | { kind: 'file'; label: string; key: string; thumbnailUri?: string; posterUri?: string; mediaObject: IMediaObject; mediaType: 'movie' | 'episode' };

// ── Helper: pick a representative thumbnail URI for a show folder ─────────────

function pickShowThumbnail(
  library: IMediaLibrary,
  showName: string,
  thumbnails: { [path: string]: string },
): string | undefined {
  const show = library[showName];
  if (!show) return undefined;
  for (const season of Object.values(show.seasons)) {
    for (const ep of Object.values(season.episodes)) {
      if (thumbnails[ep.path]) return thumbnails[ep.path];
    }
  }
  return undefined;
}

// ── Helper: build items to display from library + nav state ──────────────────

/** Returns the effective display label for a show, applying overrides if present. */
function showDisplayLabel(showName: string, overrides: { [key: string]: IMediaOverride }): string {
  return overrides[`show:${showName}`]?.title ?? showName;
}

/** Returns the effective sort key for a show (sortTitle > title > showName). */
function showSortKey(showName: string, overrides: { [key: string]: IMediaOverride }): string {
  const o = overrides[`show:${showName}`];
  return o?.sortTitle ?? o?.title ?? showName;
}

/** Returns the effective sort key for a movie (sortTitle > title override > title > filename). */
function movieSortKey(movie: IMediaObject, overrides: { [key: string]: IMediaOverride }): string {
  const o = overrides[`movie:${movie.path}`];
  return o?.sortTitle ?? o?.title ?? movie.title ?? movie.filename;
}

/**
 * Compare two episodes for sorting purposes.
 * Respects sortTitle overrides; otherwise sorts by episode number, then title.
 */
function compareEpisodes(
  a: IMediaObject,
  b: IMediaObject,
  overrides: { [key: string]: IMediaOverride },
): number {
  const aO = overrides[`episode:${a.path}`];
  const bO = overrides[`episode:${b.path}`];
  const aSortTitle = aO?.sortTitle;
  const bSortTitle = bO?.sortTitle;
  if (aSortTitle || bSortTitle) {
    const aKey = aSortTitle ?? aO?.title ?? a.title ?? a.filename;
    const bKey = bSortTitle ?? bO?.title ?? b.title ?? b.filename;
    return aKey.localeCompare(bKey, undefined, NATURAL_SORT_OPTS);
  }
  if (a.episodeNumber !== b.episodeNumber) return a.episodeNumber - b.episodeNumber;
  return (a.title ?? a.filename).localeCompare(b.title ?? b.filename, undefined, NATURAL_SORT_OPTS);
}

/** Locale-compare options that produce natural (numeric-aware) sort order. */
const NATURAL_SORT_OPTS: Intl.CollatorOptions = { numeric: true, sensitivity: 'base' };

/** Returns the effective display label for an episode, applying overrides to the title portion. */
function episodeDisplayLabel(ep: IMediaObject, overrides: { [key: string]: IMediaOverride }, prefix: string): string {
  const override = overrides[`episode:${ep.path}`];
  const title = override?.title ?? ep.title;
  if (prefix) {
    return title ? `${prefix} - ${title}` : prefix;
  }
  return title || ep.filename;
}

/** Returns the effective display label for a movie, applying overrides if present. */
function movieDisplayLabel(movie: IMediaObject, overrides: { [key: string]: IMediaOverride }): string {
  return overrides[`movie:${movie.path}`]?.title ?? movie.title ?? movie.filename;
}

function buildDisplayItems(
  library: IMediaLibrary,
  movies: IMediaObject[],
  viewType: viewTypes,
  navStack: NavLevel[],
  thumbnails: { [path: string]: string },
  overrides: { [key: string]: IMediaOverride },
  navigateInto: (entry: NavLevel) => void,
): DisplayItem[] {
  switch (viewType) {
    case 'flat': {
      // All episodes from every show/season in one flat list, plus movies
      const items: DisplayItem[] = [];
      for (const [showName, show] of Object.entries(library)) {
        const sortedSeasons = Object.values(show.seasons).sort((a, b) => a.seasonNumber - b.seasonNumber);
        for (const season of sortedSeasons) {
          const sortedEps = Object.values(season.episodes).sort((a, b) => compareEpisodes(a, b, overrides));
          for (const ep of sortedEps) {
            const sNum = `S${String(season.seasonNumber).padStart(2, '0')}`;
            const eNum = ep.episodeNumber > 0 ? `E${String(ep.episodeNumber).padStart(2, '0')}` : '';
            const prefix = ep.episodeNumber > 0 ? `${showDisplayLabel(showName, overrides)} ${sNum}${eNum}` : '';
            items.push({
              kind: 'file',
              label: episodeDisplayLabel(ep, overrides, prefix),
              key: ep.path,
              thumbnailUri: thumbnails[ep.path],
              mediaObject: ep,
              mediaType: 'episode',
            });
          }
        }
      }
      const sortedMovies = [...movies].sort((a, b) =>
        movieSortKey(a, overrides).localeCompare(movieSortKey(b, overrides), undefined, NATURAL_SORT_OPTS),
      );
      for (const movie of sortedMovies) {
        items.push({
          kind: 'file',
          label: movieDisplayLabel(movie, overrides),
          key: movie.path,
          thumbnailUri: thumbnails[movie.path],
          posterUri: overrides[`movie:${movie.path}`]?.poster || movie.poster || undefined,
          mediaObject: movie,
          mediaType: 'movie',
        });
      }
      items.sort((a, b) => a.label.localeCompare(b.label, undefined, NATURAL_SORT_OPTS));
      return items;
    }

    case 'show': {
      if (navStack.length === 0) {
        // Root: one folder per show (sorted by sort key) + movie files
        const showFolders: DisplayItem[] = Object.keys(library)
          .sort((a, b) => showSortKey(a, overrides).localeCompare(showSortKey(b, overrides), undefined, NATURAL_SORT_OPTS))
          .map((showName) => ({
            kind: 'folder' as const,
            label: showDisplayLabel(showName, overrides),
            key: showName,
            thumbnailUri: overrides[`show:${showName}`]?.poster || library[showName].poster || pickShowThumbnail(library, showName, thumbnails),
            onPress: () => navigateInto({ label: showName, showName }),
            mediaType: 'show' as const,
          }));
        const sortedMovies = [...movies].sort((a, b) =>
          movieSortKey(a, overrides).localeCompare(movieSortKey(b, overrides), undefined, NATURAL_SORT_OPTS),
        );
        const movieItems: DisplayItem[] = sortedMovies.map((movie) => ({
          kind: 'file' as const,
          label: movieDisplayLabel(movie, overrides),
          key: movie.path,
          thumbnailUri: thumbnails[movie.path],
          posterUri: overrides[`movie:${movie.path}`]?.poster || movie.poster || undefined,
          mediaObject: movie,
          mediaType: 'movie' as const,
        }));
        return [...showFolders, ...movieItems];
      }
      // Inside a show: all episodes from every season
      const show = library[navStack[0].showName!];
      if (!show) return [];
      const items: DisplayItem[] = [];
      const sortedSeasons = Object.values(show.seasons).sort((a, b) => a.seasonNumber - b.seasonNumber);
      for (const season of sortedSeasons) {
        const sortedEps = Object.values(season.episodes).sort((a, b) => compareEpisodes(a, b, overrides));
        for (const ep of sortedEps) {
          const sNum = `S${String(season.seasonNumber).padStart(2, '0')}`;
          const eNum = ep.episodeNumber > 0 ? `E${String(ep.episodeNumber).padStart(2, '0')}` : '';
          const prefix = ep.episodeNumber > 0 ? `${sNum}${eNum}` : '';
          items.push({
            kind: 'file',
            label: episodeDisplayLabel(ep, overrides, prefix),
            key: ep.path,
            thumbnailUri: thumbnails[ep.path],
            mediaObject: ep,
            mediaType: 'episode',
          });
        }
      }
      return items;
    }

    case 'show+season': {
      if (navStack.length === 0) {
        // Root: one folder per show+season combination + movie files
        type ShowSeasonEntry = { item: DisplayItem; sortKey: string };
        const showSeasonEntries: ShowSeasonEntry[] = [];
        for (const [showName, show] of Object.entries(library)) {
          for (const [seasonKey, season] of Object.entries(show.seasons)) {
            const displayShow = showDisplayLabel(showName, overrides);
            const label = `${displayShow} – Season ${season.seasonNumber}`;
            const sortKey = `${showSortKey(showName, overrides)} – Season ${String(season.seasonNumber).padStart(4, '0')}`;
            // Prefer the override poster, then the show's API poster, then first episode thumbnail
            const firstEpThumb = Object.values(season.episodes)
              .map((ep) => thumbnails[ep.path])
              .find(Boolean);
            showSeasonEntries.push({
              sortKey,
              item: {
                kind: 'folder',
                label,
                key: `${showName}::${seasonKey}`,
                thumbnailUri: overrides[`show:${showName}`]?.poster || show.poster || firstEpThumb,
                onPress: () => navigateInto({ label, showName, seasonKey }),
                mediaType: 'season',
              },
            });
          }
        }
        showSeasonEntries.sort((a, b) => a.sortKey.localeCompare(b.sortKey, undefined, NATURAL_SORT_OPTS));
        const sortedMovies = [...movies].sort((a, b) =>
          movieSortKey(a, overrides).localeCompare(movieSortKey(b, overrides), undefined, NATURAL_SORT_OPTS),
        );
        const movieItems: DisplayItem[] = sortedMovies.map((movie) => ({
          kind: 'file' as const,
          label: movieDisplayLabel(movie, overrides),
          key: movie.path,
          thumbnailUri: thumbnails[movie.path],
          posterUri: overrides[`movie:${movie.path}`]?.poster || movie.poster || undefined,
          mediaObject: movie,
          mediaType: 'movie' as const,
        }));
        return [...showSeasonEntries.map((e) => e.item), ...movieItems];
      }
      // Inside a show+season folder: episodes of that season
      const { showName, seasonKey } = navStack[0];
      const season = library[showName!]?.seasons[seasonKey!];
      if (!season) return [];
      return Object.values(season.episodes)
        .sort((a, b) => compareEpisodes(a, b, overrides))
        .map((ep) => {
          const eNum = ep.episodeNumber > 0 ? `E${String(ep.episodeNumber).padStart(2, '0')}` : '';
          return {
            kind: 'file' as const,
            label: episodeDisplayLabel(ep, overrides, eNum),
            key: ep.path,
            thumbnailUri: thumbnails[ep.path],
            mediaObject: ep,
            mediaType: 'episode' as const,
          };
        });
    }

    case 'show/season':
    default: {
      if (navStack.length === 0) {
        // Root: one folder per show (sorted by sort key) + movie files
        const showFolders: DisplayItem[] = Object.keys(library)
          .sort((a, b) => showSortKey(a, overrides).localeCompare(showSortKey(b, overrides), undefined, NATURAL_SORT_OPTS))
          .map((showName) => ({
            kind: 'folder' as const,
            label: showDisplayLabel(showName, overrides),
            key: showName,
            thumbnailUri: overrides[`show:${showName}`]?.poster || library[showName].poster || pickShowThumbnail(library, showName, thumbnails),
            onPress: () => navigateInto({ label: showName, showName }),
            mediaType: 'show' as const,
          }));
        const sortedMovies = [...movies].sort((a, b) =>
          movieSortKey(a, overrides).localeCompare(movieSortKey(b, overrides), undefined, NATURAL_SORT_OPTS),
        );
        const movieItems: DisplayItem[] = sortedMovies.map((movie) => ({
          kind: 'file' as const,
          label: movieDisplayLabel(movie, overrides),
          key: movie.path,
          thumbnailUri: thumbnails[movie.path],
          posterUri: overrides[`movie:${movie.path}`]?.poster || movie.poster || undefined,
          mediaObject: movie,
          mediaType: 'movie' as const,
        }));
        return [...showFolders, ...movieItems];
      }
      if (navStack.length === 1) {
        // Inside a show: one folder per season
        const show = library[navStack[0].showName!];
        if (!show) return [];
        return Object.entries(show.seasons)
          .sort((a, b) => a[1].seasonNumber - b[1].seasonNumber)
          .map(([seasonKey, season]) => {
            const label = `Season ${season.seasonNumber}`;
            // Prefer the override poster, then the show's API poster, then first episode thumbnail
            const firstEpThumb = Object.values(season.episodes)
              .map((ep) => thumbnails[ep.path])
              .find(Boolean);
            return {
              kind: 'folder' as const,
              label,
              key: seasonKey,
              thumbnailUri: overrides[`show:${navStack[0].showName!}`]?.poster || show.poster || firstEpThumb,
              onPress: () =>
                navigateInto({
                  label,
                  showName: navStack[0].showName,
                  seasonKey,
                }),
              mediaType: 'season' as const,
            };
          });
      }
      // Inside a season: episodes
      const show = library[navStack[0].showName!];
      const season = show?.seasons[navStack[1].seasonKey!];
      if (!season) return [];
      return Object.values(season.episodes)
        .sort((a, b) => compareEpisodes(a, b, overrides))
        .map((ep) => {
          const eNum = ep.episodeNumber > 0 ? `E${String(ep.episodeNumber).padStart(2, '0')}` : '';
          return {
            kind: 'file' as const,
            label: episodeDisplayLabel(ep, overrides, eNum),
            key: ep.path,
            thumbnailUri: thumbnails[ep.path],
            mediaObject: ep,
            mediaType: 'episode' as const,
          };
        });
    }
  }
}

// ── Screen ───────────────────────────────────────────────────────────────────

const SCREEN_WIDTH = Dimensions.get('window').width;
const CARD_GAP = 8;
/** Minimum number of grid columns shown at the lowest viewScale. */
const MIN_COLUMNS = 2;
/** Maximum number of grid columns shown at the highest viewScale. */
const MAX_COLUMNS = 5;
/** Divisor used to map viewScale (1-10) to column count. */
const SCALE_TO_COLUMNS_DIVISOR = 2.5;
/** Approximate height of the card label area (paddingTop + paddingBottom + font line-height). */
const LABEL_HEIGHT = 48;

export default function HomeScreen() {
  const mediaSources = useSelector(selectMediaSources);
  const settingsPassword = useSelector(selectPassword);
  const viewType = useSelector(selectMediaStructure);
  const viewScale = useSelector(selectViewScale);
  const viewOrientation = useSelector(selectViewOrientation);
  const mediaLibrary = useSelector(selectMediaLibrary);
  const movies = useSelector(selectMovies);
  const thumbnails = useSelector(selectThumbnails);
  const mediaOverrides = useSelector(selectMediaOverrides);

  const { editMode } = useEditMode();

  const isScanning = useSelector(selectIsScanning);

  const [navStack, setNavStack] = useState<NavLevel[]>([]);
  const [pressedKey, setPressedKey] = useState<string | null>(null);
  useEffect(() => {
    if (!mediaSources || mediaSources.length === 0) {
      logger.log('HomeScreen', 'No media sources configured – skipping scan');
      return;
    }
    logger.log('HomeScreen', `Media sources changed (${mediaSources.length} source(s)) – triggering scan`);
    FileScanner.getInstance().scanAllSources(mediaSources);
  }, [mediaSources]);

  // Reset navigation when viewType changes
  useEffect(() => {
    setNavStack([]);
  }, [viewType]);

  const navigateInto = useCallback((entry: NavLevel) => {
    logger.log('HomeScreen', `Navigate into: ${entry.label} (showName=${entry.showName ?? '-'}, seasonKey=${entry.seasonKey ?? '-'})`);
    setNavStack((prev: NavLevel[]) => [...prev, entry]);
  }, []);

  const navigateBack = useCallback(() => {
    logger.log('HomeScreen', 'Navigate back');
    setNavStack((prev: NavLevel[]) => prev.slice(0, -1));
  }, []);

  // Intercept the Android hardware back button to pop the nav stack when inside a folder.
  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      if (navStack.length > 0) {
        navigateBack();
        return true;
      }
      return false;
    });
    return () => subscription.remove();
  }, [navStack, navigateBack]);

  // Map viewScale (1-10) to number of grid columns (MIN_COLUMNS-MAX_COLUMNS)
  const numColumns = Math.max(MIN_COLUMNS, Math.min(MAX_COLUMNS, Math.round(viewScale / SCALE_TO_COLUMNS_DIVISOR)));
  const cardWidth = (SCREEN_WIDTH - CARD_GAP * (numColumns + 1)) / numColumns;
  // Poster orientation uses a 2:3 portrait ratio; banner/thumbnail orientation uses 16:9 landscape.
  const thumbnailHeight = viewOrientation === 'poster'
    ? Math.round(cardWidth * 3 / 2)
    : Math.round(cardWidth * 9 / 16);

  const displayItems = useMemo(
    () => buildDisplayItems(mediaLibrary, movies, viewType, navStack, thumbnails, mediaOverrides, navigateInto),
    [mediaLibrary, movies, viewType, navStack, thumbnails, mediaOverrides, navigateInto],
  );

  const hasLibraryContent = Object.keys(mediaLibrary).length > 0 || movies.length > 0;

  // Build breadcrumb label: "Home / Show / Season 1"
  const breadcrumb = [
    editMode ? '✏️ Home' : 'Home',
    ...navStack.map((n: NavLevel) => n.label),
  ].join(' › ');

  /** Open the edit screen for a given display item. */
  const openEditScreen = useCallback((item: DisplayItem) => {
    let itemType: 'show' | 'movie' | 'episode';
    let itemKey: string;
    if (item.kind === 'folder' && item.mediaType === 'show') {
      itemType = 'show';
      itemKey = `show:${item.key}`;
    } else if (item.kind === 'file') {
      itemType = item.mediaType === 'movie' ? 'movie' : 'episode';
      itemKey = `${item.mediaType}:${item.mediaObject.path}`;
    } else {
      // Season folders are not editable
      return;
    }
    logger.log('HomeScreen', `Opening edit screen: type=${itemType} key=${itemKey}`);
    router.push({
      pathname: '/edititem',
      params: { itemType, itemKey, currentTitle: item.label },
    });
  }, []);

  return (
    <View style={styles.container}>
      {mediaSources.length > 0 && hasLibraryContent ? (
        <ThemedView style={styles.listContainer}>
          {/* Breadcrumb / back navigation */}
          <ThemedView style={styles.breadcrumbRow}>
            {navStack.length > 0 && (
              <TouchableOpacity onPress={navigateBack} style={styles.backButton}>
                <ThemedText style={styles.backButtonText}>‹ Back</ThemedText>
              </TouchableOpacity>
            )}
            <ThemedText style={styles.breadcrumb} numberOfLines={1}>
              {breadcrumb}
            </ThemedText>
          </ThemedView>

          <FlashList
            data={displayItems}
            keyExtractor={(item: DisplayItem) => item.key}
            numColumns={numColumns}
            extraData={`${editMode}|${pressedKey ?? ''}`}
            renderItem={({ item }: { item: DisplayItem }) => {
              const isFolder = item.kind === 'folder';
              const hasPoster = item.kind === 'file' && !!item.posterUri;
              const hasBothImages = hasPoster && !!item.thumbnailUri;
              const isRevealed = pressedKey === item.key;
              // Files with a poster show the poster by default; long-press reveals the video thumbnail (unless in edit mode).
              const displayUri = hasPoster && !isRevealed ? item.posterUri : item.thumbnailUri;

              const handlePress = isFolder
                ? item.onPress
                : () => {
                    logger.log('HomeScreen', `Opening file: ${item.mediaObject.filename} (${item.mediaObject.path})`);
                    Linking.openURL(item.mediaObject.path).catch((e: unknown) => {
                      logger.error('HomeScreen', `Failed to open file: ${item.mediaObject.path}`, e);
                    });
                  };

              // In edit mode: long-press opens the edit screen for any editable item.
              // Otherwise: long-press on items that have both a poster and a thumbnail reveals the thumbnail.
              const isEditableInEditMode = editMode && (
                item.mediaType === 'show' ||
                item.mediaType === 'movie' ||
                item.mediaType === 'episode'
              );
              const handleLongPress = isEditableInEditMode
                ? () => openEditScreen(item)
                : hasBothImages
                  ? () => setPressedKey(item.key)
                  : undefined;
              const handlePressOut = isEditableInEditMode
                ? undefined
                : hasBothImages
                  ? () => setPressedKey(null)
                  : undefined;

              return (
                <TouchableOpacity
                  onPress={handlePress}
                  onLongPress={handleLongPress}
                  onPressOut={handlePressOut}
                  style={[styles.card, { width: cardWidth }]}
                >
                  <View style={[styles.thumbnailBox, { height: thumbnailHeight }]}>
                    {displayUri ? (
                      <Image
                        source={{ uri: displayUri }}
                        style={styles.thumbnailImage}
                        contentFit="cover"
                      />
                    ) : (
                      <View style={styles.thumbnailPlaceholder}>
                        <ThemedText style={styles.placeholderIcon}>
                          {isFolder ? '📁' : '🎬'}
                        </ThemedText>
                      </View>
                    )}
                    {/* Edit mode indicator overlay */}
                    {isEditableInEditMode && (
                      <View style={styles.editOverlay}>
                        <ThemedText style={styles.editOverlayIcon}>✏️</ThemedText>
                      </View>
                    )}
                  </View>
                  <ThemedText style={styles.cardLabel} numberOfLines={2}>
                    {item.label}
                  </ThemedText>
                </TouchableOpacity>
              );
            }}
            contentContainerStyle={styles.gridContent}
          />
        </ThemedView>
      ) : isScanning ? (
        <ThemedView style={styles.stepContainer}>
          <ThemedText type="subtitle">Scanning…</ThemedText>
          <ThemedText>Scanning your library, please wait.</ThemedText>
        </ThemedView>
      ) : (
        <ThemedView style={styles.stepContainer}>
          <ThemedText type="subtitle">Problem</ThemedText>
          {mediaSources.length > 0 ? (
            <ThemedText>
              Your library directories are empty or invalid, check them in{' '}
              <Link href={settingsPassword ? '/(drawer)/settingsprompt' : '/settings'}>
                Settings
              </Link>
              .
            </ThemedText>
          ) : (
            <ThemedText>
              You need to set up a library directory in{' '}
              <Link href={settingsPassword ? '/(drawer)/settingsprompt' : '/settings'}>
                Settings
              </Link>
              .
            </ThemedText>
          )}
        </ThemedView>
      )}
    </View>
  );
}


const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  listContainer: {
    flex: 1,
  },
  breadcrumbRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    gap: 8,
  },
  backButton: {
    paddingVertical: 4,
    paddingHorizontal: 8,
  },
  backButtonText: {
    fontSize: 16,
    fontWeight: '600',
  },
  breadcrumb: {
    flex: 1,
    fontSize: 14,
    opacity: 0.7,
  },
  gridContent: {
    padding: CARD_GAP,
  },
  card: {
    margin: CARD_GAP / 2,
    borderRadius: 8,
    overflow: 'hidden',
  },
  thumbnailBox: {
    width: '100%',
    backgroundColor: '#222',
    borderRadius: 8,
    overflow: 'hidden',
  },
  thumbnailImage: {
    width: '100%',
    height: '100%',
  },
  thumbnailPlaceholder: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  placeholderIcon: {
    fontSize: 32,
  },
  cardLabel: {
    paddingHorizontal: 4,
    paddingTop: 4,
    paddingBottom: 6,
    fontSize: 12,
  },
  editOverlay: {
    position: 'absolute',
    top: 4,
    right: 4,
    backgroundColor: 'rgba(0,0,0,0.55)',
    borderRadius: 12,
    padding: 3,
  },
  editOverlayIcon: {
    fontSize: 14,
  },
  stepContainer: {
    gap: 8,
    marginBottom: 8,
    padding: 16,
  },
});
