import { Alert, BackHandler, StyleSheet, TouchableOpacity, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { openMediaInExternalApp } from '@/scripts/openMedia';
import { ThemedText } from '@/components/ThemedText';
import { ThemedView } from '@/components/ThemedView';
import { useThemeColor } from '@/hooks/useThemeColor';
import { File } from 'expo-file-system';
import type { VideoThumbnail } from 'expo-video';
import { Link, router } from 'expo-router';
import { useEffect, useMemo, useCallback, useState, useRef } from 'react';
import { useSelector, useDispatch } from 'react-redux';
import { selectMediaSources, selectMediaStructure, selectViewScale, selectViewOrientation, selectSortOrder } from '@/store/settingsReducer';
import { clearEpisodeMetadata, clearMovieMetadata, clearMediaOverride, clearShowMetadata, setMediaOverride, setEpisodeLastOpened, setMovieLastOpened, setAudiobookLastOpened, getShowLastOpened, getSeasonLastOpened, getShowFirstDetected, getSeasonFirstDetected } from '@/store/libraryReducer';
import { selectMediaLibrary, selectMovies, selectAudiobooks, selectIsScanning, selectMediaOverrides, selectScanProgress } from '@/store/libraryReducer';
import { MetadataService } from '@/scripts/MetadataService';
import { store } from '@/store/store';
import { FlashList, FlashListRef, ViewToken } from '@shopify/flash-list';
import { IMediaObject, thumbnailCache } from '@/scripts/FileScanner';
import type { IMediaLibrary, IMediaAudiobook } from '@/store/libraryReducer';
import type { IMediaOverride } from '@/store/libraryReducer';
import type { viewTypes, sortOrders } from '@/store/settingsReducer';
import { logger } from '@/scripts/Logger';
import { useEditMode } from '@/contexts/EditModeContext';
import { PosterBox } from '@/components/ui/PosterBox';
import { ListItem } from '@/components/ui/ListItem';
import { LANDSCAPE_MAX_COLUMNS, LANDSCAPE_MIN_COLUMNS, PORTRAIT_MAX_COLUMNS, PORTRAIT_MIN_COLUMNS, VIEW_SCALE_MAX, VIEW_SCALE_MIN, mapScaleToColumns } from '@/utils/viewScale';

// ── Navigation types ─────────────────────────────────────────────────────────

type NavLevel = {
  label: string;
  showName?: string;
  seasonKey?: string;
  /** Set when navigating into a multi-part audiobook to list its files. */
  audiobookKey?: string;
};

type ThumbnailSource = VideoThumbnail | string;

type DisplayItem =
  | { kind: 'folder'; label: string; sortKey?: string; lastOpened?: number; firstDetected?: number; key: string; thumbnailUri?: ThumbnailSource; posterUri?: string; onPress: () => void; mediaType: 'show' | 'season' | 'audiobook'; count?: number }
  | { kind: 'file'; label: string; sortKey?: string; lastOpened?: number; firstDetected?: number; key: string; thumbnailUri?: ThumbnailSource; posterUri?: string; mediaObject: IMediaObject; mediaType: 'movie' | 'episode' | 'audiobook' };

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
    const aKey = aSortTitle ?? aO?.title ?? a.resolvedTitle ?? a.title ?? a.filename;
    const bKey = bSortTitle ?? bO?.title ?? b.resolvedTitle ?? b.title ?? b.filename;
    return aKey.localeCompare(bKey, undefined, NATURAL_SORT_OPTS);
  }
  if (a.episodeNumber !== b.episodeNumber) return a.episodeNumber - b.episodeNumber;
  return (a.resolvedTitle ?? a.title ?? a.filename).localeCompare(b.resolvedTitle ?? b.title ?? b.filename, undefined, NATURAL_SORT_OPTS);
}

/** Locale-compare options that produce natural (numeric-aware) sort order. */
const NATURAL_SORT_OPTS: Intl.CollatorOptions = { numeric: true, sensitivity: 'base' };

function compareItemLabels(a: DisplayItem, b: DisplayItem): number {
  return (a.sortKey ?? a.label).localeCompare(b.sortKey ?? b.label, undefined, NATURAL_SORT_OPTS);
}

/**
 * Reorders a list of display items according to the "Sorting" appearance setting.
 * `lastOpened`/`reverseLastOpened` fall back to alphabetical order for items that
 * have never been opened, and always place them after any opened items.
 * `recentlyAdded` similarly falls back to alphabetical order for items with no
 * `firstDetected` timestamp, placing them after items that do have one.
 */
function applySortOrder(items: DisplayItem[], sortOrder: sortOrders): DisplayItem[] {
  const sorted = [...items];
  switch (sortOrder) {
    case 'reverseAlphabetical':
      return sorted.sort((a, b) => compareItemLabels(b, a));
    case 'lastOpened':
      return sorted.sort((a, b) => {
        if (a.lastOpened === undefined && b.lastOpened === undefined) return compareItemLabels(a, b);
        if (a.lastOpened === undefined) return 1;
        if (b.lastOpened === undefined) return -1;
        return b.lastOpened - a.lastOpened;
      });
    case 'reverseLastOpened':
      return sorted.sort((a, b) => {
        if (a.lastOpened === undefined && b.lastOpened === undefined) return compareItemLabels(a, b);
        if (a.lastOpened === undefined) return 1;
        if (b.lastOpened === undefined) return -1;
        return a.lastOpened - b.lastOpened;
      });
    case 'recentlyAdded':
      return sorted.sort((a, b) => {
        if (a.firstDetected === undefined && b.firstDetected === undefined) return compareItemLabels(a, b);
        if (a.firstDetected === undefined) return 1;
        if (b.firstDetected === undefined) return -1;
        return b.firstDetected - a.firstDetected;
      });
    case 'alphabetical':
    default:
      return sorted.sort(compareItemLabels);
  }
}

/** Returns the effective display label for an episode, applying overrides to the title portion. */
function episodeDisplayLabel(ep: IMediaObject, overrides: { [key: string]: IMediaOverride }, prefix: string): string {
  const override = overrides[`episode:${ep.parsedPath}`];
  // Priority: user override > provider-resolved title > scanned (local) title
  const title = override?.title ?? ep.resolvedTitle ?? ep.title;
  if (prefix) {
    return title ? `${prefix} - ${title}` : prefix;
  }
  return title || ep.filename;
}

