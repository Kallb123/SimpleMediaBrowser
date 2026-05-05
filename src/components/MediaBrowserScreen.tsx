import { BackHandler, StyleSheet, TouchableOpacity, View, useWindowDimensions } from 'react-native';
import { openMediaInExternalApp } from '@/scripts/openMedia';
import { ThemedText } from '@/components/ThemedText';
import { ThemedView } from '@/components/ThemedView';
import { Image } from 'expo-image';
import type { VideoThumbnail } from 'expo-video';
import { Link, router } from 'expo-router';
import { useEffect, useMemo, useCallback, useState } from 'react';
import { useSelector } from 'react-redux';
import { selectMediaSources, selectMediaStructure, selectPassword, selectViewScale, selectViewOrientation } from '@/store/settingsReducer';
import { selectMediaLibrary, selectMovies, selectIsScanning, selectMediaOverrides, selectScanProgress } from '@/store/libraryReducer';
import { FlashList } from '@shopify/flash-list';
import { FileScanner, IMediaObject, thumbnailCache } from '@/scripts/FileScanner';
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

type ThumbnailSource = VideoThumbnail | string;

type DisplayItem =
  | { kind: 'folder'; label: string; sortKey?: string; key: string; thumbnailUri?: ThumbnailSource; posterUri?: string; onPress: () => void; mediaType: 'show' | 'season' }
  | { kind: 'file'; label: string; sortKey?: string; key: string; thumbnailUri?: ThumbnailSource; posterUri?: string; mediaObject: IMediaObject; mediaType: 'movie' | 'episode' };

// ── Helper: pick a representative thumbnail for a show folder ─────────────────

