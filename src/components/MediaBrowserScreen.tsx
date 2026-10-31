import { Alert, Modal, StyleSheet, TouchableOpacity, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { openMediaInExternalApp } from '@/scripts/openMedia';
import { ThemedText } from '@/components/ThemedText';
import { ThemedView } from '@/components/ThemedView';
import { File } from 'expo-file-system';
import { Image } from 'expo-image';
import type { VideoThumbnail } from 'expo-video';
import { Link, Stack, router } from 'expo-router';
import { useRoute } from '@react-navigation/native';
import { useEffect, useMemo, useCallback, useState } from 'react';
import { useSelector, useDispatch } from 'react-redux';
import { selectMediaSources, selectMediaStructure, selectViewScale, selectViewOrientation, selectSortOrder, selectAudiobookPlayer, selectVideoPlayer, selectPersonalLayout } from '@/store/settingsReducer';
import { clearEpisodeMetadata, clearMovieMetadata, clearPersonalMetadata, clearMediaOverride, clearShowMetadata, setMediaOverride, markWatched, markUnwatched, getShowWatchKeys, getSeasonWatchKeys, getAudiobookWatchKeys, setEpisodeLastOpened, setMovieLastOpened, setPersonalLastOpened, setAudiobookLastOpened, getShowLastOpened, getSeasonLastOpened, getShowFirstDetected, getSeasonFirstDetected, selectMediaLibrary, selectMovies, selectAudiobooks, selectPersonal, selectPersonalFolderPosters, selectMediaOverrides } from '@/store/libraryReducer';
import { selectIsScanning, selectScanProgress } from '@/store/scanReducer';
import { store } from '@/store/store';
import { FlashList } from '@shopify/flash-list';
import { FileScanner } from '@/scripts/FileScanner';
import { AudiobookPlayer } from '@/scripts/AudiobookPlayer';
import { showDisplayLabel, episodeDisplayLabel, movieDisplayLabel } from '@/scripts/mediaLabels';
import { resumePosition } from '@/scripts/videoProgress';
import { formatClock } from '@/utils/formatClock';
import { thumbnailCache } from '@/scripts/thumbnailCache';
import { useThumbnailVersion } from '@/hooks/useThumbnailVersion';
import { useGridImageHeight } from '@/hooks/useGridImageHeight';
import { audioPartFiles } from '@/scripts/libraryUtils';
import { personalDisplayTitle, personalOverrideKey, personalWatchKeys } from '@/scripts/personalLibrary';
import type { IPersonalVideo } from '@/scripts/personalLibrary';
import { personalBrowseLevel, personalSortKey } from '@/scripts/personalBrowse';
import type { IMediaObject } from '@/scripts/libraryUtils';
import type { IMediaLibrary, IMediaAudiobook, IMediaOverride } from '@/store/libraryReducer';
import type { viewTypes, sortOrders, personalLayouts } from '@/store/settingsReducer';
import type { EditItemType } from '@/hooks/useEditTarget';
import { logger } from '@/scripts/Logger';
import { useEditMode } from '@/contexts/EditModeContext';
import { PosterBox } from '@/components/ui/PosterBox';
import { ListItem } from '@/components/ui/ListItem';
import { LANDSCAPE_MAX_COLUMNS, LANDSCAPE_MIN_COLUMNS, PORTRAIT_MAX_COLUMNS, PORTRAIT_MIN_COLUMNS, VIEW_SCALE_MAX, VIEW_SCALE_MIN, mapScaleToColumns } from '@/utils/viewScale';

// ── Navigation types ─────────────────────────────────────────────────────────

/** One folder level of the browser hierarchy (a show, a season, a multi-part audiobook, or a Personal folder). */
export type NavLevel = {
  label: string;
  showName?: string;
  seasonKey?: string;
  /** Set when navigating into a multi-part audiobook to list its files. */
  audiobookKey?: string;
  /** Set when navigating into a Personal folder: its folder key (`folderPath.join('/')`). */
  personalFolder?: string;
};

type ThumbnailSource = VideoThumbnail | string;

type DisplayItem =
  | { kind: 'folder'; label: string; sortKey?: string; lastOpened?: number; firstDetected?: number; key: string; thumbnailUri?: ThumbnailSource; posterUri?: string; onPress: () => void; mediaType: 'show' | 'season' | 'audiobook' | 'personalFolder'; count?: number; /** What `count` counts, singular (default "episode"). */ countNoun?: string; /** Watch keys of the files below this folder (resolved lazily; drives its tick and bulk toggle). */ watchKeys: () => readonly string[]; /** The audiobook a root multi-part entry stands for (drives its progress bar). */ audiobook?: IMediaAudiobook }
  | { kind: 'file'; label: string; sortKey?: string; lastOpened?: number; firstDetected?: number; key: string; thumbnailUri?: ThumbnailSource; posterUri?: string; mediaObject: IMediaObject; mediaType: 'movie' | 'episode' | 'audiobook' | 'personal'; /** Secondary line under the label (a Personal video's channel). */ subtitle?: string; /** 1-based position in `audioPartFiles` of an audiobook part row (absent on a root single-file book). */ partNumber?: number; /** The audiobook this file belongs to (set for every audiobook file; the in-app player and progress bar use it). */ audiobook?: IMediaAudiobook };

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
      const files = audioPartFiles(audiobook.files);
      if (files.length > 1) {
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
          count: files.length,
          watchKeys: () => getAudiobookWatchKeys(audiobook),
          audiobook,
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
        mediaObject: makeAudiobookFileObject(files[0] ?? { path: audiobook.path, parsedPath: audiobook.path, filename: audiobook.title }),
        mediaType: 'audiobook' as const,
        audiobook,
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
  location: NavLevel | undefined,
  overrides: { [key: string]: IMediaOverride },
  navigateInto: (entry: NavLevel) => void,
  sortOrder: sortOrders,
): DisplayItem[] {
  // Inside a multi-part audiobook: list its files as openable items.
  if (location?.audiobookKey) {
    const audiobook = audiobooks.find((a) => a.folderKey === location.audiobookKey);
    if (!audiobook) return [];
    return audioPartFiles(audiobook.files).map((file, index) => ({
      kind: 'file' as const,
      label: file.filename.replace(/\.[^.]+$/, '').replace(/[\._]+/g, ' ').trim() || file.filename,
      key: file.path,
      mediaObject: makeAudiobookFileObject(file),
      mediaType: 'audiobook' as const,
      partNumber: index + 1,
      audiobook,
    }));
  }

  const baseItems = buildBaseDisplayItems(library, movies, viewType, location, overrides, navigateInto, sortOrder);

  // Audiobooks only appear at the root level (they have no viewType hierarchy).
  if (!location && audiobooks.length > 0) {
    const audiobookItems = buildAudiobookRootItems(audiobooks, overrides, navigateInto);
    return applySortOrder([...baseItems, ...audiobookItems], sortOrder);
  }
  return baseItems;
}

function buildBaseDisplayItems(
  library: IMediaLibrary,
  movies: IMediaObject[],
  viewType: viewTypes,
  location: NavLevel | undefined,
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
      if (!location) {
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
              watchKeys: () => getShowWatchKeys(show, overrides),
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
      const show = library[location.showName!];
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
      if (!location) {
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
              watchKeys: () => getSeasonWatchKeys(season, overrides),
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
      const { showName, seasonKey } = location;
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
      if (!location) {
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
            watchKeys: () => getShowWatchKeys(library[showName], overrides),
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
      if (!location.seasonKey) {
        // Inside a show: one folder per season
        const show = library[location.showName!];
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
              posterUri: overrides[`show:${location.showName!}`]?.poster || show.poster || undefined,
              thumbnailUri: firstEpThumb,
              onPress: () =>
                navigateInto({
                  label,
                  showName: location.showName,
                  seasonKey,
                }),
              mediaType: 'season' as const,
              count: Object.keys(season.episodes).length,
              watchKeys: () => getSeasonWatchKeys(season, overrides),
            };
          });
      }
      // Inside a season: episodes
      const season = library[location.showName!]?.seasons[location.seasonKey];
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

/**
 * Display items for the Personal section: in the folders layout the child folders and videos at
 * the location's folder, in the flat layout every video. Sorted together by the "Sorting"
 * appearance setting, like shows and movies at the library root.
 */
function buildPersonalDisplayItems(
  personal: IPersonalVideo[],
  folderPosters: { [folderKey: string]: string },
  layout: personalLayouts,
  location: NavLevel | undefined,
  overrides: { [key: string]: IMediaOverride },
  navigateInto: (entry: NavLevel) => void,
  sortOrder: sortOrders,
): DisplayItem[] {
  const level = personalBrowseLevel(personal, layout, location?.personalFolder, overrides);
  const folderItems: DisplayItem[] = level.folders.map((folder) => {
    // The folder's own image (folder.jpg etc.) wins; otherwise borrow the first video's.
    let posterUri: string | undefined = folderPosters[folder.folderKey] || undefined;
    let thumbnailUri: ThumbnailSource | undefined;
    for (const video of folder.videos) {
      posterUri ??= overrides[personalOverrideKey(video.parsedPath)]?.poster || video.poster || undefined;
      thumbnailUri ??= thumbnailCache.get(video.path);
      if (posterUri && thumbnailUri) break;
    }
    return {
      kind: 'folder' as const,
      label: folder.name,
      lastOpened: folder.lastOpened,
      firstDetected: folder.firstDetected,
      key: `personalFolder:${folder.folderKey}`,
      posterUri,
      thumbnailUri,
      onPress: () => navigateInto({ label: folder.name, personalFolder: folder.folderKey }),
      mediaType: 'personalFolder' as const,
      count: folder.videos.length,
      countNoun: 'video',
      watchKeys: () => personalWatchKeys(folder.videos, '', overrides),
    };
  });
  const videoItems: DisplayItem[] = level.videos.map((video) => ({
    kind: 'file' as const,
    label: personalDisplayTitle(video, overrides),
    sortKey: personalSortKey(video, overrides),
    subtitle: video.channel || undefined,
    lastOpened: video.lastOpened,
    firstDetected: video.firstDetected,
    key: video.path,
    thumbnailUri: thumbnailCache.get(video.path),
    posterUri: overrides[personalOverrideKey(video.parsedPath)]?.poster || video.poster || undefined,
    mediaObject: video,
    mediaType: 'personal' as const,
  }));
  return applySortOrder([...folderItems, ...videoItems], sortOrder);
}

// ── Screen ───────────────────────────────────────────────────────────────────

/** Stable empty collections, so filtered-out media types keep a constant identity across
 *  renders instead of handing the `displayItems` memo a fresh `{}`/`[]` every time. */
const EMPTY_LIBRARY: IMediaLibrary = {};
const EMPTY_MOVIES: IMediaObject[] = [];
const EMPTY_AUDIOBOOKS: IMediaAudiobook[] = [];
const EMPTY_PERSONAL: IPersonalVideo[] = [];
const EMPTY_SELECTION: Set<string> = new Set();
const EMPTY_GRID_IMAGES: (ThumbnailSource | undefined)[] = [];

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

export type MediaFilter = 'all' | 'tv' | 'movies' | 'audiobooks' | 'personal';

/** A folder screen's place in the hierarchy: the level it shows plus its header title
 *  (the labels of every level above it, e.g. "Show › Season 1"). */
export type BrowseLocation = NavLevel & { title: string };

/** The `folder` route of each media section's stack (see `src/app/(drawer)/<section>/`). */
const FOLDER_ROUTES = {
  all: '/folder',
  tv: '/tv/folder',
  movies: '/movies/folder',
  audiobooks: '/audiobooks/folder',
  personal: '/personal/folder',
} as const satisfies Record<MediaFilter, string>;

interface MediaBrowserScreenProps {
  mediaFilter: MediaFilter;
  /** The folder being shown; omitted for the section's root screen. */
  location?: BrowseLocation;
}

/**
 * One level of a media section. Each folder level is its own screen in the section's
 * native stack, so the levels above it stay mounted underneath (scroll position intact)
 * and back navigation is handled by the navigator.
 */
export function MediaBrowserScreen({ mediaFilter, location }: MediaBrowserScreenProps) {
  const mediaSources = useSelector(selectMediaSources);
  const viewType = useSelector(selectMediaStructure);
  const viewScale = useSelector(selectViewScale);
  const viewOrientation = useSelector(selectViewOrientation);
  const sortOrder = useSelector(selectSortOrder);
  const audiobookPlayer = useSelector(selectAudiobookPlayer);
  const videoPlayer = useSelector(selectVideoPlayer);
  const allLibrary = useSelector(selectMediaLibrary);
  const allMovies = useSelector(selectMovies);
  const allAudiobooks = useSelector(selectAudiobooks);
  const allPersonal = useSelector(selectPersonal);
  const personalFolderPosters = useSelector(selectPersonalFolderPosters);
  const personalLayout = useSelector(selectPersonalLayout);
  const mediaOverrides = useSelector(selectMediaOverrides);

  const dispatch = useDispatch();
  const { editMode, selectedItems: contextSelection, selectionOwner, toggleItemSelection: toggleOwnedSelection, clearItemSelection: clearOwnedSelection } = useEditMode();
  // The edit-mode selection is app-wide but belongs to the screen that made it. Every folder
  // level stays mounted under the one on top, so each level must treat a selection owned by
  // another route as empty, or a parent would show (and act on) items picked in a child.
  const routeKey = useRoute().key;
  const selectedItems = selectionOwner === routeKey ? contextSelection : EMPTY_SELECTION;
  const toggleItemSelection = useCallback((key: string) => toggleOwnedSelection(key, routeKey), [toggleOwnedSelection, routeKey]);
  const clearItemSelection = useCallback(() => clearOwnedSelection(routeKey), [clearOwnedSelection, routeKey]);
  // Drop our selection when this screen is popped so it can't linger for an unmounted owner.
  useEffect(() => () => clearOwnedSelection(routeKey), [clearOwnedSelection, routeKey]);
  const { width: screenWidth, height: screenHeight } = useWindowDimensions();
  const insets = useSafeAreaInsets();

  const isScanning = useSelector(selectIsScanning);
  const scanProgress = useSelector(selectScanProgress);
  const thumbnailVersion = useThumbnailVersion();

  const handleCancelScan = useCallback(() => {
    FileScanner.getInstance().cancelScan();
  }, []);

  // Shows/movies/audiobooks whose source was unreachable during the last scan (e.g. a
  // disconnected storage device) are kept in Redux with their metadata intact but marked
  // `unavailable`, so they must be excluded here rather than deleted. Preserve identity
  // when nothing is unavailable so this doesn't churn the memos below on every render.
  const visibleLibrary: IMediaLibrary = useMemo(() => {
    const hiddenNames = Object.keys(allLibrary).filter((name) => allLibrary[name].unavailable);
    if (hiddenNames.length === 0) return allLibrary;
    const filtered: IMediaLibrary = { ...allLibrary };
    for (const name of hiddenNames) delete filtered[name];
    return filtered;
  }, [allLibrary]);
  const visibleMovies: IMediaObject[] = useMemo(
    () => (allMovies.some((m) => m.unavailable) ? allMovies.filter((m) => !m.unavailable) : allMovies),
    [allMovies],
  );
  const visibleAudiobooks: IMediaAudiobook[] = useMemo(
    () => (allAudiobooks.some((a) => a.unavailable) ? allAudiobooks.filter((a) => !a.unavailable) : allAudiobooks),
    [allAudiobooks],
  );

  // Apply filter. These are memoised because they feed the `displayItems` memo, which in
  // turn is FlashList's `data`: rebuilding the empty literals on every render would hand
  // FlashList a fresh array identity each time and make it re-run layout (which discards
  // any scroll position we just restored).
  const mediaLibrary: IMediaLibrary = (mediaFilter === 'movies' || mediaFilter === 'audiobooks' || mediaFilter === 'personal') ? EMPTY_LIBRARY : visibleLibrary;
  const movies: IMediaObject[] = (mediaFilter === 'tv' || mediaFilter === 'audiobooks' || mediaFilter === 'personal') ? EMPTY_MOVIES : visibleMovies;
  // Audiobooks appear on the dedicated Audiobooks page and on the Library (all) page.
  const audiobooks: IMediaAudiobook[] = (mediaFilter === 'all' || mediaFilter === 'audiobooks') ? visibleAudiobooks : EMPTY_AUDIOBOOKS;
  // Personal videos appear only on the Personal page, never on the Library (all) page. The
  // unavailable/hidden ones are filtered when the display items are built.
  const personal: IPersonalVideo[] = mediaFilter === 'personal' ? allPersonal : EMPTY_PERSONAL;

  const [pressedKey, setPressedKey] = useState<string | null>(null);

  const navigateInto = useCallback((entry: NavLevel) => {
    logger.log('MediaBrowserScreen', `Navigate into: ${entry.label} (showName=${entry.showName ?? '-'}, seasonKey=${entry.seasonKey ?? '-'})`);
    clearItemSelection();
    // Route params are strings, so leave unset fields out rather than passing undefined.
    const params: Record<string, string> = {
      label: entry.label,
      title: location ? `${location.title} › ${entry.label}` : entry.label,
    };
    if (entry.showName !== undefined) params.showName = entry.showName;
    if (entry.seasonKey !== undefined) params.seasonKey = entry.seasonKey;
    if (entry.audiobookKey !== undefined) params.audiobookKey = entry.audiobookKey;
    if (entry.personalFolder !== undefined) params.personalFolder = entry.personalFolder;
    router.push({ pathname: FOLDER_ROUTES[mediaFilter], params });
  }, [clearItemSelection, location, mediaFilter]);

  // Map viewScale (1-10) to number of grid columns based on current orientation.
  const isLandscape = screenWidth > screenHeight;
  const minColumns = isLandscape ? LANDSCAPE_MIN_COLUMNS : PORTRAIT_MIN_COLUMNS;
  const maxColumns = isLandscape ? LANDSCAPE_MAX_COLUMNS : PORTRAIT_MAX_COLUMNS;
  const isListMode = viewOrientation === 'list';
  // In list mode use a single column; in poster mode use the scale-mapped column count.
  const numColumns = isListMode ? 1 : mapScaleToColumns(viewScale, minColumns, maxColumns);
  const cardWidth = (screenWidth - CARD_GAP * (numColumns + 1)) / numColumns;
  // List mode row height scales with viewScale (lower scale = taller rows, matching poster behaviour).
  const listRowHeight = mapScaleToListRowHeight(viewScale);

  const displayItems = useMemo(
    () => mediaFilter === 'personal'
      ? buildPersonalDisplayItems(personal, personalFolderPosters, personalLayout, location, mediaOverrides, navigateInto, sortOrder)
      : buildDisplayItems(mediaLibrary, movies, audiobooks, viewType, location, mediaOverrides, navigateInto, sortOrder),
    // thumbnailVersion changes (rate-limited) when thumbnailCache gains or loses entries.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [mediaFilter, mediaLibrary, movies, audiobooks, personal, personalFolderPosters, personalLayout, viewType, location, mediaOverrides, navigateInto, thumbnailVersion, sortOrder],
  );

  // Poster cells share one image box height: the tallest image this view shows (a portrait
  // poster gives the classic 2:3 box; a view of only landscape stills or square covers gets
  // shorter cells). Each cell's image is the one PosterBox shows: the poster, else the thumbnail.
  const gridImages = useMemo(
    () => (isListMode ? EMPTY_GRID_IMAGES : displayItems.map((item) => item.posterUri || item.thumbnailUri)),
    [isListMode, displayItems],
  );
  const thumbnailHeight = useGridImageHeight(cardWidth, gridImages);

  const hasLibraryContent = Object.keys(mediaLibrary).length > 0 || movies.length > 0 || audiobooks.length > 0 || personal.length > 0;
  const hasPersonalSource = mediaSources.some((source) => source.contentType === 'personal');

  // Header title: the section name at the root, otherwise the path below it ("Show › Season 1").
  const sectionTitle = mediaFilter === 'tv'
    ? 'TV'
    : mediaFilter === 'movies'
      ? 'Movies'
      : mediaFilter === 'audiobooks'
        ? 'Audiobooks'
        : mediaFilter === 'personal'
          ? 'Personal'
          : 'Library';
  const headerTitle = `${editMode ? '✏️ ' : ''}${location?.title ?? sectionTitle}`;

  /** Records the current time as the `lastOpened` timestamp for a file display item. */
  const recordLastOpened = useCallback((item: DisplayItem & { kind: 'file' }) => {
    const now = Date.now();
    if (item.mediaType === 'episode') {
      dispatch(setEpisodeLastOpened({ path: item.mediaObject.path, lastOpened: now }));
    } else if (item.mediaType === 'movie') {
      dispatch(setMovieLastOpened({ path: item.mediaObject.path, lastOpened: now }));
    } else if (item.mediaType === 'personal') {
      dispatch(setPersonalLastOpened({ path: item.mediaObject.path, lastOpened: now }));
    } else if (item.mediaType === 'audiobook') {
      const folderKey = item.key.startsWith('audiobook:')
        ? item.key.slice('audiobook:'.length)
        : location?.audiobookKey;
      if (folderKey) dispatch(setAudiobookLastOpened({ folderKey, lastOpened: now }));
    }
  }, [dispatch, location]);

  /**
   * Marks a file watched/listened because it was just handed to the external player.
   * Returns whether it was already marked, so a failed hand-off can undo only its own mark.
   */
  const recordWatched = useCallback((parsedPath: string): boolean => {
    const watchedBefore = store.getState().libraryReducer.watched[parsedPath] !== undefined;
    dispatch(markWatched({ keys: [parsedPath], watchedAt: Date.now() }));
    return watchedBefore;
  }, [dispatch]);

  /**
   * Plays an audiobook in the in-app player and opens it. The player resumes where the book was
   * left off (or the tapped part, if that is where it was) and marks parts listened as they finish,
   * so unlike the external hand-off nothing is ticked here. It also records the book as last opened.
   */
  const playAudiobookInApp = useCallback((audiobook: IMediaAudiobook, partNumber: number | undefined) => {
    logger.log('MediaBrowserScreen', `Playing audiobook in-app: ${audiobook.folderKey}${partNumber !== undefined ? ` part ${partNumber}` : ''}`);
    AudiobookPlayer.getInstance()
      .play(audiobook, partNumber !== undefined ? partNumber - 1 : undefined)
      .catch((e: unknown) => logger.error('MediaBrowserScreen', `Failed to play audiobook: ${audiobook.folderKey}`, e));
    router.push('/player');
  }, []);

  /**
   * Plays a movie, episode or Personal video in the in-app video player and opens it. Unlike the external hand-off
   * nothing is ticked here: the player marks it watched once it gets near the end. With a saved resume
   * point it asks first whether to continue from there. It also records the file as last opened.
   */
  const playVideoInApp = useCallback((item: DisplayItem & { kind: 'file' }) => {
    const { path, parsedPath, filename } = item.mediaObject;
    recordLastOpened(item);
    const resumeAt = resumePosition(store.getState().libraryReducer.watchProgress[parsedPath]);
    const play = (startAt: number) => {
      logger.log('MediaBrowserScreen', `Playing video in-app: ${filename} (${path}) from ${Math.round(startAt)}s`);
      router.push({ pathname: '/videoplayer', params: { parsedPath, startAt: String(startAt) } });
    };
    if (resumeAt > 0) {
      Alert.alert(
        item.label,
        `Resume from ${formatClock(resumeAt)}?`,
        [
          { text: 'Start over', onPress: () => play(0) },
          { text: 'Resume', onPress: () => play(resumeAt) },
        ],
        { cancelable: true },
      );
    } else {
      play(0);
    }
  }, [recordLastOpened]);

  /** Manual watched toggle (edit mode): sets or clears every file the badge stands for in one dispatch. */
  const handleToggleWatched = useCallback((keys: readonly string[], watched: boolean) => {
    const list = [...keys];
    dispatch(watched ? markWatched({ keys: list, watchedAt: Date.now() }) : markUnwatched(list));
  }, [dispatch]);

  /** Open the edit screen for a given display item. */
  const openEditScreen = useCallback((item: DisplayItem) => {
    let itemType: EditItemType;
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
      itemType = item.mediaType === 'movie' ? 'movie' : item.mediaType === 'personal' ? 'personal' : 'episode';
      itemKey = `${item.mediaType}:${item.mediaObject.parsedPath}`;
    } else {
      // Season and Personal folders are not editable
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
   *   "personal:<parsedPath>" – for a Personal video
   * Returns null for non-selectable items such as season and Personal folders.
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

  const selectedPersonalPaths = useMemo(
    () => (Array.from(selectedItems) as string[]).filter((k) => k.startsWith('personal:')).map((k) => k.slice(9)),
    [selectedItems],
  );

  const selectedEpisodePaths = useMemo(
    () => (Array.from(selectedItems) as string[]).filter((k) => k.startsWith('episode:')).map((k) => k.slice(8)),
    [selectedItems],
  );

  const shouldShowToolbar = editMode && selectedItems.size >= 1;
  const shouldShowMerge = selectedShowKeys.length >= 2;

  // Overflow menu for the selection toolbar's less-common bulk actions.
  const [selectionMenuOpen, setSelectionMenuOpen] = useState(false);
  const closeSelectionMenu = useCallback(() => setSelectionMenuOpen(false), []);
  const runSelectionMenuAction = useCallback((action: () => void) => {
    setSelectionMenuOpen(false);
    action();
  }, []);
  // The menu belongs to the toolbar, so it must not outlive it (e.g. when the selection is
  // cleared by an action or by leaving edit mode).
  useEffect(() => {
    if (!shouldShowToolbar) setSelectionMenuOpen(false);
  }, [shouldShowToolbar]);

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

  /**
   * Resolves the current selection to the concrete library objects it refers to.
   * Selection keys carry `parsedPath` (the decoded URI) while Redux entries and the
   * thumbnail cache are keyed by `path` (the raw SAF URI), so the objects have to be
   * looked up rather than the key suffix used directly.
   */
  const resolveSelection = useCallback(() => {
    const state = store.getState();
    const library = state.libraryReducer.mediaLibrary;
    const shows = selectedShowKeys.filter((showName) => library[showName]);
    const movies = (state.libraryReducer.movies as IMediaObject[])
      .filter((movie) => selectedMoviePaths.includes(movie.parsedPath));
    const personalVideos = (state.libraryReducer.personal as IPersonalVideo[] | undefined ?? [])
      .filter((video) => selectedPersonalPaths.includes(video.parsedPath));
    const episodes = Object.values(library)
      .flatMap((show) => Object.values(show.seasons).flatMap((season) => Object.values(season.episodes)))
      .filter((ep) => selectedEpisodePaths.includes(ep.parsedPath));
    // Selecting a show implicitly selects its episodes for per-file actions (thumbnails).
    const episodesOfSelectedShows = shows.flatMap((showName) =>
      Object.values(library[showName].seasons).flatMap((season) => Object.values(season.episodes)),
    );
    return { shows, movies, personalVideos, episodes, episodesOfSelectedShows };
  }, [selectedShowKeys, selectedMoviePaths, selectedPersonalPaths, selectedEpisodePaths]);

  /**
   * Clears cached provider metadata for the given selection — the poster/still URIs in
   * Redux plus the downloaded files behind them — so the next enrichment pass refetches
   * them instead of skipping them as already cached.
   *
   * `alsoClearOverrides` additionally drops the user's own edits, which is what Reset
   * does; a plain force-refetch leaves overrides in place so they keep winning over
   * provider data.
   */
  const clearSelectedMetadata = useCallback((
    selection: ReturnType<typeof resolveSelection>,
    alsoClearOverrides: boolean,
  ) => {
    if (alsoClearOverrides) {
      for (const key of selectedItems) {
        dispatch(clearMediaOverride(key));
      }
    }

    const state = store.getState();
    for (const showName of selection.shows) {
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

    for (const movie of selection.movies) {
      deleteLocalFile(movie.poster);
      dispatch(clearMovieMetadata(movie.path));
    }

    for (const video of selection.personalVideos) {
      deleteLocalFile(video.poster);
      dispatch(clearPersonalMetadata(video.path));
    }

    for (const episode of selection.episodes) {
      deleteLocalFile(episode.resolvedThumbnail);
      dispatch(clearEpisodeMetadata(episode.path));
    }
  }, [dispatch, selectedItems, deleteLocalFile]);

  /**
   * Refreshed posters and thumbnails are written back to the same file URIs they had
   * before (both filenames are derived deterministically from the item), so expo-image
   * would keep serving the pre-refresh bitmaps from its in-memory cache. Dropping that
   * cache forces the visible images to be re-read from disk.
   */
  const clearImageMemoryCache = useCallback(() => {
    Image.clearMemoryCache().catch((e: unknown) => {
      logger.warn('MediaBrowserScreen', 'Failed to clear the image memory cache', e);
    });
  }, []);

  /**
   * Clears the selection's cached provider metadata and refetches it from the configured
   * provider.  `alsoClearOverrides` is what separates Reset (drop the user's own edits
   * too) from Force fetch metadata (keep them).
   */
  const refetchSelectedMetadata = useCallback(async (alsoClearOverrides: boolean) => {
    const selection = resolveSelection();
    clearSelectedMetadata(selection, alsoClearOverrides);
    clearItemSelection();
    try {
      await FileScanner.getInstance().refetchMetadataFor(
        selection.shows,
        selection.movies.map((movie) => movie.parsedPath),
        selection.personalVideos.map((video) => video.path),
      );
    } catch (e) {
      logger.warn('MediaBrowserScreen', 'Failed to refresh metadata for selected items', e);
    } finally {
      clearImageMemoryCache();
    }
  }, [resolveSelection, clearSelectedMetadata, clearItemSelection, clearImageMemoryCache]);

  /** Force-regenerates video thumbnails for every media file covered by the selection. */
  const regenerateSelectedThumbnails = useCallback(async () => {
    const selection = resolveSelection();
    // Deduplicate by path so an episode that is both selected itself and covered by its
    // selected show is only regenerated once.
    const byPath = new Map<string, { path: string; filename: string }>();
    for (const media of [...selection.movies, ...selection.personalVideos, ...selection.episodes, ...selection.episodesOfSelectedShows]) {
      byPath.set(media.path, { path: media.path, filename: media.filename });
    }
    clearItemSelection();
    try {
      await FileScanner.getInstance().regenerateThumbnailsFor(Array.from(byPath.values()));
    } catch (e) {
      logger.warn('MediaBrowserScreen', 'Failed to regenerate thumbnails for selected items', e);
    } finally {
      clearImageMemoryCache();
    }
  }, [resolveSelection, clearItemSelection, clearImageMemoryCache]);

  /**
   * Returns true (after telling the user) when a scan or refresh is already running.
   * The bulk actions drive the same progress banner and cancel flag, so they must not
   * overlap with an in-flight scan.
   */
  const warnIfBusy = useCallback(() => {
    if (!isScanning) return false;
    Alert.alert('Library busy', 'A scan or metadata refresh is already running. Wait for it to finish and try again.');
    return true;
  }, [isScanning]);

  const handleResetMetadata = useCallback(() => {
    if (selectedItems.size === 0 || warnIfBusy()) return;
    Alert.alert(
      'Reset metadata',
      'This will remove overrides and downloaded metadata for the selected items, then refresh their metadata from the configured provider.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Reset', style: 'destructive', onPress: () => { void refetchSelectedMetadata(true); } },
      ],
    );
  }, [selectedItems.size, refetchSelectedMetadata, warnIfBusy]);

  const handleForceFetchMetadata = useCallback(() => {
    if (selectedItems.size === 0 || warnIfBusy()) return;
    Alert.alert(
      'Fetch metadata',
      'This will discard the downloaded posters and episode data for the selected items and fetch them again from the configured provider. Your own edits are kept.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Fetch', onPress: () => { void refetchSelectedMetadata(false); } },
      ],
    );
  }, [selectedItems.size, refetchSelectedMetadata, warnIfBusy]);

  const handleForceGenerateThumbnails = useCallback(() => {
    if (selectedItems.size === 0 || warnIfBusy()) return;
    Alert.alert(
      'Generate thumbnails',
      'This will discard the cached video thumbnails for the selected items and generate them again. This can take a while for a large selection.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Generate', onPress: () => { void regenerateSelectedThumbnails(); } },
      ],
    );
  }, [selectedItems.size, regenerateSelectedThumbnails, warnIfBusy]);

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
      <Stack.Screen options={{ title: headerTitle }} />
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

          <FlashList
            data={displayItems}
            keyExtractor={(item: DisplayItem) => item.key}
            numColumns={numColumns}
            extraData={`${editMode}|${pressedKey ?? ''}|${isListMode}|${audiobookPlayer}|${videoPlayer}|${Array.from(selectedItems).join(',')}`}
            renderItem={({ item }: { item: DisplayItem }) => {
              const isEditable = (
                item.mediaType === 'show' ||
                item.mediaType === 'movie' ||
                item.mediaType === 'episode' ||
                item.mediaType === 'personal' ||
                // Root audiobook entries are editable; part files (key = file path) are not.
                (item.mediaType === 'audiobook' && item.key.startsWith('audiobook:'))
              );
              // Any editable item can be long-pressed in edit mode to select it.
              const overrideKey = getItemOverrideKey(item);
              const isSelected = editMode && overrideKey !== null && selectedItems.has(overrideKey);
              const toggleSelection = editMode && overrideKey !== null
                ? () => toggleItemSelection(overrideKey)
                : undefined;

              // Outside a selection: folders navigate, files open in the player. Once the
              // first item has been long-pressed, a plain tap toggles selection instead, so
              // building up a multi-selection doesn't need a long press per item. The
              // trade-off is that a selectable folder can't be entered while a selection is
              // active — clear the selection first (or tap a season folder, which is not
              // selectable and so still navigates).
              let handlePress: () => void;
              if (toggleSelection && selectedItems.size > 0) {
                handlePress = toggleSelection;
              } else if (item.kind === 'folder') {
                handlePress = item.onPress;
              } else if (item.mediaType === 'audiobook' && item.audiobook && audiobookPlayer === 'inapp') {
                const { audiobook, partNumber } = item;
                handlePress = () => playAudiobookInApp(audiobook, partNumber);
              } else if ((item.mediaType === 'movie' || item.mediaType === 'episode' || item.mediaType === 'personal') && videoPlayer === 'inapp') {
                handlePress = () => playVideoInApp(item);
              } else {
                handlePress = () => {
                  logger.log('MediaBrowserScreen', `Opening file: ${item.mediaObject.filename} (${item.mediaObject.path})`);
                  recordLastOpened(item);
                  const watchedBefore = recordWatched(item.mediaObject.parsedPath);
                  openMediaInExternalApp(item.mediaObject.path, item.mediaObject.filename).catch((e: unknown) => {
                    logger.error('MediaBrowserScreen', `Failed to open file: ${item.mediaObject.path}`, e);
                    // The hand-off never happened, so don't leave a tick the user didn't earn.
                    if (!watchedBefore) dispatch(markUnwatched([item.mediaObject.parsedPath]));
                  });
                };
              }

              // Edit badge callback – lets the user navigate to the edit screen for this item.
              const onEditPress = editMode && isEditable ? () => openEditScreen(item) : undefined;

              if (isListMode) {
                return (
                  <ListItem
                    kind={item.kind}
                    label={item.label}
                    rowHeight={listRowHeight}
                    editMode={editMode}
                    isEditable={isEditable}
                    isSelected={isSelected}
                    count={item.kind === 'folder' ? item.count : undefined}
                    countNoun={item.kind === 'folder' ? item.countNoun : undefined}
                    subtitle={item.kind === 'file' ? item.subtitle : undefined}
                    partNumber={item.kind === 'file' ? item.partNumber : undefined}
                    watchKey={item.kind === 'file' ? item.mediaObject.parsedPath : undefined}
                    watchKeys={item.kind === 'folder' ? item.watchKeys : undefined}
                    audiobook={item.audiobook}
                    audiobookPartPath={item.kind === 'file' && item.partNumber !== undefined ? item.mediaObject.parsedPath : undefined}
                    onToggleWatched={handleToggleWatched}
                    onPress={handlePress}
                    onLongPress={toggleSelection}
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
                ? toggleSelection
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
                  watchKey={item.kind === 'file' ? item.mediaObject.parsedPath : undefined}
                  watchKeys={item.kind === 'folder' ? item.watchKeys : undefined}
                  audiobook={item.audiobook}
                  audiobookPartPath={item.kind === 'file' && item.partNumber !== undefined ? item.mediaObject.parsedPath : undefined}
                  onToggleWatched={handleToggleWatched}
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
                style={styles.moreButton}
                onPress={() => setSelectionMenuOpen(true)}
                accessibilityLabel="More actions for the selected items"
              >
                <ThemedText style={styles.moreButtonText}>More</ThemedText>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.mergeCancelButton}
                onPress={clearItemSelection}
              >
                <ThemedText style={styles.mergeCancelText}>Cancel</ThemedText>
              </TouchableOpacity>
            </View>
          )}
          {/* Overflow menu for the bulk actions that don't fit in the toolbar. Rendered in a
              Modal so it draws above the list and dismisses on an outside tap. */}
          <Modal
            visible={selectionMenuOpen}
            transparent
            animationType="fade"
            onRequestClose={closeSelectionMenu}
          >
            <TouchableOpacity
              style={styles.selectionMenuBackdrop}
              activeOpacity={1}
              onPress={closeSelectionMenu}
            >
              <View style={[styles.selectionMenu, { marginBottom: MERGE_TOOLBAR_HEIGHT + insets.bottom }]}>
                <TouchableOpacity
                  style={styles.selectionMenuItem}
                  onPress={() => runSelectionMenuAction(handleForceFetchMetadata)}
                >
                  <ThemedText style={styles.selectionMenuItemText}>Fetch metadata</ThemedText>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.selectionMenuItem}
                  onPress={() => runSelectionMenuAction(handleForceGenerateThumbnails)}
                >
                  <ThemedText style={styles.selectionMenuItemText}>Generate thumbnails</ThemedText>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.selectionMenuItemLast}
                  onPress={() => runSelectionMenuAction(handleResetMetadata)}
                >
                  <ThemedText style={[styles.selectionMenuItemText, styles.selectionMenuItemDestructiveText]}>
                    Reset metadata
                  </ThemedText>
                </TouchableOpacity>
              </View>
            </TouchableOpacity>
          </Modal>
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
          {mediaFilter === 'personal' && !hasPersonalSource ? (
            <ThemedText>
              No Personal folders have been added yet. Add one with the Personal type in{' '}
              <Link href="/settings">
                Settings
              </Link>
              .
            </ThemedText>
          ) : mediaSources.length > 0 ? (
            <ThemedText>
              {mediaFilter === 'personal' ? 'Your Personal folders are empty or invalid, check them in' : 'Your library directories are empty or invalid, check them in'}{' '}
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
  moreButton: {
    backgroundColor: '#6a5acd',
    borderRadius: 8,
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  moreButtonText: {
    color: '#fff',
    fontWeight: '600',
    fontSize: 13,
  },
  selectionMenuBackdrop: {
    flex: 1,
    justifyContent: 'flex-end',
    alignItems: 'flex-end',
    backgroundColor: 'rgba(0,0,0,0.35)',
  },
  selectionMenu: {
    // marginBottom is set inline so the menu sits directly above the selection toolbar.
    marginRight: 12,
    minWidth: 200,
    borderRadius: 10,
    overflow: 'hidden',
    backgroundColor: 'rgba(28,28,28,0.98)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.2)',
  },
  selectionMenuItem: {
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(255,255,255,0.15)',
  },
  selectionMenuItemLast: {
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  selectionMenuItemText: {
    color: '#fff',
    fontSize: 14,
  },
  selectionMenuItemDestructiveText: {
    color: '#ff8a80',
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