/** Returns the effective display label for a movie, applying overrides if present. */
function movieDisplayLabel(movie: IMediaObject, overrides: { [key: string]: IMediaOverride }): string {
  return overrides[`movie:${movie.parsedPath}`]?.title ?? movie.title ?? movie.filename;
}

/** Returns the effective poster URI for an episode: user override > provider-resolved still > none. */
function getEpisodePosterUri(ep: IMediaObject, overrides: { [key: string]: IMediaOverride }): string | undefined {
  return overrides[`episode:${ep.parsedPath}`]?.poster || ep.resolvedThumbnail || undefined;
}

/** Returns the effective display label for an audiobook, applying overrides if present. */
function audiobookDisplayLabel(audiobook: IMediaAudiobook, overrides: { [key: string]: IMediaOverride }): string {
  return overrides[`audiobook:${audiobook.folderKey}`]?.title ?? audiobook.title;
}

/** Returns the effective sort key for an audiobook (sortTitle > title override > title). */
function audiobookSortKey(audiobook: IMediaAudiobook, overrides: { [key: string]: IMediaOverride }): string {
  const o = overrides[`audiobook:${audiobook.folderKey}`];
  return o?.sortTitle ?? o?.title ?? audiobook.title;
}

/**
 * Builds a minimal {@link IMediaObject} for a single audiobook file so it can be
 * opened via the shared file-open flow.
 */
function makeAudiobookFileObject(file: { path: string; parsedPath: string; filename: string }): IMediaObject {
  return {
    ids: { tvdb: null, imdb: null, tmdb: null },
    episodeNumber: 0,
    title: file.filename.replace(/\.[^.]+$/, ''),
    filename: file.filename,
    path: file.path,
    parsedPath: file.parsedPath,
    isDirectory: false,
    poster: '',
  };
}

/**
 * Builds the root-level display items for audiobooks.  A multi-part audiobook is
 * shown as a folder (navigating in lists its parts); a single-file audiobook is
 * shown as a file that opens directly.
 */
function buildAudiobookRootItems(
  audiobooks: IMediaAudiobook[],
  overrides: { [key: string]: IMediaOverride },
  navigateInto: (entry: NavLevel) => void,
): DisplayItem[] {
  return audiobooks
    .filter((audiobook) => !overrides[`audiobook:${audiobook.folderKey}`]?.hidden)
    .map((audiobook) => {
      const label = audiobookDisplayLabel(audiobook, overrides);
      const sortKey = audiobookSortKey(audiobook, overrides);
      const posterUri = overrides[`audiobook:${audiobook.folderKey}`]?.poster || audiobook.poster || undefined;
      if (audiobook.files.length > 1) {
        return {
          kind: 'folder' as const,
          label,
          sortKey,
          lastOpened: audiobook.lastOpened,
          firstDetected: audiobook.firstDetected,
          key: `audiobook:${audiobook.folderKey}`,
          posterUri,
          onPress: () => navigateInto({ label, audiobookKey: audiobook.folderKey }),
          mediaType: 'audiobook' as const,
          count: audiobook.files.length,
        };
      }
      return {
        kind: 'file' as const,
        label,
        sortKey,
        lastOpened: audiobook.lastOpened,
        firstDetected: audiobook.firstDetected,
        key: `audiobook:${audiobook.folderKey}`,
        posterUri,
        mediaObject: makeAudiobookFileObject(audiobook.files[0] ?? { path: audiobook.path, parsedPath: audiobook.path, filename: audiobook.title }),
        mediaType: 'audiobook' as const,
      };
    });
}

/**
 * Top-level builder that layers audiobook browsing on top of the TV/movie
 * display logic.  Audiobook part-listing (when navigated into a multi-part
 * audiobook) takes priority over the viewType-driven layout; at the root level,
 * audiobook items are interleaved with the TV/movie items.
 */
function buildDisplayItems(
  library: IMediaLibrary,
  movies: IMediaObject[],
  audiobooks: IMediaAudiobook[],
  viewType: viewTypes,
  navStack: NavLevel[],
  overrides: { [key: string]: IMediaOverride },
  navigateInto: (entry: NavLevel) => void,
  sortOrder: sortOrders,
): DisplayItem[] {
  // Inside a multi-part audiobook: list its files as openable items.
  const audiobookLevel = navStack.find((n) => n.audiobookKey);
  if (audiobookLevel) {
    const audiobook = audiobooks.find((a) => a.folderKey === audiobookLevel.audiobookKey);
    if (!audiobook) return [];
    return audiobook.files.map((file) => ({
      kind: 'file' as const,
      label: file.filename.replace(/\.[^.]+$/, '').replace(/[\._]+/g, ' ').trim() || file.filename,
      key: file.path,
      mediaObject: makeAudiobookFileObject(file),
      mediaType: 'audiobook' as const,
    }));
  }

  const baseItems = buildBaseDisplayItems(library, movies, viewType, navStack, overrides, navigateInto, sortOrder);

  // Audiobooks only appear at the root level (they have no viewType hierarchy).
  if (navStack.length === 0 && audiobooks.length > 0) {
    const audiobookItems = buildAudiobookRootItems(audiobooks, overrides, navigateInto);
    return applySortOrder([...baseItems, ...audiobookItems], sortOrder);
  }
  return baseItems;
}