function pickShowThumbnail(
  library: IMediaLibrary,
  showName: string,
): ThumbnailSource | undefined {
  const show = library[showName];
  if (!show) return undefined;
  for (const season of Object.values(show.seasons)) {
    for (const ep of Object.values(season.episodes)) {
      const thumb = thumbnailCache.get(ep.path);
      if (thumb) return thumb;
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
  const o = overrides[`movie:${movie.parsedPath}`];
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
  const aO = overrides[`episode:${a.parsedPath}`];
  const bO = overrides[`episode:${b.parsedPath}`];
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
  const override = overrides[`episode:${ep.parsedPath}`];
  const title = override?.title ?? ep.title;
  if (prefix) {
    return title ? `${prefix} - ${title}` : prefix;
  }
  return title || ep.filename;
}

/** Returns the effective display label for a movie, applying overrides if present. */
function movieDisplayLabel(movie: IMediaObject, overrides: { [key: string]: IMediaOverride }): string {
  return overrides[`movie:${movie.parsedPath}`]?.title ?? movie.title ?? movie.filename;
}

function buildDisplayItems(
  library: IMediaLibrary,
  movies: IMediaObject[],
  viewType: viewTypes,
  navStack: NavLevel[],
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
            const displayPrefix = ep.episodeNumber > 0 ? `${showDisplayLabel(showName, overrides)} ${sNum}${eNum}` : '';
            // Sort key uses show sort key (respects sortTitle override) instead of display title.
            const sortPrefix = ep.episodeNumber > 0 ? `${showSortKey(showName, overrides)} ${sNum}${eNum}` : '';
            items.push({
              kind: 'file',
              label: episodeDisplayLabel(ep, overrides, displayPrefix),
              sortKey: sortPrefix || overrides[`episode:${ep.parsedPath}`]?.sortTitle || ep.title || ep.filename,
              key: ep.path,
              thumbnailUri: thumbnailCache.get(ep.path),
              mediaObject: ep,
              mediaType: 'episode',
            });
          }
        }
      }
      for (const movie of movies) {
        items.push({
          kind: 'file',
          label: movieDisplayLabel(movie, overrides),
          sortKey: movieSortKey(movie, overrides),
          key: movie.path,
          thumbnailUri: thumbnailCache.get(movie.path),
          posterUri: overrides[`movie:${movie.parsedPath}`]?.poster || movie.poster || undefined,
          mediaObject: movie,
          mediaType: 'movie',
        });
      }
      // Sort by sort key (respects sortTitle overrides), falling back to label.
      items.sort((a, b) =>
        (a.sortKey ?? a.label).localeCompare(b.sortKey ?? b.label, undefined, NATURAL_SORT_OPTS),
      );
      return items;
    }

    case 'show': {
      if (navStack.length === 0) {
        // Root: one folder per show + movie files, all sorted together by sort key
        const showFolders: DisplayItem[] = Object.keys(library)
          .map((showName) => ({
            kind: 'folder' as const,
            label: showDisplayLabel(showName, overrides),
            sortKey: showSortKey(showName, overrides),
            key: showName,
            posterUri: overrides[`show:${showName}`]?.poster || library[showName].poster || undefined,
            thumbnailUri: pickShowThumbnail(library, showName),
            onPress: () => navigateInto({ label: showName, showName }),
            mediaType: 'show' as const,
          }));
        const movieItems: DisplayItem[] = movies.map((movie) => ({
          kind: 'file' as const,
          label: movieDisplayLabel(movie, overrides),
          sortKey: movieSortKey(movie, overrides),
          key: movie.path,
          thumbnailUri: thumbnailCache.get(movie.path),
          posterUri: overrides[`movie:${movie.parsedPath}`]?.poster || movie.poster || undefined,
          mediaObject: movie,
          mediaType: 'movie' as const,
        }));
        // Interleave shows and movies sorted together by sort key.
        return [...showFolders, ...movieItems].sort(
          (a, b) => (a.sortKey ?? a.label).localeCompare(b.sortKey ?? b.label, undefined, NATURAL_SORT_OPTS),
        );
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
            thumbnailUri: thumbnailCache.get(ep.path),
            mediaObject: ep,
            mediaType: 'episode',
          });
        }
      }
      return items;
    }

    case 'show+season': {
      if (navStack.length === 0) {
        // Root: one folder per show+season combination + movie files, all sorted together by sort key
        const showSeasonItems: DisplayItem[] = [];
        for (const [showName, show] of Object.entries(library)) {
          for (const [seasonKey, season] of Object.entries(show.seasons)) {
            const displayShow = showDisplayLabel(showName, overrides);
            const label = `${displayShow} – Season ${season.seasonNumber}`;
            const sortKey = `${showSortKey(showName, overrides)} – Season ${String(season.seasonNumber).padStart(4, '0')}`;
            const firstEpThumb = Object.values(season.episodes)
              .map((ep) => thumbnailCache.get(ep.path))
              .find(Boolean);
            showSeasonItems.push({
              kind: 'folder',
              label,
              sortKey,
              key: `${showName}::${seasonKey}`,
              posterUri: overrides[`show:${showName}`]?.poster || show.poster || undefined,
              thumbnailUri: firstEpThumb,
              onPress: () => navigateInto({ label, showName, seasonKey }),
              mediaType: 'season',
            });
          }
        }
        const movieItems: DisplayItem[] = movies.map((movie) => ({
          kind: 'file' as const,
          label: movieDisplayLabel(movie, overrides),
          sortKey: movieSortKey(movie, overrides),
          key: movie.path,
          thumbnailUri: thumbnailCache.get(movie.path),
          posterUri: overrides[`movie:${movie.parsedPath}`]?.poster || movie.poster || undefined,
          mediaObject: movie,
          mediaType: 'movie' as const,
        }));
        // Interleave show+season folders and movies sorted together by sort key.
        return [...showSeasonItems, ...movieItems].sort(
          (a, b) => (a.sortKey ?? a.label).localeCompare(b.sortKey ?? b.label, undefined, NATURAL_SORT_OPTS),
        );
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
            thumbnailUri: thumbnailCache.get(ep.path),
            mediaObject: ep,
            mediaType: 'episode' as const,
          };
        });
    }

    case 'show/season':
    default: {
      if (navStack.length === 0) {
        // Root: one folder per show + movie files, all sorted together by sort key
        const showFolders: DisplayItem[] = Object.keys(library)
          .map((showName) => ({
            kind: 'folder' as const,
            label: showDisplayLabel(showName, overrides),
            sortKey: showSortKey(showName, overrides),
            key: showName,
            posterUri: overrides[`show:${showName}`]?.poster || library[showName].poster || undefined,
            thumbnailUri: pickShowThumbnail(library, showName),
            onPress: () => navigateInto({ label: showName, showName }),
            mediaType: 'show' as const,
          }));
        const movieItems: DisplayItem[] = movies.map((movie) => ({
          kind: 'file' as const,
          label: movieDisplayLabel(movie, overrides),
          sortKey: movieSortKey(movie, overrides),
          key: movie.path,
          thumbnailUri: thumbnailCache.get(movie.path),
          posterUri: overrides[`movie:${movie.parsedPath}`]?.poster || movie.poster || undefined,
          mediaObject: movie,
          mediaType: 'movie' as const,
        }));
        // Interleave shows and movies sorted together by sort key.
        return [...showFolders, ...movieItems].sort(
          (a, b) => (a.sortKey ?? a.label).localeCompare(b.sortKey ?? b.label, undefined, NATURAL_SORT_OPTS),
        );
      }
      if (navStack.length === 1) {
        // Inside a show: one folder per season
        const show = library[navStack[0].showName!];
        if (!show) return [];
        return Object.entries(show.seasons)
          .sort((a, b) => a[1].seasonNumber - b[1].seasonNumber)
          .map(([seasonKey, season]) => {
            const label = `Season ${season.seasonNumber}`;
            const firstEpThumb = Object.values(season.episodes)
              .map((ep) => thumbnailCache.get(ep.path))
              .find(Boolean);
            return {
              kind: 'folder' as const,
              label,
              key: seasonKey,
              posterUri: overrides[`show:${navStack[0].showName!}`]?.poster || show.poster || undefined,
              thumbnailUri: firstEpThumb,
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
            thumbnailUri: thumbnailCache.get(ep.path),
            mediaObject: ep,
            mediaType: 'episode' as const,
          };
        });
    }
  }
}

