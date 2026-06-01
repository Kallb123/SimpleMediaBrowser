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
  updateShowPoster,
  setMoviePoster,
  type dataSources,
} from '@/store/libraryReducer';
import { selectTmdbApiKey, selectTvdbApiKey, selectTvdbPin, selectDataSource } from '@/store/settingsReducer';
import { logger } from '@/scripts/Logger';
import { File, Directory, Paths } from 'expo-file-system';
import { buildTmdbSearchQuery } from '@/scripts/FileScanner';
import { MetadataService } from '@/scripts/MetadataService';
import { TvdbProvider } from '@/scripts/providers/TvdbProvider';
import type { ProviderShowResult } from '@/scripts/providers/IMetadataProvider';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const TMDB_BASE_URL = 'https://api.themoviedb.org/3';
const POSTER_THUMB_URL = 'https://image.tmdb.org/t/p/w185';
const POSTER_FULL_URL = 'https://image.tmdb.org/t/p/w500';
const POSTERS_DIR = new Directory(Paths.document, 'smb_posters');
const POSTERS_TVDB_DIR = new Directory(Paths.document, 'smb_posters_tvdb');
const DIVIDER_COLOR = 'rgba(128,128,128,0.35)';

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

function ensurePostersTvdbDir(): void {
  if (!POSTERS_TVDB_DIR.exists) {
    POSTERS_TVDB_DIR.create({ intermediates: true, idempotent: true });
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
 * Download a TVDB poster image (full URL) to local storage and return the local file URI.
 * Files are stored in smb_posters_tvdb/, separate from TMDB posters.
 */
async function downloadTvdbPoster(tvdbId: string, fullUrl: string): Promise<string> {
  ensurePostersTvdbDir();
  // Include a URL-derived suffix so that different poster selections for the same
  // TVDB ID are cached as separate files instead of colliding on the same key.
  const urlKey = (fullUrl.split('/').pop() ?? 'poster')
    .replace(/\.[^.]+$/, '')
    .replace(/[^a-zA-Z0-9_-]/g, '_');
  const safeName = `${tvdbId.replace(/[^a-zA-Z0-9_-]/g, '_')}_${urlKey}`;
  const localFile = new File(POSTERS_TVDB_DIR, `${safeName}.jpg`);
  if (localFile.exists) {
    return localFile.uri;
  }
  await File.downloadFileAsync(fullUrl, localFile);
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
  const tvdbApiKey = useSelector(selectTvdbApiKey);
  const tvdbPin = useSelector(selectTvdbPin);
  const globalDataSource = useSelector(selectDataSource);
  const insets = useSafeAreaInsets();

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
      return movies.find((m) => m.parsedPath === path)?.poster ?? '';
    }
    return '';
  })();
  const [activePosterUri, setActivePosterUri] = useState<string>(
    existingOverride.poster || currentLibraryPoster || '',
  );

  // Provider picker – defaulting to the item's current resolved provider.
  const resolvedItemProvider: dataSources = (() => {
    if (existingOverride.metadataSourceOverride) return existingOverride.metadataSourceOverride;
    if (itemType === 'show') {
      const showName = itemKey.replace(/^show:/, '');
      return mediaLibrary[showName]?.metadataSource ?? globalDataSource;
    }
    return globalDataSource;
  })();

  // --- Poster Search section state ---
  // posterSearchType lets users browse posters across content types (e.g. pick a
  // TV-show poster image for a movie entry), independently of the item type.
  const [posterProvider, setPosterProvider] = useState<dataSources>(resolvedItemProvider);
  const [posterSearchType, setPosterSearchType] = useState<'tv' | 'movie'>(
    itemType === 'movie' ? 'movie' : 'tv',
  );
  const [posterSearchQuery, setPosterSearchQuery] = useState(existingOverride.title ?? currentTitle ?? '');
  const [posterSearching, setPosterSearching] = useState(false);
  const [posterSearchError, setPosterSearchError] = useState('');
  const [posterResults, setPosterResults] = useState<TmdbResult[]>([]);
  const [posterExpandedId, setPosterExpandedId] = useState<number | null>(null);
  const [posterGalleries, setPosterGalleries] = useState<Record<number, string[]>>({});
  const [posterLoadingGalleryId, setPosterLoadingGalleryId] = useState<number | null>(null);
  const [posterApplying, setPosterApplying] = useState(false);
  const [posterSelectedItem, setPosterSelectedItem] = useState<{ resultId: number; posterPath: string } | null>(null);
  // TVDB poster search state
  const [tvdbPosterResults, setTvdbPosterResults] = useState<ProviderShowResult[]>([]);
  const [tvdbPosterError, setTvdbPosterError] = useState('');
  const [tvdbPosterExpandedId, setTvdbPosterExpandedId] = useState<string | null>(null);
  const [tvdbPosterGalleries, setTvdbPosterGalleries] = useState<Record<string, string[]>>({});
  const [tvdbPosterLoadingId, setTvdbPosterLoadingId] = useState<string | null>(null);
  const [tvdbPosterSelectedItem, setTvdbPosterSelectedItem] = useState<{ showId: string; posterUrl: string } | null>(null);

  // --- Metadata Re-match section state ---
  const [rematchProvider, setRematchProvider] = useState<dataSources>(resolvedItemProvider);
  const [rematchQuery, setRematchQuery] = useState(existingOverride.title ?? currentTitle ?? '');
  const [rematchSearching, setRematchSearching] = useState(false);
  const [rematchError, setRematchError] = useState('');
  const [rematchResults, setRematchResults] = useState<TmdbResult[]>([]);
  const [rematchApplied, setRematchApplied] = useState<number | null>(null);
  const [rematchApplying, setRematchApplying] = useState(false);
  // TVDB re-match state
  const [tvdbRematchResults, setTvdbRematchResults] = useState<ProviderShowResult[]>([]);
  const [tvdbRematchError, setTvdbRematchError] = useState('');
  const [tvdbRematchApplied, setTvdbRematchApplied] = useState<string | null>(null);

  // Browse-locally state
  const [browsingLocally, setBrowsingLocally] = useState(false);

  // Current TMDB ID for this item (override takes priority, then library data).
  const currentTmdbId: string | null = (() => {
    if (existingOverride.tmdbId) return existingOverride.tmdbId;
    if (itemType === 'show') {
      const showName = itemKey.replace(/^show:/, '');
      return mediaLibrary[showName]?.ids.tmdb ?? null;
    } else if (itemType === 'movie') {
      const parsedPath = itemKey.replace(/^movie:/, '');
      return movies.find((m) => m.parsedPath === parsedPath)?.ids.tmdb ?? null;
    }
    return null;
  })();

  // Current TVDB ID for this item (override takes priority, then library data).
  const currentTvdbId: string | null = (() => {
    if (existingOverride.tvdbId) return existingOverride.tvdbId;
    if (itemType === 'show') {
      const showName = itemKey.replace(/^show:/, '');
      return mediaLibrary[showName]?.ids.tvdb ?? null;
    } else if (itemType === 'movie') {
      const parsedPath = itemKey.replace(/^movie:/, '');
      return movies.find((m) => m.parsedPath === parsedPath)?.ids.tvdb ?? null;
    }
    return null;
  })();

  // True while episode metadata is being re-fetched after a rematch.
  const [isRematching, setIsRematching] = useState(false);

  const hasApiKey = (itemType === 'show' || itemType === 'movie') && (!!tmdbApiKey || !!tvdbApiKey);

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
      dispatch(updateShowPoster({ showName, poster: localUri }));
    } else if (itemType === 'movie') {
      const parsedPath = itemKey.replace(/^movie:/, '');
      const movie = movies.find((m) => m.parsedPath === parsedPath);
      if (movie) {
        dispatch(setMoviePoster({ path: movie.path, poster: localUri }));
      }
    }
    // Persist the poster URI in mediaOverrides so it survives rescans.
    dispatch(setMediaOverride({ key: itemKey, override: { poster: localUri } }));
  };

  // ─── Poster Search handlers ─────────────────────────────────────────────────

  const handlePosterSearch = async () => {
    if (posterProvider === 'tvdb') {
      await handleTvdbPosterSearch();
      return;
    }
    if (!tmdbApiKey || !posterSearchQuery.trim()) return;
    setPosterSearching(true);
    setPosterSearchError('');
    setPosterResults([]);
    setTvdbPosterResults([]);
    setPosterExpandedId(null);
    setPosterGalleries({});
    setPosterLoadingGalleryId(null);
    try {
      const tmdbQuery = buildTmdbSearchQuery(posterSearchQuery.trim());
      const url =
        `${TMDB_BASE_URL}/search/${posterSearchType}` +
        `?api_key=${encodeURIComponent(tmdbApiKey)}` +
        `&query=${encodeURIComponent(tmdbQuery)}` +
        `&language=en-US&page=1`;
      logger.log('EditItem', `Poster search: TMDB ${posterSearchType} query="${tmdbQuery}"`);
      const response = await fetch(url);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      setPosterResults(data.results ?? []);
      if ((data.results ?? []).length === 0) setPosterSearchError('No results found.');
    } catch (e) {
      logger.error('EditItem', 'Poster search failed', e);
      setPosterSearchError('Search failed. Check your API key and connection.');
    } finally {
      setPosterSearching(false);
    }
  };

  const handleTvdbPosterSearch = async () => {
    if (!tvdbApiKey || !posterSearchQuery.trim()) return;
    setPosterSearching(true);
    setTvdbPosterError('');
    setTvdbPosterResults([]);
    setPosterResults([]);
    setTvdbPosterExpandedId(null);
    setTvdbPosterGalleries({});
    setTvdbPosterLoadingId(null);
    try {
      const tvdb = new TvdbProvider(tvdbApiKey, tvdbPin ?? undefined);
      await tvdb.authenticate();
      logger.log('EditItem', `Poster search: TVDB query="${posterSearchQuery.trim()}"`);
      const results = await tvdb.searchShow(posterSearchQuery.trim());
      setTvdbPosterResults(results);
      if (results.length === 0) setTvdbPosterError('No results found.');
    } catch (e) {
      logger.error('EditItem', 'TVDB poster search failed', e);
      setTvdbPosterError('Search failed. Check your TVDB API key and connection.');
    } finally {
      setPosterSearching(false);
    }
  };

  /**
   * Toggle the TMDB poster gallery for a search result.
   * First expansion fetches all poster images from the TMDB images endpoint.
   */
  const fetchPosterGallery = async (result: TmdbResult) => {
    if (!tmdbApiKey) return;
    const id = result.id;
    if (posterExpandedId === id) {
      setPosterExpandedId(null);
      return;
    }
    setPosterExpandedId(id);
    if (posterGalleries[id] !== undefined) return;

    setPosterLoadingGalleryId(id);
    try {
      const url =
        `${TMDB_BASE_URL}/${posterSearchType}/${id}/images` +
        `?api_key=${encodeURIComponent(tmdbApiKey)}` +
        `&include_image_language=en,null`;
      logger.log('EditItem', `Fetching TMDB images for ${posterSearchType} ID ${id}`);
      const response = await fetch(url);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      const paths = (data.posters ?? []).map((p: { file_path: string }) => p.file_path) as string[];
      const resolved = paths.length > 0 ? paths : (result.poster_path ? [result.poster_path] : []);
      if (resolved.length > 0) {
        setPosterGalleries((prev) => ({ ...prev, [id]: resolved }));
      }
    } catch (e) {
      logger.warn('EditItem', 'Failed to fetch TMDB poster gallery', e);
      setPosterExpandedId(null);
    } finally {
      setPosterLoadingGalleryId(null);
    }
  };

  /** Expand/collapse the TVDB poster gallery for a search result. */
  const fetchTvdbPosterGallery = async (result: ProviderShowResult) => {
    if (!tvdbApiKey) return;
    const id = result.id;
    if (tvdbPosterExpandedId === id) {
      setTvdbPosterExpandedId(null);
      return;
    }
    setTvdbPosterExpandedId(id);
    if (tvdbPosterGalleries[id] !== undefined) return;

    setTvdbPosterLoadingId(id);
    try {
      const tvdb = new TvdbProvider(tvdbApiKey, tvdbPin ?? undefined);
      await tvdb.authenticate();
      const posters = await tvdb.fetchSeriesPosters(id);
      const resolved = posters.length > 0 ? posters : (result.posterUrl ? [result.posterUrl] : []);
      if (resolved.length > 0) {
        setTvdbPosterGalleries((prev) => ({ ...prev, [id]: resolved }));
      }
    } catch (e) {
      logger.warn('EditItem', 'Failed to fetch TVDB poster gallery', e);
      setTvdbPosterExpandedId(null);
    } finally {
      setTvdbPosterLoadingId(null);
    }
  };

  /** Download a TMDB poster and apply it — poster image only, no metadata ID change. */
  const handleApplyTmdbPoster = async (result: TmdbResult, posterPath: string) => {
    if (!tmdbApiKey) return;
    setPosterApplying(true);
    try {
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
      setPosterSelectedItem({ resultId: result.id, posterPath });
      logger.log('EditItem', `Poster-only applied from TMDB ID ${result.id}, path=${posterPath}`);
    } catch (e) {
      logger.error('EditItem', 'Failed to apply TMDB poster', e);
      setPosterSearchError('Failed to apply poster.');
    } finally {
      setPosterApplying(false);
    }
  };

  /** Download a TVDB poster and apply it — poster image only, no metadata ID change. */
  const handleApplyTvdbPosterOnly = async (result: ProviderShowResult, posterUrl: string) => {
    if (!tvdbApiKey) return;
    setPosterApplying(true);
    try {
      let localPosterUri: string | undefined;
      try {
        localPosterUri = await downloadTvdbPoster(result.id, posterUrl);
      } catch (e) {
        logger.warn('EditItem', 'TVDB poster download failed', e);
      }
      if (localPosterUri) {
        applyPoster(localPosterUri);
      }
      setTvdbPosterSelectedItem({ showId: result.id, posterUrl });
      logger.log('EditItem', `Poster-only applied from TVDB ID ${result.id}`);
    } catch (e) {
      logger.error('EditItem', 'Failed to apply TVDB poster', e);
      setTvdbPosterError('Failed to apply poster.');
    } finally {
      setPosterApplying(false);
    }
  };

  // ─── Metadata Re-match handlers ──────────────────────────────────────────────

  const handleRematchSearch = async () => {
    if (rematchProvider === 'tvdb') {
      await handleTvdbRematchSearch();
      return;
    }
    if (!tmdbApiKey || !rematchQuery.trim()) return;
    setRematchSearching(true);
    setRematchError('');
    setRematchResults([]);
    setTvdbRematchResults([]);
    try {
      const endpoint = itemType === 'movie' ? 'movie' : 'tv';
      const tmdbQuery = buildTmdbSearchQuery(rematchQuery.trim());
      const url =
        `${TMDB_BASE_URL}/search/${endpoint}` +
        `?api_key=${encodeURIComponent(tmdbApiKey)}` +
        `&query=${encodeURIComponent(tmdbQuery)}` +
        `&language=en-US&page=1`;
      logger.log('EditItem', `Rematch search: TMDB ${endpoint} query="${tmdbQuery}"`);
      const response = await fetch(url);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      setRematchResults(data.results ?? []);
      if ((data.results ?? []).length === 0) setRematchError('No results found.');
    } catch (e) {
      logger.error('EditItem', 'Rematch search failed', e);
      setRematchError('Search failed. Check your API key and connection.');
    } finally {
      setRematchSearching(false);
    }
  };

  const handleTvdbRematchSearch = async () => {
    if (!tvdbApiKey || !rematchQuery.trim()) return;
    setRematchSearching(true);
    setTvdbRematchError('');
    setTvdbRematchResults([]);
    setRematchResults([]);
    try {
      const tvdb = new TvdbProvider(tvdbApiKey, tvdbPin ?? undefined);
      await tvdb.authenticate();
      logger.log('EditItem', `Rematch search: TVDB query="${rematchQuery.trim()}"`);
      const results = await tvdb.searchShow(rematchQuery.trim());
      setTvdbRematchResults(results);
      if (results.length === 0) setTvdbRematchError('No results found.');
    } catch (e) {
      logger.error('EditItem', 'TVDB rematch search failed', e);
      setTvdbRematchError('Search failed. Check your TVDB API key and connection.');
    } finally {
      setRematchSearching(false);
    }
  };

  /**
   * Apply a TMDB match — updates the metadata ID, downloads the poster, and
   * re-enriches episodes (for shows).
   */
  const handleApplyTmdbRematch = async (result: TmdbResult) => {
    setRematchApplying(true);
    try {
      const tmdbId = String(result.id);
      const dateStr = result.release_date ?? result.first_air_date ?? '';
      const year = dateStr ? parseInt(dateStr.substring(0, 4), 10) : undefined;

      dispatch(setMediaOverride({ key: itemKey, override: { tmdbId, year } }));

      if (itemType === 'show') {
        const showName = itemKey.replace(/^show:/, '');
        dispatch(updateShowMetadata({ showName, providerId: tmdbId }));
      } else if (itemType === 'movie') {
        const parsedPath = itemKey.replace(/^movie:/, '');
        const movie = movies.find((m) => m.parsedPath === parsedPath);
        if (movie) {
          dispatch(updateMovieMetadata({ path: movie.path, providerId: tmdbId }));
        }
      }

      // Download and apply the poster from the matched result.
      if (result.poster_path) {
        try {
          const cacheKey = result.poster_path.replace(/^\//, '').replace(/\.[^.]+$/, '');
          const localPosterUri = await downloadPoster(cacheKey, result.poster_path);
          applyPoster(localPosterUri);
        } catch (e) {
          logger.warn('EditItem', 'Failed to download poster during TMDB rematch', e);
        }
      }

      setRematchApplied(result.id);
      logger.log('EditItem', `TMDB rematch applied: ID ${tmdbId}, year=${year}`);

      const tmdbIdChanged = tmdbId !== currentTmdbId;
      if (itemType === 'show' && tmdbIdChanged) {
        const showName = itemKey.replace(/^show:/, '');
        logger.log('EditItem', `TMDB ID changed (${currentTmdbId} → ${tmdbId}), re-enriching episodes for "${showName}"`);
        setIsRematching(true);
        try {
          await MetadataService.getInstance().rematchSingleShow(showName, tmdbId, 'tmdb');
        } catch (e) {
          logger.error('EditItem', 'Episode re-enrichment failed after TMDB rematch', e);
        } finally {
          setIsRematching(false);
        }
      }
    } catch (e) {
      logger.error('EditItem', 'Failed to apply TMDB rematch', e);
      setRematchError('Failed to apply rematch.');
    } finally {
      setRematchApplying(false);
    }
  };

  /**
   * Apply a TVDB match — updates the metadata ID, downloads the poster, and
   * re-enriches episodes (for shows).
   */
  const handleApplyTvdbRematch = async (result: ProviderShowResult) => {
    setRematchApplying(true);
    try {
      const tvdbId = result.id;
      const year = result.year > 0 ? result.year : undefined;

      if (itemType === 'show') {
        const showName = itemKey.replace(/^show:/, '');
        dispatch(updateShowMetadata({ showName, providerId: tvdbId, source: 'tvdb' }));
      } else if (itemType === 'movie') {
        const parsedPath = itemKey.replace(/^movie:/, '');
        const movie = movies.find((m) => m.parsedPath === parsedPath);
        if (movie) {
          dispatch(updateMovieMetadata({ path: movie.path, providerId: tvdbId, source: 'tvdb' }));
        }
      }
      dispatch(setMediaOverride({
        key: itemKey,
        override: { tvdbId, year, metadataSourceOverride: 'tvdb' },
      }));

      // Download and apply the poster from the matched result.
      if (result.posterUrl) {
        try {
          const localPosterUri = await downloadTvdbPoster(tvdbId, result.posterUrl);
          applyPoster(localPosterUri);
        } catch (e) {
          logger.warn('EditItem', 'Failed to download poster during TVDB rematch', e);
        }
      }

      setTvdbRematchApplied(result.id);
      logger.log('EditItem', `TVDB rematch applied: ID ${tvdbId}, year=${year}`);

      const tvdbIdChanged = tvdbId !== currentTvdbId;
      if (itemType === 'show' && tvdbIdChanged) {
        const showName = itemKey.replace(/^show:/, '');
        logger.log('EditItem', `TVDB ID changed (${currentTvdbId} → ${tvdbId}), re-enriching episodes for "${showName}"`);
        setIsRematching(true);
        try {
          await MetadataService.getInstance().rematchSingleShow(showName, tvdbId, 'tvdb');
        } catch (e) {
          logger.error('EditItem', 'Episode re-enrichment failed after TVDB rematch', e);
        } finally {
          setIsRematching(false);
        }
      }
    } catch (e) {
      logger.error('EditItem', 'Failed to apply TVDB rematch', e);
      setTvdbRematchError('Failed to apply rematch.');
    } finally {
      setRematchApplying(false);
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
      <ScrollView style={styles.container} contentContainerStyle={[styles.content, { paddingBottom: 16 + insets.bottom }]} keyboardShouldPersistTaps="handled">
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

        {/* Poster Search (shows and movies only, requires API key) */}
        {hasApiKey && (
          <View style={styles.section}>
            <ThemedText type="defaultSemiBold" style={styles.sectionTitle}>
              Poster Search
            </ThemedText>
            <ThemedText style={styles.hint}>
              Search TMDB or TheTVDB and browse poster images. Selecting a poster
              only updates the image — it does not change the metadata match or
              episode data. Use the TMDB content-type toggle to search TV shows
              even for a movie entry (or vice versa).
            </ThemedText>

            {/* Provider picker */}
            {!!(tmdbApiKey && tvdbApiKey) && (
              <View style={styles.providerRow}>
                <TouchableOpacity
                  style={[styles.providerButton, posterProvider === 'tmdb' && styles.providerButtonActive]}
                  onPress={() => setPosterProvider('tmdb')}
                  disabled={posterApplying}
                >
                  <ThemedText style={[styles.providerButtonText, posterProvider === 'tmdb' && styles.providerButtonTextActive]}>TMDB</ThemedText>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.providerButton, posterProvider === 'tvdb' && styles.providerButtonActive]}
                  onPress={() => setPosterProvider('tvdb')}
                  disabled={posterApplying}
                >
                  <ThemedText style={[styles.providerButtonText, posterProvider === 'tvdb' && styles.providerButtonTextActive]}>TheTVDB</ThemedText>
                </TouchableOpacity>
              </View>
            )}

            {/* TMDB content-type toggle */}
            {posterProvider === 'tmdb' && !!tmdbApiKey && (
              <View style={styles.providerRow}>
                <TouchableOpacity
                  style={[styles.typeButton, posterSearchType === 'tv' && styles.typeButtonActive]}
                  onPress={() => setPosterSearchType('tv')}
                  disabled={posterApplying}
                >
                  <ThemedText style={[styles.typeButtonText, posterSearchType === 'tv' && styles.typeButtonTextActive]}>TV Shows</ThemedText>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.typeButton, posterSearchType === 'movie' && styles.typeButtonActive]}
                  onPress={() => setPosterSearchType('movie')}
                  disabled={posterApplying}
                >
                  <ThemedText style={[styles.typeButtonText, posterSearchType === 'movie' && styles.typeButtonTextActive]}>Movies</ThemedText>
                </TouchableOpacity>
              </View>
            )}

            <View style={styles.searchRow}>
              <ThemedTextInput
                value={posterSearchQuery}
                onChangeText={setPosterSearchQuery}
                placeholder={posterProvider === 'tvdb' ? 'Search TheTVDB…' : 'Search TMDB…'}
                style={styles.searchInput}
                onSubmitEditing={handlePosterSearch}
                returnKeyType="search"
              />
              <TouchableOpacity
                style={styles.searchButton}
                onPress={handlePosterSearch}
                disabled={posterSearching || posterApplying}
              >
                <ThemedText style={styles.searchButtonText}>Search</ThemedText>
              </TouchableOpacity>
            </View>

            {posterSearching && <ActivityIndicator style={styles.spinner} />}
            {posterSearchError !== '' && (
              <ThemedText style={styles.errorText}>{posterSearchError}</ThemedText>
            )}
            {tvdbPosterError !== '' && (
              <ThemedText style={styles.errorText}>{tvdbPosterError}</ThemedText>
            )}
            {posterApplying && (
              <ThemedText style={styles.hint}>Applying poster…</ThemedText>
            )}

            {/* TMDB poster results */}
            {posterResults.length > 0 && (
              <FlatList
                data={posterResults}
                keyExtractor={(item) => String(item.id)}
                scrollEnabled={false}
                renderItem={({ item }) => {
                  const title = item.title ?? item.name ?? '';
                  const year = (item.release_date ?? item.first_air_date ?? '').substring(0, 4);
                  const isExpanded = posterExpandedId === item.id;
                  const isLoadingPosters = posterLoadingGalleryId === item.id;
                  const posters: string[] = posterGalleries[item.id] ?? [];
                  const posterCount = isExpanded && !isLoadingPosters ? posters.length : null;
                  return (
                    <View style={styles.resultRow}>
                      <TouchableOpacity
                        style={styles.resultHeader}
                        onPress={() => fetchPosterGallery(item)}
                        disabled={posterApplying}
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
                                  posterSelectedItem?.resultId === item.id &&
                                  posterSelectedItem?.posterPath === posterPath;
                                return (
                                  <TouchableOpacity
                                    onPress={() => handleApplyTmdbPoster(item, posterPath)}
                                    disabled={posterApplying}
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

            {/* TVDB poster results */}
            {tvdbPosterResults.length > 0 && (
              <FlatList
                data={tvdbPosterResults}
                keyExtractor={(item) => item.id}
                scrollEnabled={false}
                renderItem={({ item }) => {
                  const isExpanded = tvdbPosterExpandedId === item.id;
                  const isLoadingPosters = tvdbPosterLoadingId === item.id;
                  const posters: string[] = tvdbPosterGalleries[item.id] ?? [];
                  const posterCount = isExpanded && !isLoadingPosters ? posters.length : null;
                  return (
                    <View style={styles.resultRow}>
                      <TouchableOpacity
                        style={styles.resultHeader}
                        onPress={() => fetchTvdbPosterGallery(item)}
                        disabled={posterApplying}
                      >
                        {item.posterThumbUrl ? (
                          <Image
                            source={{ uri: item.posterThumbUrl }}
                            style={styles.resultPoster}
                            contentFit="cover"
                          />
                        ) : (
                          <View style={[styles.resultPoster, styles.resultPosterPlaceholder]}>
                            <ThemedText style={styles.placeholderIcon}>📺</ThemedText>
                          </View>
                        )}
                        <View style={styles.resultInfo}>
                          <ThemedText style={styles.resultTitle}>{item.title}</ThemedText>
                          {item.year > 0 && (
                            <ThemedText style={styles.resultYear}>{item.year}</ThemedText>
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
                      {isExpanded && (
                        <View style={styles.posterGallery}>
                          {isLoadingPosters ? (
                            <ActivityIndicator style={styles.spinner} />
                          ) : posters.length > 0 ? (
                            <FlatList
                              data={posters}
                              keyExtractor={(url) => url}
                              horizontal
                              showsHorizontalScrollIndicator={false}
                              contentContainerStyle={styles.posterGalleryContent}
                              renderItem={({ item: posterUrl }) => {
                                const isChosen =
                                  tvdbPosterSelectedItem?.showId === item.id &&
                                  tvdbPosterSelectedItem?.posterUrl === posterUrl;
                                return (
                                  <TouchableOpacity
                                    onPress={() => handleApplyTvdbPosterOnly(item, posterUrl)}
                                    disabled={posterApplying}
                                    style={[styles.galleryPosterWrapper, isChosen && styles.galleryPosterWrapperChosen]}
                                  >
                                    <Image
                                      source={{ uri: posterUrl }}
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

        {/* Metadata Re-match (shows and movies only, requires API key) */}
        {hasApiKey && (
          <View style={styles.section}>
            <ThemedText type="defaultSemiBold" style={styles.sectionTitle}>
              Metadata Re-match
            </ThemedText>
            <ThemedText style={styles.hint}>
              Search for this {itemType === 'movie' ? 'movie' : 'show'} and tap a result
              to assign its metadata. The currently matched entry is highlighted.
              {itemType === 'show' ? ' For TV shows, re-matching also re-fetches episode names and thumbnails.' : ''}
              {' '}This does not change the poster.
            </ThemedText>

            {/* Provider picker */}
            {!!(tmdbApiKey && tvdbApiKey) && (
              <View style={styles.providerRow}>
                <TouchableOpacity
                  style={[styles.providerButton, rematchProvider === 'tmdb' && styles.providerButtonActive]}
                  onPress={() => setRematchProvider('tmdb')}
                  disabled={rematchApplying || isRematching}
                >
                  <ThemedText style={[styles.providerButtonText, rematchProvider === 'tmdb' && styles.providerButtonTextActive]}>TMDB</ThemedText>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.providerButton, rematchProvider === 'tvdb' && styles.providerButtonActive]}
                  onPress={() => setRematchProvider('tvdb')}
                  disabled={rematchApplying || isRematching}
                >
                  <ThemedText style={[styles.providerButtonText, rematchProvider === 'tvdb' && styles.providerButtonTextActive]}>TheTVDB</ThemedText>
                </TouchableOpacity>
              </View>
            )}

            {/* Active provider ID badges */}
            <View style={styles.providerBadgeRow}>
              {currentTmdbId && (
                <View style={styles.providerBadge}>
                  <ThemedText style={styles.providerBadgeText}>TMDB ID: {currentTmdbId}</ThemedText>
                </View>
              )}
              {currentTvdbId && (
                <View style={[styles.providerBadge, styles.providerBadgeTvdb]}>
                  <ThemedText style={styles.providerBadgeText}>TVDB ID: {currentTvdbId}</ThemedText>
                </View>
              )}
            </View>

            <View style={styles.searchRow}>
              <ThemedTextInput
                value={rematchQuery}
                onChangeText={setRematchQuery}
                placeholder={rematchProvider === 'tvdb' ? 'Search TheTVDB…' : 'Search TMDB…'}
                style={styles.searchInput}
                onSubmitEditing={handleRematchSearch}
                returnKeyType="search"
              />
              <TouchableOpacity
                style={styles.searchButton}
                onPress={handleRematchSearch}
                disabled={rematchSearching || rematchApplying || isRematching}
              >
                <ThemedText style={styles.searchButtonText}>Search</ThemedText>
              </TouchableOpacity>
            </View>

            {rematchSearching && <ActivityIndicator style={styles.spinner} />}
            {rematchError !== '' && (
              <ThemedText style={styles.errorText}>{rematchError}</ThemedText>
            )}
            {tvdbRematchError !== '' && (
              <ThemedText style={styles.errorText}>{tvdbRematchError}</ThemedText>
            )}
            {rematchApplying && !isRematching && (
              <ThemedText style={styles.hint}>Applying match…</ThemedText>
            )}
            {isRematching && (
              <View style={styles.rematchingRow}>
                <ActivityIndicator size="small" />
                <ThemedText style={styles.hint}>Re-fetching episode data for new match…</ThemedText>
              </View>
            )}

            {/* TMDB re-match results (tap a row to match) */}
            {rematchResults.length > 0 && (
              <FlatList
                data={rematchResults}
                keyExtractor={(item) => String(item.id)}
                scrollEnabled={false}
                renderItem={({ item }) => {
                  const title = item.title ?? item.name ?? '';
                  const year = (item.release_date ?? item.first_air_date ?? '').substring(0, 4);
                  const isCurrentMatch = String(item.id) === currentTmdbId;
                  const isJustMatched = rematchApplied === item.id;
                  const isHighlighted = isCurrentMatch || isJustMatched;
                  return (
                    <TouchableOpacity
                      style={[styles.resultRow, styles.rematchResultRow, isHighlighted && styles.resultRowSelected]}
                      onPress={() => handleApplyTmdbRematch(item)}
                      disabled={rematchApplying || isRematching}
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
                        {isHighlighted ? (
                          <ThemedText style={styles.selectedLabel}>
                            {isJustMatched ? '✔ Matched' : '✔ Current Match'}
                          </ThemedText>
                        ) : (
                          <ThemedText style={styles.rematchActionLabel}>Tap to match</ThemedText>
                        )}
                      </View>
                    </TouchableOpacity>
                  );
                }}
              />
            )}

            {/* TVDB re-match results (tap a row to match) */}
            {tvdbRematchResults.length > 0 && (
              <FlatList
                data={tvdbRematchResults}
                keyExtractor={(item) => item.id}
                scrollEnabled={false}
                renderItem={({ item }) => {
                  const isCurrentMatch = item.id === currentTvdbId;
                  const isJustMatched = tvdbRematchApplied === item.id;
                  const isHighlighted = isCurrentMatch || isJustMatched;
                  return (
                    <TouchableOpacity
                      style={[styles.resultRow, styles.rematchResultRow, isHighlighted && styles.resultRowSelected]}
                      onPress={() => handleApplyTvdbRematch(item)}
                      disabled={rematchApplying || isRematching}
                    >
                      {item.posterThumbUrl ? (
                        <Image
                          source={{ uri: item.posterThumbUrl }}
                          style={styles.resultPoster}
                          contentFit="cover"
                        />
                      ) : (
                        <View style={[styles.resultPoster, styles.resultPosterPlaceholder]}>
                          <ThemedText style={styles.placeholderIcon}>📺</ThemedText>
                        </View>
                      )}
                      <View style={styles.resultInfo}>
                        <ThemedText style={styles.resultTitle}>{item.title}</ThemedText>
                        {item.year > 0 && (
                          <ThemedText style={styles.resultYear}>{item.year}</ThemedText>
                        )}
                        {isHighlighted ? (
                          <ThemedText style={styles.selectedLabel}>
                            {isJustMatched ? '✔ Matched' : '✔ Current Match'}
                          </ThemedText>
                        ) : (
                          <ThemedText style={styles.rematchActionLabel}>Tap to match</ThemedText>
                        )}
                      </View>
                    </TouchableOpacity>
                  );
                }}
              />
            )}
          </View>
        )}

        {!tmdbApiKey && !tvdbApiKey && (itemType === 'show' || itemType === 'movie') && (
          <View style={styles.section}>
            <ThemedText style={styles.hint}>
              Add a TMDB or TVDB API key in Settings to enable poster search and metadata re-matching.
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
  providerRow: {
    flexDirection: 'row',
    gap: 8,
  },
  providerButton: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#0a7ea4',
  },
  providerButtonActive: {
    backgroundColor: '#0a7ea4',
  },
  providerButtonText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#0a7ea4',
  },
  providerButtonTextActive: {
    color: '#fff',
  },
  providerBadgeRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  providerBadge: {
    backgroundColor: 'rgba(10,126,164,0.15)',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
  },
  providerBadgeTvdb: {
    backgroundColor: 'rgba(0,180,120,0.15)',
  },
  providerBadgeText: {
    fontSize: 11,
    fontWeight: '600',
    opacity: 0.8,
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
  rematchResultRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  rematchActionLabel: {
    opacity: 0.5,
    fontSize: 12,
    marginTop: 2,
  },
});