function buildBaseDisplayItems(
  library: IMediaLibrary,
  movies: IMediaObject[],
  viewType: viewTypes,
  navStack: NavLevel[],
  overrides: { [key: string]: IMediaOverride },
  navigateInto: (entry: NavLevel) => void,
  sortOrder: sortOrders,
): DisplayItem[] {
  switch (viewType) {
    case 'flat': {
      // All episodes from every show/season in one flat list, plus movies
      const items: DisplayItem[] = [];
      for (const [showName, show] of Object.entries(library)) {
        // Skip shows that have been hidden
        if (overrides[`show:${showName}`]?.hidden) continue;
        const sortedSeasons = Object.values(show.seasons).sort((a, b) => a.seasonNumber - b.seasonNumber);
        for (const season of sortedSeasons) {
          const sortedEps = Object.values(season.episodes).sort((a, b) => compareEpisodes(a, b, overrides));
          for (const ep of sortedEps) {
            // Skip hidden episodes
            if (overrides[`episode:${ep.parsedPath}`]?.hidden) continue;
            const sNum = `S${String(season.seasonNumber).padStart(2, '0')}`;
            const eNum = ep.episodeNumber > 0 ? `E${String(ep.episodeNumber).padStart(2, '0')}` : '';
            const displayPrefix = ep.episodeNumber > 0 ? `${showDisplayLabel(showName, overrides)} ${sNum}${eNum}` : '';
            // Sort key uses show sort key (respects sortTitle override) instead of display title.
            const sortPrefix = ep.episodeNumber > 0 ? `${showSortKey(showName, overrides)} ${sNum}${eNum}` : '';
            items.push({
              kind: 'file',
              label: episodeDisplayLabel(ep, overrides, displayPrefix),
              sortKey: sortPrefix || overrides[`episode:${ep.parsedPath}`]?.sortTitle || ep.resolvedTitle || ep.title || ep.filename,
              lastOpened: ep.lastOpened,
              firstDetected: ep.firstDetected,
              key: ep.path,
              thumbnailUri: thumbnailCache.get(ep.path),
              posterUri: getEpisodePosterUri(ep, overrides),
              mediaObject: ep,
              mediaType: 'episode',
            });
          }
        }
      }
      for (const movie of movies) {
        // Skip hidden movies
        if (overrides[`movie:${movie.parsedPath}`]?.hidden) continue;
        items.push({
          kind: 'file',
          label: movieDisplayLabel(movie, overrides),
          sortKey: movieSortKey(movie, overrides),
          lastOpened: movie.lastOpened,
          firstDetected: movie.firstDetected,
          key: movie.path,
          thumbnailUri: thumbnailCache.get(movie.path),
          posterUri: overrides[`movie:${movie.parsedPath}`]?.poster || movie.poster || undefined,
          mediaObject: movie,
          mediaType: 'movie',
        });
      }
      // Order by the user's chosen "Sorting" appearance setting.
      return applySortOrder(items, sortOrder);
    }

    case 'show': {
      if (navStack.length === 0) {
        // Root: one folder per show + movie files, all sorted together by sort key
        const showFolders: DisplayItem[] = Object.keys(library)
          .filter((showName) => !overrides[`show:${showName}`]?.hidden)
          .map((showName) => {
            const show = library[showName];
            const episodeCount = Object.values(show.seasons).reduce(
              (sum, season) => sum + Object.keys(season.episodes).length,
              0,
            );
            return {
              kind: 'folder' as const,
              label: showDisplayLabel(showName, overrides),
              sortKey: showSortKey(showName, overrides),
              lastOpened: getShowLastOpened(show),
              firstDetected: getShowFirstDetected(show),
              key: showName,
              posterUri: overrides[`show:${showName}`]?.poster || show.poster || undefined,
              thumbnailUri: pickShowThumbnail(library, showName),
              onPress: () => navigateInto({ label: showName, showName }),
              mediaType: 'show' as const,
              count: episodeCount,
            };
          });
        const movieItems: DisplayItem[] = movies
          .filter((movie) => !overrides[`movie:${movie.parsedPath}`]?.hidden)
          .map((movie) => ({
            kind: 'file' as const,
            label: movieDisplayLabel(movie, overrides),
            sortKey: movieSortKey(movie, overrides),
            lastOpened: movie.lastOpened,
            firstDetected: movie.firstDetected,
            key: movie.path,
            thumbnailUri: thumbnailCache.get(movie.path),
            posterUri: overrides[`movie:${movie.parsedPath}`]?.poster || movie.poster || undefined,
            mediaObject: movie,
            mediaType: 'movie' as const,
          }));
        // Interleave shows and movies, ordered by the user's chosen "Sorting" appearance setting.
        return applySortOrder([...showFolders, ...movieItems], sortOrder);
      }
      // Inside a show: all episodes from every season
      const show = library[navStack[0].showName!];
      if (!show) return [];
      const items: DisplayItem[] = [];
      const sortedSeasons = Object.values(show.seasons).sort((a, b) => a.seasonNumber - b.seasonNumber);
      for (const season of sortedSeasons) {
        const sortedEps = Object.values(season.episodes).sort((a, b) => compareEpisodes(a, b, overrides));
        for (const ep of sortedEps) {
          if (overrides[`episode:${ep.parsedPath}`]?.hidden) continue;
          const sNum = `S${String(season.seasonNumber).padStart(2, '0')}`;
          const eNum = ep.episodeNumber > 0 ? `E${String(ep.episodeNumber).padStart(2, '0')}` : '';
          const prefix = ep.episodeNumber > 0 ? `${sNum}${eNum}` : '';
          items.push({
            kind: 'file',
            label: episodeDisplayLabel(ep, overrides, prefix),
            key: ep.path,
            thumbnailUri: thumbnailCache.get(ep.path),
            posterUri: getEpisodePosterUri(ep, overrides),
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
          if (overrides[`show:${showName}`]?.hidden) continue;
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
              lastOpened: getSeasonLastOpened(season),
              firstDetected: getSeasonFirstDetected(season),
              key: `${showName}::${seasonKey}`,
              posterUri: overrides[`show:${showName}`]?.poster || show.poster || undefined,
              thumbnailUri: firstEpThumb,
              onPress: () => navigateInto({ label, showName, seasonKey }),
              mediaType: 'season',
              count: Object.keys(season.episodes).length,
            });
          }
        }
        const movieItems: DisplayItem[] = movies
          .filter((movie) => !overrides[`movie:${movie.parsedPath}`]?.hidden)
          .map((movie) => ({
            kind: 'file' as const,
            label: movieDisplayLabel(movie, overrides),
            sortKey: movieSortKey(movie, overrides),
            lastOpened: movie.lastOpened,
            firstDetected: movie.firstDetected,
            key: movie.path,
            thumbnailUri: thumbnailCache.get(movie.path),
            posterUri: overrides[`movie:${movie.parsedPath}`]?.poster || movie.poster || undefined,
            mediaObject: movie,
            mediaType: 'movie' as const,
          }));
        // Interleave show+season folders and movies, ordered by the "Sorting" appearance setting.
        return applySortOrder([...showSeasonItems, ...movieItems], sortOrder);
      }
      // Inside a show+season folder: episodes of that season
      const { showName, seasonKey } = navStack[0];
      const season = library[showName!]?.seasons[seasonKey!];
      if (!season) return [];
      return Object.values(season.episodes)
        .sort((a, b) => compareEpisodes(a, b, overrides))
        .filter((ep) => !overrides[`episode:${ep.parsedPath}`]?.hidden)
        .map((ep) => {
          const eNum = ep.episodeNumber > 0 ? `E${String(ep.episodeNumber).padStart(2, '0')}` : '';
          return {
            kind: 'file' as const,
            label: episodeDisplayLabel(ep, overrides, eNum),
            key: ep.path,
            thumbnailUri: thumbnailCache.get(ep.path),
            posterUri: getEpisodePosterUri(ep, overrides),
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
          .filter((showName) => !overrides[`show:${showName}`]?.hidden)
          .map((showName) => ({
            kind: 'folder' as const,
            label: showDisplayLabel(showName, overrides),
            sortKey: showSortKey(showName, overrides),
            lastOpened: getShowLastOpened(library[showName]),
            firstDetected: getShowFirstDetected(library[showName]),
            key: showName,
            posterUri: overrides[`show:${showName}`]?.poster || library[showName].poster || undefined,
            thumbnailUri: pickShowThumbnail(library, showName),
            onPress: () => navigateInto({ label: showName, showName }),
            mediaType: 'show' as const,
            count: Object.values(library[showName].seasons).reduce(
              (sum, season) => sum + Object.keys(season.episodes).length,
              0,
            ),
          }));
        const movieItems: DisplayItem[] = movies
          .filter((movie) => !overrides[`movie:${movie.parsedPath}`]?.hidden)
          .map((movie) => ({
            kind: 'file' as const,
            label: movieDisplayLabel(movie, overrides),
            sortKey: movieSortKey(movie, overrides),
            lastOpened: movie.lastOpened,
            firstDetected: movie.firstDetected,
            key: movie.path,
            thumbnailUri: thumbnailCache.get(movie.path),
            posterUri: overrides[`movie:${movie.parsedPath}`]?.poster || movie.poster || undefined,
            mediaObject: movie,
            mediaType: 'movie' as const,
          }));
        // Interleave shows and movies, ordered by the user's chosen "Sorting" appearance setting.
        return applySortOrder([...showFolders, ...movieItems], sortOrder);
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
              count: Object.keys(season.episodes).length,
            };
          });
      }
      // Inside a season: episodes
      const show = library[navStack[0].showName!];
      const season = show?.seasons[navStack[1].seasonKey!];
      if (!season) return [];
      return Object.values(season.episodes)
        .sort((a, b) => compareEpisodes(a, b, overrides))
        .filter((ep) => !overrides[`episode:${ep.parsedPath}`]?.hidden)
        .map((ep) => {
          const eNum = ep.episodeNumber > 0 ? `E${String(ep.episodeNumber).padStart(2, '0')}` : '';
          return {
            kind: 'file' as const,
            label: episodeDisplayLabel(ep, overrides, eNum),
            key: ep.path,
            thumbnailUri: thumbnailCache.get(ep.path),
            posterUri: getEpisodePosterUri(ep, overrides),
            mediaObject: ep,
            mediaType: 'episode' as const,
          };
        });
    }
  }
}