// ── Screen ───────────────────────────────────────────────────────────────────

const CARD_GAP = 8;
/** Portrait mode: minimum number of grid columns shown at the lowest viewScale. */
const PORTRAIT_MIN_COLUMNS = 2;
/** Portrait mode: maximum number of grid columns shown at the highest viewScale. */
const PORTRAIT_MAX_COLUMNS = 5;
/** Landscape mode: minimum number of grid columns shown at the lowest viewScale. */
const LANDSCAPE_MIN_COLUMNS = 4;
/** Landscape mode: maximum number of grid columns shown at the highest viewScale. */
const LANDSCAPE_MAX_COLUMNS = 10;
/** Valid range for persisted UI scale setting. */
const VIEW_SCALE_MIN = 1;
const VIEW_SCALE_MAX = 10;

function mapScaleToColumns(
  viewScale: number,
  minColumns: number,
  maxColumns: number,
): number {
  const clampedScale = Math.max(VIEW_SCALE_MIN, Math.min(VIEW_SCALE_MAX, viewScale));
  const t = (clampedScale - VIEW_SCALE_MIN) / (VIEW_SCALE_MAX - VIEW_SCALE_MIN);
  return Math.round(minColumns + t * (maxColumns - minColumns));
}

/** Progress bar colour used during the thumbnail generation phase. */
const PROGRESS_COLOR_THUMBNAILS = '#4CAF50';
/** Progress bar colour used during the TMDB metadata enrichment phase. */
const PROGRESS_COLOR_ENRICHING = '#2196F3';

export type MediaFilter = 'all' | 'tv' | 'movies';

interface MediaBrowserScreenProps {
  mediaFilter: MediaFilter;
}