// ── Screen ───────────────────────────────────────────────────────────────────

/** Serialises a nav stack into a stable string key used to save/restore scroll positions. */
const navStackKey = (stack: NavLevel[]) => stack.map((n) => n.label).join('/');

/** Stable empty collections, so filtered-out media types keep a constant identity across
 *  renders instead of handing the `displayItems` memo a fresh `{}`/`[]` every time. */
const EMPTY_LIBRARY: IMediaLibrary = {};
const EMPTY_MOVIES: IMediaObject[] = [];
const EMPTY_AUDIOBOOKS: IMediaAudiobook[] = [];

const CARD_GAP = 8;
/** Portrait mode: minimum number of grid columns shown at the lowest viewScale. */
const LIST_ROW_MIN_HEIGHT = 40;
/** List mode: row height at the lowest viewScale (fewest items). */
const LIST_ROW_MAX_HEIGHT = 80;

/**
 * Maps viewScale (1-10) to a row height in pixels for list mode.
 * Lower viewScale (fewer columns in poster mode = bigger items) → taller rows.
 */
function mapScaleToListRowHeight(viewScale: number): number {
  const clampedScale = Math.max(VIEW_SCALE_MIN, Math.min(VIEW_SCALE_MAX, viewScale));
  const t = (clampedScale - VIEW_SCALE_MIN) / (VIEW_SCALE_MAX - VIEW_SCALE_MIN);
  // Invert t so that a low viewScale gives a taller row (consistent with poster mode).
  return Math.round(LIST_ROW_MAX_HEIGHT - t * (LIST_ROW_MAX_HEIGHT - LIST_ROW_MIN_HEIGHT));
}

/** Vertical padding applied to the top of the merge toolbar (px). */
const MERGE_TOOLBAR_PADDING_VERTICAL = 10;
/** Total static height of the merge toolbar in pixels (top padding + button row + bottom padding),
 *  used to reserve scroll space below the list. The bottom padding is extended at runtime by the
 *  safe-area bottom inset, so only the static part is captured here. */
const MERGE_TOOLBAR_HEIGHT = MERGE_TOOLBAR_PADDING_VERTICAL + 36 + MERGE_TOOLBAR_PADDING_VERTICAL;

/** Progress bar colour used during the thumbnail generation phase. */
const PROGRESS_COLOR_THUMBNAILS = '#4CAF50';
/** Progress bar colour used during the TMDB metadata enrichment phase. */
const PROGRESS_COLOR_ENRICHING = '#2196F3';

export type MediaFilter = 'all' | 'tv' | 'movies' | 'audiobooks';

interface MediaBrowserScreenProps {
  mediaFilter: MediaFilter;
}

export function MediaBrowserScreen({ mediaFilter }: MediaBrowserScreenProps) {
  const mediaSources = useSelector(selectMediaSources);
  const viewType = useSelector(selectMediaStructure);
  const viewScale = useSelector(selectViewScale);
  const viewOrientation = useSelector(selectViewOrientation);
  const sortOrder = useSelector(selectSortOrder);
  const allLibrary = useSelector(selectMediaLibrary);
  const allMovies = useSelector(selectMovies);
  const allAudiobooks = useSelector(selectAudiobooks);
  const mediaOverrides = useSelector(selectMediaOverrides);

  const dispatch = useDispatch();
  const { editMode, selectedItems, toggleItemSelection, clearItemSelection } = useEditMode();
  const { width: screenWidth, height: screenHeight } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const backButtonBorderColor = useThemeColor(
    { light: 'rgba(0,0,0,0.12)', dark: 'rgba(255,255,255,0.18)' },
    'text',
  );
  const backButtonBackgroundColor = useThemeColor(
    { light: 'rgba(0,0,0,0.04)', dark: 'rgba(255,255,255,0.08)' },
    'background',
  );

  const isScanning = useSelector(selectIsScanning);
  const scanProgress = useSelector(selectScanProgress);

  const handleCancelScan = useCallback(() => {
    import('@/scripts/FileScanner').then(({ FileScanner }) => {
      FileScanner.getInstance().cancelScan();
    }).catch((e) => {
      logger.warn('MediaBrowserScreen', 'Failed to request scan cancellation', e);
    });
  }, []);

  // Apply filter. These are memoised because they feed the `displayItems` memo, which in
  // turn is FlashList's `data`: rebuilding the empty literals on every render would hand
  // FlashList a fresh array identity each time and make it re-run layout (which discards
  // any scroll position we just restored).
  const mediaLibrary: IMediaLibrary = (mediaFilter === 'movies' || mediaFilter === 'audiobooks') ? EMPTY_LIBRARY : allLibrary;
  const movies: IMediaObject[] = (mediaFilter === 'tv' || mediaFilter === 'audiobooks') ? EMPTY_MOVIES : allMovies;
  // Audiobooks appear on the dedicated Audiobooks page and on Home (all).
  const audiobooks: IMediaAudiobook[] = (mediaFilter === 'all' || mediaFilter === 'audiobooks') ? allAudiobooks : EMPTY_AUDIOBOOKS;

  const [navStack, setNavStack] = useState<NavLevel[]>([]);
  const [pressedKey, setPressedKey] = useState<string | null>(null);

  // Ref to the FlashList so we can programmatically scroll it.
  const flashListRef = useRef<FlashListRef<DisplayItem>>(null);
  // Index of the topmost visible item, tracked without causing re-renders.
  const firstVisibleIndex = useRef(0);
  // Persists the topmost visible index for each nav level, keyed by serialised stack path.
  const savedScrollIndices = useRef<Map<string, number>>(new Map());
  // Latest `displayItems`, so the restore effect can clamp to the current item count
  // without re-running every time the list contents change.
  const displayItemsRef = useRef<DisplayItem[]>([]);

  // Reset navigation and saved positions when viewType changes.
  useEffect(() => {
    savedScrollIndices.current.clear();
    setNavStack([]);
  }, [viewType]);

  const navigateInto = useCallback((entry: NavLevel) => {
    logger.log('MediaBrowserScreen', `Navigate into: ${entry.label} (showName=${entry.showName ?? '-'}, seasonKey=${entry.seasonKey ?? '-'})`);
    clearItemSelection();
    setNavStack((prev: NavLevel[]) => {
      // Save the scroll position for the level we are leaving.
      savedScrollIndices.current.set(navStackKey(prev), firstVisibleIndex.current);
      return [...prev, entry];
    });
  }, [clearItemSelection]);

  const navigateBack = useCallback(() => {
    logger.log('MediaBrowserScreen', 'Navigate back');
    setNavStack((prev: NavLevel[]) => prev.slice(0, -1));
  }, []);

  // After the nav stack changes, scroll to the appropriate position:
  // - going deeper → reset to top
  // - going shallower (back) → restore the saved position for that level
  // Navigation always moves exactly one level at a time (navigateInto pushes one entry,
  // navigateBack pops one entry), so comparing lengths is sufficient to determine direction.
  const prevNavStackLength = useRef(0);
  useEffect(() => {
    const goingDeeper = navStack.length > prevNavStackLength.current;
    prevNavStackLength.current = navStack.length;
    // Restore the index saved for this level. Because it is recorded in navigateInto at
    // the moment the user leaves a level, the stored value always reflects exactly where
    // the user was in that list—it cannot be stale within the same session.
    const saved = goingDeeper ? 0 : (savedScrollIndices.current.get(navStackKey(navStack)) ?? 0);
    // Clamp: the level may hold fewer items than when we left it (e.g. items hidden since).
    const targetIndex = Math.min(saved, Math.max(0, displayItemsRef.current.length - 1));
    firstVisibleIndex.current = targetIndex;
    if (targetIndex === 0) {
      // Offset 0 is always valid regardless of how much has been measured, so this needs
      // none of the retry machinery below.
      flashListRef.current?.scrollToOffset({ offset: 0, animated: false });
      return;
    }
    // Restore by index rather than by pixel offset. A raw scrollToOffset is a single
    // native scrollTo that the underlying ScrollView clamps to the content size measured
    // *so far*; right after a nav-level swap most of the new list is still unmeasured, so
    // a large offset clamps to near the top. scrollToIndex instead steps toward the target
    // and recomputes it as items get measured, which converges on the right row.
    let cancelled = false;
    const rafId = requestAnimationFrame(() => {
      if (cancelled) return;
      flashListRef.current?.scrollToIndex({ index: targetIndex, animated: false })
        .catch((e: unknown) => {
          logger.warn('MediaBrowserScreen', `Failed to restore scroll to index ${targetIndex}`, e);
        });
    });
    return () => {
      cancelled = true;
      cancelAnimationFrame(rafId);
    };
  }, [navStack]);

  // FlashList requires a stable identity here; the refs it writes to keep it dependency-free.
  const handleViewableItemsChanged = useCallback(
    ({ viewableItems }: { viewableItems: ViewToken<DisplayItem>[] }) => {
      let topmost = -1;
      for (const token of viewableItems) {
        if (token.index !== null && token.index !== undefined && (topmost === -1 || token.index < topmost)) {
          topmost = token.index;
        }
      }
      if (topmost !== -1) {
        firstVisibleIndex.current = topmost;
      }
    },
    [],
  );

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
  const isListMode = viewOrientation === 'list';
  // In list mode use a single column; in poster mode use the scale-mapped column count.
  const numColumns = isListMode ? 1 : mapScaleToColumns(viewScale, minColumns, maxColumns);
  const cardWidth = (screenWidth - CARD_GAP * (numColumns + 1)) / numColumns;
  // Poster card uses a 2:3 portrait ratio for posters; video thumbnails may render wider
  // later in PosterBox if they are being shown instead of a portrait poster.
  const thumbnailHeight = Math.round(cardWidth * 3 / 2);
  // List mode row height scales with viewScale (lower scale = taller rows, matching poster behaviour).
  const listRowHeight = mapScaleToListRowHeight(viewScale);

  const displayItems = useMemo(
    () => buildDisplayItems(mediaLibrary, movies, audiobooks, viewType, navStack, mediaOverrides, navigateInto, sortOrder),
    // scanProgress.thumbnailsDone is included so the memo re-runs each time a
    // thumbnail is added to thumbnailCache during the thumbnail generation phase.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [mediaLibrary, movies, audiobooks, viewType, navStack, mediaOverrides, navigateInto, scanProgress.thumbnailsDone, sortOrder],
  );
  // Kept in a ref so the scroll-restore effect can read the current item count without
  // taking displayItems as a dependency (which would re-trigger restores mid-browse).
  displayItemsRef.current = displayItems;

  const hasLibraryContent = Object.keys(mediaLibrary).length > 0 || movies.length > 0 || audiobooks.length > 0;

  // Root label for breadcrumb
  const rootLabel = mediaFilter === 'tv'
    ? (editMode ? '✏️ TV' : 'TV')
    : mediaFilter === 'movies'
      ? (editMode ? '✏️ Movies' : 'Movies')
      : mediaFilter === 'audiobooks'
        ? (editMode ? '✏️ Audiobooks' : 'Audiobooks')
        : (editMode ? '✏️ Home' : 'Home');

  // Build breadcrumb label: "Home / Show / Season 1"
  const breadcrumb = [
    rootLabel,
    ...navStack.map((n: NavLevel) => n.label),
  ].join(' › ');

  /** Records the current time as the `lastOpened` timestamp for a file display item. */
  const recordLastOpened = useCallback((item: DisplayItem & { kind: 'file' }) => {
    const now = Date.now();
    if (item.mediaType === 'episode') {
      dispatch(setEpisodeLastOpened({ path: item.mediaObject.path, lastOpened: now }));
    } else if (item.mediaType === 'movie') {
      dispatch(setMovieLastOpened({ path: item.mediaObject.path, lastOpened: now }));
    } else if (item.mediaType === 'audiobook') {
      const folderKey = item.key.startsWith('audiobook:')
        ? item.key.slice('audiobook:'.length)
        : navStack.find((n) => n.audiobookKey)?.audiobookKey;
      if (folderKey) dispatch(setAudiobookLastOpened({ folderKey, lastOpened: now }));
    }
  }, [dispatch, navStack]);

  /** Open the edit screen for a given display item. */
  const openEditScreen = useCallback((item: DisplayItem) => {
    let itemType: 'show' | 'movie' | 'episode' | 'audiobook';
    let itemKey: string;
    if (item.mediaType === 'audiobook') {
      // Only root audiobook entries (key "audiobook:<folderKey>") are editable;
      // individual part files inside a multi-part audiobook are not.
      if (!item.key.startsWith('audiobook:')) return;
      itemType = 'audiobook';
      itemKey = item.key;
    } else if (item.kind === 'folder' && item.mediaType === 'show') {
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

  /**
   * Returns the namespaced override key for a selectable display item, using the same format
   * as `mediaOverrides`:
   *   "show:<showName>"      – for a TV show folder
   *   "movie:<parsedPath>"   – for a movie file
   *   "episode:<parsedPath>" – for an episode file
   * Returns null for non-selectable items such as season folders.
   */
  const getItemOverrideKey = useCallback((item: DisplayItem): string | null => {
    if (item.kind === 'folder' && item.mediaType === 'show') {
      return `show:${item.key}`;
    }
    // Audiobooks are not selectable in edit mode (no reset/hide/merge support yet).
    if (item.kind === 'file' && item.mediaType !== 'audiobook') {
      return `${item.mediaType}:${item.mediaObject.parsedPath}`;
    }
    return null;
  }, []);

  // Derive the selected show names (without prefix) for the Merge action.
  const selectedShowKeys = useMemo(
    () => (Array.from(selectedItems) as string[]).filter((k) => k.startsWith('show:')).map((k) => k.slice(5)),
    [selectedItems],
  );

  const selectedMoviePaths = useMemo(
    () => (Array.from(selectedItems) as string[]).filter((k) => k.startsWith('movie:')).map((k) => k.slice(6)),
    [selectedItems],
  );

  const selectedEpisodePaths = useMemo(
    () => (Array.from(selectedItems) as string[]).filter((k) => k.startsWith('episode:')).map((k) => k.slice(8)),
    [selectedItems],
  );

  const shouldShowToolbar = editMode && selectedItems.size >= 1;
  const shouldShowMerge = selectedShowKeys.length >= 2;

  const deleteLocalFile = useCallback((uri?: string) => {
    if (!uri) return;
    try {
      const file = new File(uri);
      if (file.exists) {
        file.delete();
      }
    } catch {
      // ignore failures; refresh can still proceed
    }
  }, []);

  const performResetSelectedMetadata = useCallback(async () => {
    const selectedKeys = Array.from(selectedItems);
    if (selectedKeys.length === 0) return;

    const selectedShows = selectedShowKeys;
    const selectedMoviesForRefresh = selectedMoviePaths;
    const selectedEpisodes = selectedEpisodePaths;

    // Clear selected overrides first, then clear metadata state and downloaded files.
    for (const key of selectedKeys) {
      dispatch(clearMediaOverride(key));
    }

    const state = store.getState();
    for (const showName of selectedShows) {
      const show = state.libraryReducer.mediaLibrary[showName];
      if (show?.poster) {
        deleteLocalFile(show.poster);
      }
      for (const season of Object.values(show?.seasons ?? {})) {
        for (const ep of Object.values(season.episodes)) {
          deleteLocalFile(ep.resolvedThumbnail);
        }
      }
      dispatch(clearShowMetadata(showName));
    }

    for (const moviePath of selectedMoviesForRefresh) {
      const movie = state.libraryReducer.movies.find((m: IMediaObject) => m.path === moviePath);
      if (movie?.poster) {
        deleteLocalFile(movie.poster);
      }
      dispatch(clearMovieMetadata(moviePath));
    }

    for (const episodePath of selectedEpisodes) {
      const episode = Object.values(state.libraryReducer.mediaLibrary).flatMap((show) =>
        Object.values(show.seasons).flatMap((season) => Object.values(season.episodes)),
      ).find((ep) => ep.path === episodePath);
      if (episode?.resolvedThumbnail) {
        deleteLocalFile(episode.resolvedThumbnail);
      }
      dispatch(clearEpisodeMetadata(episodePath));
    }

    clearItemSelection();

    // Re-read the refreshed state for the selected subset before metadata enrichment.
    const refreshedState = store.getState();
    const librarySubset: IMediaLibrary = {};
    for (const showName of selectedShows) {
      const show = refreshedState.libraryReducer.mediaLibrary[showName];
      if (show) librarySubset[showName] = show;
    }
    for (const episodePath of selectedEpisodes) {
      const showEntry = Object.entries(refreshedState.libraryReducer.mediaLibrary).find(([, show]) =>
        Object.values(show.seasons).some((season) =>
          Object.values(season.episodes).some((ep) => ep.path === episodePath),
        ),
      );
      if (showEntry) {
        const [showName, show] = showEntry;
        librarySubset[showName] = show;
      }
    }
    const moviesSubset = refreshedState.libraryReducer.movies.filter((movie: IMediaObject) => selectedMoviesForRefresh.includes(movie.parsedPath));

    try {
      await MetadataService.getInstance().enrichAll(librarySubset, moviesSubset);
    } catch (e) {
      logger.warn('MediaBrowserScreen', 'Failed to refresh metadata for selected items', e);
    }
  }, [dispatch, selectedItems, selectedShowKeys, selectedMoviePaths, selectedEpisodePaths, clearItemSelection, deleteLocalFile]);

  const handleResetMetadata = useCallback(() => {
    if (selectedItems.size === 0) return;
    Alert.alert(
      'Reset metadata',
      'This will remove overrides and downloaded metadata for the selected items, then refresh their metadata from the configured provider.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Reset', style: 'destructive', onPress: () => { void performResetSelectedMetadata(); } },
      ],
    );
  }, [selectedItems.size, performResetSelectedMetadata]);

  /**
   * Marks all currently selected items as hidden by setting `hidden: true` in their
   * `mediaOverrides` entry.  No files are deleted; the action is fully reversible by
   * clearing the override (e.g. via Settings → Clear All Overrides).
   */
  const handleHide = useCallback(() => {
    for (const key of selectedItems) {
      dispatch(setMediaOverride({ key, override: { hidden: true } }));
    }
    clearItemSelection();
  }, [selectedItems, dispatch, clearItemSelection]);

  return (
    <View style={styles.container}>
      {mediaSources.length > 0 && hasLibraryContent ? (
        <ThemedView style={styles.listContainer}>
          {/* Scan progress banner – shown at the top of the grid while any scan phase is active */}
          {isScanning && scanProgress.phase !== 'idle' && (
            <View style={styles.scanBanner}>
              <View style={styles.scanBannerRow}>
                <ThemedText style={styles.scanBannerText}>
                  {scanProgress.phase === 'collecting'
                    ? scanProgress.sourcesTotal && scanProgress.sourcesTotal > 1 && scanProgress.currentSourceIndex
                      ? `Scanning library ${scanProgress.currentSourceIndex} of ${scanProgress.sourcesTotal}… (${scanProgress.filesFound} file${scanProgress.filesFound !== 1 ? 's' : ''} found)`
                      : `Scanning… found ${scanProgress.filesFound} file${scanProgress.filesFound !== 1 ? 's' : ''}`
                    : scanProgress.phase === 'thumbnails'
                      ? `Generating thumbnails (${scanProgress.thumbnailsDone} / ${scanProgress.thumbnailsTotal})`
                      : `Fetching metadata… (${scanProgress.metadataDone} / ${scanProgress.metadataTotal})`}
                </ThemedText>
                <TouchableOpacity onPress={handleCancelScan} style={styles.scanCancelButton}>
                  <ThemedText style={styles.scanCancelText}>Stop</ThemedText>
                </TouchableOpacity>
              </View>
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

          {/* Breadcrumb / back navigation – only shown when inside a subfolder */}
          {navStack.length > 0 && (
            <ThemedView style={styles.breadcrumbRow}>
              <TouchableOpacity
                onPress={navigateBack}
                style={[styles.backButton, {
                  borderColor: backButtonBorderColor,
                  backgroundColor: backButtonBackgroundColor,
                }]}
              >
                <ThemedText style={styles.backButtonArrow}>‹</ThemedText>
                <ThemedText style={styles.backButtonText}>Back</ThemedText>
              </TouchableOpacity>
              <ThemedText style={styles.breadcrumb} numberOfLines={1}>
                {breadcrumb}
              </ThemedText>
            </ThemedView>
          )}

          <FlashList
            ref={flashListRef}
            data={displayItems}
            keyExtractor={(item: DisplayItem) => item.key}
            numColumns={numColumns}
            extraData={`${editMode}|${pressedKey ?? ''}|${isListMode}|${Array.from(selectedItems).join(',')}`}
            // v2 enables this by default to reduce feed/chat-style glitches, but it fights
            // our own scroll save/restore below since each nav level swaps in an entirely
            // unrelated item set (not an incremental append/prepend).
            maintainVisibleContentPosition={{ disabled: true }}
            // Tracks which item is at the top of the viewport, so navigating away can
            // record a position that survives the list being re-laid out on return.
            onViewableItemsChanged={handleViewableItemsChanged}
            renderItem={({ item }: { item: DisplayItem }) => {
              const isEditable = (
                item.mediaType === 'show' ||
                item.mediaType === 'movie' ||
                item.mediaType === 'episode' ||
                // Root audiobook entries are editable; part files (key = file path) are not.
                (item.mediaType === 'audiobook' && item.key.startsWith('audiobook:'))
              );
              // Any editable item can be long-pressed in edit mode to select it.
              const overrideKey = getItemOverrideKey(item);
              const isSelected = editMode && overrideKey !== null && selectedItems.has(overrideKey);

              // Folders always navigate; files always open in player.
              let handlePress: () => void;
              if (item.kind === 'folder') {
                handlePress = item.onPress;
              } else {
                handlePress = () => {
                  logger.log('MediaBrowserScreen', `Opening file: ${item.mediaObject.filename} (${item.mediaObject.path})`);
                  recordLastOpened(item);
                  openMediaInExternalApp(item.mediaObject.path, item.mediaObject.filename).catch((e: unknown) => {
                    logger.error('MediaBrowserScreen', `Failed to open file: ${item.mediaObject.path}`, e);
                  });
                };
              }

              // Edit badge callback – lets the user navigate to the edit screen for this item.
              const onEditPress = editMode && isEditable ? () => openEditScreen(item) : undefined;

              if (isListMode) {
                // In edit mode, long press on any selectable item toggles its selection.
                const handleLongPress = editMode && overrideKey !== null
                  ? () => toggleItemSelection(overrideKey)
                  : undefined;
                return (
                  <ListItem
                    kind={item.kind}
                    label={item.label}
                    rowHeight={listRowHeight}
                    editMode={editMode}
                    isEditable={isEditable}
                    isSelected={isSelected}
                    count={item.kind === 'folder' ? item.count : undefined}
                    onPress={handlePress}
                    onLongPress={handleLongPress}
                    onEditPress={onEditPress}
                  />
                );
              }

              // Poster mode
              const hasPoster = !!item.posterUri;
              const hasBothImages = hasPoster && !!item.thumbnailUri;
              const isRevealed = pressedKey === item.key;

              // In edit mode: long press on any selectable item toggles its selection;
              // thumbnail reveal is disabled. Outside edit mode: long press reveals
              // the video thumbnail when a poster is also available.
              const handleLongPress = editMode
                ? (overrideKey !== null ? () => toggleItemSelection(overrideKey) : undefined)
                : hasBothImages
                  ? () => setPressedKey(item.key)
                  : undefined;
              const handlePressOut = editMode
                ? undefined
                : hasBothImages
                  ? () => setPressedKey(null)
                  : undefined;

              return (
                <PosterBox
                  item={item}
                  cardWidth={cardWidth}
                  thumbnailHeight={thumbnailHeight}
                  editMode={editMode}
                  isRevealed={isRevealed}
                  isEditable={isEditable}
                  isSelected={isSelected}
                  onPress={handlePress}
                  onLongPress={handleLongPress}
                  onPressOut={handlePressOut}
                  onEditPress={onEditPress}
                />
              );
            }}
            contentContainerStyle={[
              isListMode ? styles.listContent : styles.gridContent,
              { paddingBottom: shouldShowToolbar ? MERGE_TOOLBAR_HEIGHT + insets.bottom : insets.bottom },
            ]}
          />
          {/* Action toolbar – visible when any items are selected in edit mode */}
          {shouldShowToolbar && (
            <View style={[styles.mergeToolbar, { paddingBottom: MERGE_TOOLBAR_PADDING_VERTICAL + insets.bottom }]}>
              <ThemedText style={styles.mergeToolbarText}>
                {selectedItems.size} selected
              </ThemedText>
              <TouchableOpacity
                style={styles.hideButton}
                onPress={handleHide}
              >
                <ThemedText style={styles.hideButtonText}>Hide</ThemedText>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.resetButton}
                onPress={handleResetMetadata}
              >
                <ThemedText style={styles.resetButtonText}>Reset</ThemedText>
              </TouchableOpacity>
              {shouldShowMerge && (
                <TouchableOpacity
                  style={styles.mergeButton}
                  onPress={() => {
                    router.push({
                      pathname: '/mergeshows',
                      params: { showKeys: JSON.stringify(selectedShowKeys) },
                    });
                  }}
                >
                  <ThemedText style={styles.mergeButtonText}>Merge</ThemedText>
                </TouchableOpacity>
              )}
              <TouchableOpacity
                style={styles.mergeCancelButton}
                onPress={clearItemSelection}
              >
                <ThemedText style={styles.mergeCancelText}>Cancel</ThemedText>
              </TouchableOpacity>
            </View>
          )}
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
              {scanProgress.sourcesTotal && scanProgress.sourcesTotal > 1 && scanProgress.currentSourceIndex
                ? `Scanning library ${scanProgress.currentSourceIndex} of ${scanProgress.sourcesTotal}…`
                : scanProgress.filesFound > 0
                  ? `Found ${scanProgress.filesFound} file${scanProgress.filesFound === 1 ? '' : 's'} so far…`
                  : 'Scanning your library, please wait.'}
            </ThemedText>
          )}
          <TouchableOpacity onPress={handleCancelScan} style={styles.stopScanButton}>
            <ThemedText style={styles.stopScanText}>Stop Scan</ThemedText>
          </TouchableOpacity>
        </ThemedView>
      ) : (
        <ThemedView style={styles.stepContainer}>
          <ThemedText type="subtitle">Problem</ThemedText>
          {mediaSources.length > 0 ? (
            <ThemedText>
              Your library directories are empty or invalid, check them in{' '}
              <Link href="/settings">
                Settings
              </Link>
              .
            </ThemedText>
          ) : (
            <ThemedText>
              You need to set up a library directory in{' '}
              <Link href="/settings">
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
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    paddingHorizontal: 14,
    gap: 4,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.18)',
    backgroundColor: 'rgba(255,255,255,0.08)',
    minHeight: 42,
  },
  backButtonArrow: {
    fontSize: 28,
    fontWeight: '300',
  },
  backButtonText: {
    fontSize: 18,
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
  listContent: {
    paddingVertical: 0,
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
  scanBannerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  scanBannerText: {
    flex: 1,
    fontSize: 12,
    opacity: 0.75,
  },
  scanCancelButton: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: '#E55',
    marginLeft: 8,
  },
  scanCancelText: {
    fontSize: 11,
    color: '#E55',
    fontWeight: '600',
  },
  stopScanButton: {
    alignSelf: 'flex-start',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#E55',
    marginTop: 4,
  },
  stopScanText: {
    fontSize: 13,
    color: '#E55',
    fontWeight: '600',
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
  mergeToolbar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingTop: MERGE_TOOLBAR_PADDING_VERTICAL,
    // paddingBottom is set dynamically via inline style to include the safe-area bottom inset.
    backgroundColor: 'rgba(20,20,20,0.92)',
    gap: 8,
  },
  mergeToolbarText: {
    flex: 1,
    fontSize: 13,
    color: '#fff',
  },
  hideButton: {
    backgroundColor: '#8B0000',
    borderRadius: 8,
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  hideButtonText: {
    color: '#fff',
    fontWeight: '600',
    fontSize: 13,
  },
  resetButton: {
    backgroundColor: '#6a5acd',
    borderRadius: 8,
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  resetButtonText: {
    color: '#fff',
    fontWeight: '600',
    fontSize: 13,
  },
  mergeButton: {
    backgroundColor: '#0a7ea4',
    borderRadius: 8,
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  mergeButtonText: {
    color: '#fff',
    fontWeight: '600',
    fontSize: 13,
  },
  mergeCancelButton: {
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.3)',
  },
  mergeCancelText: {
    color: '#fff',
    fontSize: 13,
  },
});