export function MediaBrowserScreen({ mediaFilter }: MediaBrowserScreenProps) {
  const mediaSources = useSelector(selectMediaSources);
  const settingsPassword = useSelector(selectPassword);
  const viewType = useSelector(selectMediaStructure);
  const viewScale = useSelector(selectViewScale);
  const viewOrientation = useSelector(selectViewOrientation);
  const allLibrary = useSelector(selectMediaLibrary);
  const allMovies = useSelector(selectMovies);
  const mediaOverrides = useSelector(selectMediaOverrides);

  const { editMode } = useEditMode();
  const { width: screenWidth, height: screenHeight } = useWindowDimensions();

  const isScanning = useSelector(selectIsScanning);
  const scanProgress = useSelector(selectScanProgress);

  // Apply filter
  const mediaLibrary: IMediaLibrary = mediaFilter === 'movies' ? {} : allLibrary;
  const movies: IMediaObject[] = mediaFilter === 'tv' ? [] : allMovies;

  const [navStack, setNavStack] = useState<NavLevel[]>([]);
  const [pressedKey, setPressedKey] = useState<string | null>(null);
  useEffect(() => {
    if (!mediaSources || mediaSources.length === 0) {
      logger.log('MediaBrowserScreen', 'No media sources configured – skipping scan');
      return;
    }
    logger.log('MediaBrowserScreen', `Media sources changed (${mediaSources.length} source(s)) – triggering scan`);
    FileScanner.getInstance().scanAllSources(mediaSources);
  }, [mediaSources]);

  // Reset navigation when viewType changes
  useEffect(() => {
    setNavStack([]);
  }, [viewType]);

  const navigateInto = useCallback((entry: NavLevel) => {
    logger.log('MediaBrowserScreen', `Navigate into: ${entry.label} (showName=${entry.showName ?? '-'}, seasonKey=${entry.seasonKey ?? '-'})`);
    setNavStack((prev: NavLevel[]) => [...prev, entry]);
  }, []);

  const navigateBack = useCallback(() => {
    logger.log('MediaBrowserScreen', 'Navigate back');
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

  // Map viewScale (1-10) to number of grid columns based on current orientation.
  const isLandscape = screenWidth > screenHeight;
  const minColumns = isLandscape ? LANDSCAPE_MIN_COLUMNS : PORTRAIT_MIN_COLUMNS;
  const maxColumns = isLandscape ? LANDSCAPE_MAX_COLUMNS : PORTRAIT_MAX_COLUMNS;
  const numColumns = mapScaleToColumns(viewScale, minColumns, maxColumns);
  const cardWidth = (screenWidth - CARD_GAP * (numColumns + 1)) / numColumns;
  // Poster orientation uses a 2:3 portrait ratio; banner/thumbnail orientation uses 16:9 landscape.
  const thumbnailHeight = viewOrientation === 'poster'
    ? Math.round(cardWidth * 3 / 2)
    : Math.round(cardWidth * 9 / 16);

  const displayItems = useMemo(
    () => buildDisplayItems(mediaLibrary, movies, viewType, navStack, mediaOverrides, navigateInto),
    // scanProgress.thumbnailsDone is included so the memo re-runs each time a
    // thumbnail is added to thumbnailCache during the thumbnail generation phase.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [mediaLibrary, movies, viewType, navStack, mediaOverrides, navigateInto, scanProgress.thumbnailsDone],
  );

  const hasLibraryContent = Object.keys(mediaLibrary).length > 0 || movies.length > 0;

  // Root label for breadcrumb
  const rootLabel = mediaFilter === 'tv'
    ? (editMode ? '✏️ TV' : 'TV')
    : mediaFilter === 'movies'
      ? (editMode ? '✏️ Movies' : 'Movies')
      : (editMode ? '✏️ Home' : 'Home');

  // Build breadcrumb label: "Home / Show / Season 1"
  const breadcrumb = [
    rootLabel,
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
      itemKey = `${item.mediaType}:${item.mediaObject.parsedPath}`;
    } else {
      // Season folders are not editable
      return;
    }
    logger.log('MediaBrowserScreen', `Opening edit screen: type=${itemType} key=${itemKey}`);
    router.push({
      pathname: '/edititem',
      params: { itemType, itemKey, currentTitle: item.label },
    });
  }, []);

  return (
    <View style={styles.container}>
      {mediaSources.length > 0 && hasLibraryContent ? (
        <ThemedView style={styles.listContainer}>
          {/* Scan progress banner – shown at the top of the grid while any scan phase is active */}
          {isScanning && scanProgress.phase !== 'idle' && (
            <View style={styles.scanBanner}>
              <ThemedText style={styles.scanBannerText}>
                {scanProgress.phase === 'collecting'
                  ? `Scanning… found ${scanProgress.filesFound} file${scanProgress.filesFound !== 1 ? 's' : ''}`
                  : scanProgress.phase === 'thumbnails'
                    ? `Generating thumbnails (${scanProgress.thumbnailsDone} / ${scanProgress.thumbnailsTotal})`
                    : `Fetching metadata… (${scanProgress.metadataDone} / ${scanProgress.metadataTotal})`}
              </ThemedText>
              {scanProgress.phase === 'thumbnails' && (
                <View style={styles.scanProgressTrack}>
                  <View
                    style={[
                      styles.scanProgressFill,
                      {
                        width: `${Math.round(
                          (scanProgress.thumbnailsDone / Math.max(1, scanProgress.thumbnailsTotal)) * 100,
                        )}%`,
                        backgroundColor: PROGRESS_COLOR_THUMBNAILS,
                      },
                    ]}
                  />
                </View>
              )}
              {scanProgress.phase === 'enriching' && (
                <View style={styles.scanProgressTrack}>
                  <View
                    style={[
                      styles.scanProgressFill,
                      {
                        width: `${Math.round(
                          (scanProgress.metadataDone / Math.max(1, scanProgress.metadataTotal)) * 100,
                        )}%`,
                        backgroundColor: PROGRESS_COLOR_ENRICHING,
                      },
                    ]}
                  />
                </View>
              )}
            </View>
          )}

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
              // Both folder (show/season) and file (movie/episode) items can have a poster.
              const hasPoster = !!item.posterUri;
              const hasBothImages = hasPoster && !!item.thumbnailUri;
              const isRevealed = pressedKey === item.key;
              // Items with a poster show the poster by default; long-press reveals the video thumbnail (unless in edit mode).
              const displaySource = item.posterUri && !isRevealed
                ? { uri: item.posterUri }
                : typeof item.thumbnailUri === 'string'
                  ? { uri: item.thumbnailUri }
                  : item.thumbnailUri; // VideoThumbnail (SharedRef) passed directly to expo-image

              // True when the item is displaying a raw video thumbnail (not a poster image).
              // In poster layout, thumbnails are 16:9 and would be cropped by "cover"; use "contain" instead.
              const isShowingVideoThumbnail = !hasPoster || isRevealed;

              const handlePress = isFolder
                ? item.onPress
                : () => {
                    logger.log('MediaBrowserScreen', `Opening file: ${item.mediaObject.filename} (${item.mediaObject.path})`);
                    openMediaInExternalApp(item.mediaObject.path, item.mediaObject.filename).catch((e: unknown) => {
                      logger.error('MediaBrowserScreen', `Failed to open file: ${item.mediaObject.path}`, e);
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
                    {displaySource ? (
                      <Image
                        source={displaySource}
                        style={styles.thumbnailImage}
                        contentFit={viewOrientation === 'poster' && isShowingVideoThumbnail ? 'contain' : 'cover'}
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
          <ThemedText type="subtitle">
            {scanProgress.phase === 'thumbnails'
              ? 'Generating Thumbnails…'
              : scanProgress.phase === 'enriching'
                ? 'Fetching Metadata…'
                : 'Scanning…'}
          </ThemedText>
          {scanProgress.phase === 'thumbnails' ? (
            <>
              <ThemedText>
                {`Thumbnail ${scanProgress.thumbnailsDone} of ${scanProgress.thumbnailsTotal}`}
              </ThemedText>
              <View style={styles.progressBarTrack}>
                <View
                  style={[
                    styles.progressBarFill,
                    {
                      width: `${Math.round(
                        (scanProgress.thumbnailsDone / Math.max(1, scanProgress.thumbnailsTotal)) * 100,
                      )}%`,
                    },
                  ]}
                />
              </View>
            </>
          ) : scanProgress.phase === 'enriching' ? (
            <>
              <ThemedText>
                {`Fetching metadata ${scanProgress.metadataDone} of ${scanProgress.metadataTotal}`}
              </ThemedText>
              <View style={styles.progressBarTrack}>
                <View
                  style={[
                    styles.progressBarFill,
                    {
                      width: `${Math.round(
                        (scanProgress.metadataDone / Math.max(1, scanProgress.metadataTotal)) * 100,
                      )}%`,
                    },
                  ]}
                />
              </View>
            </>
          ) : (
            <ThemedText>
              {scanProgress.filesFound > 0
                ? `Found ${scanProgress.filesFound} file${scanProgress.filesFound === 1 ? '' : 's'} so far…`
                : 'Scanning your library, please wait.'}
            </ThemedText>
          )}
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
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
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
  progressBarTrack: {
    width: '100%',
    height: 8,
    backgroundColor: '#444',
    borderRadius: 4,
    overflow: 'hidden',
    marginTop: 4,
  },
  progressBarFill: {
    height: '100%',
    backgroundColor: PROGRESS_COLOR_THUMBNAILS,
    borderRadius: 4,
  },
  scanBanner: {
    paddingHorizontal: 12,
    paddingTop: 6,
    paddingBottom: 4,
    gap: 4,
  },
  scanBannerText: {
    fontSize: 12,
    opacity: 0.75,
  },
  scanProgressTrack: {
    width: '100%',
    height: 4,
    backgroundColor: '#444',
    borderRadius: 2,
    overflow: 'hidden',
  },
  scanProgressFill: {
    height: '100%',
    borderRadius: 2,
  },
});
