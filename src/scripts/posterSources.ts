import { File, Directory, Paths } from 'expo-file-system';
import { logger } from '@/scripts/Logger';
import { buildTmdbSearchQuery } from '@/scripts/libraryUtils';
import type { dataSources } from '@/scripts/libraryUtils';
import { TvdbProvider } from '@/scripts/providers/TvdbProvider';

/**
 * TMDB/TVDB search, poster-gallery and poster-download helpers used by the
 * Edit Item screens. Both providers are normalised to `ProviderSearchResult`
 * so UI code never branches on the provider shape. Must not import the store.
 */

const TMDB_BASE_URL = 'https://api.themoviedb.org/3';
const POSTER_THUMB_URL = 'https://image.tmdb.org/t/p/w185';
const POSTER_FULL_URL = 'https://image.tmdb.org/t/p/w500';
// These directories are cleared elsewhere (e.g. cache clearing) — keep names stable.
const POSTERS_DIR = new Directory(Paths.document, 'smb_posters');
const POSTERS_TVDB_DIR = new Directory(Paths.document, 'smb_posters_tvdb');

export type TmdbSearchType = 'tv' | 'movie';

export interface ProviderCredentials {
  tmdbApiKey: string | null | undefined;
  tvdbApiKey: string | null | undefined;
  tvdbPin: string | null | undefined;
}

export interface ProviderSearchResult {
  provider: dataSources;
  /** TMDB numeric id as a string, or the TVDB id. */
  id: string;
  title: string;
  /** Undefined when unknown. */
  year?: number;
  /** Thumbnail for list rows. */
  thumbUrl: string | null;
  /** What `downloadProviderPoster` takes: TMDB poster_path, or the full TVDB URL. */
  posterRef: string | null;
}

export interface GalleryPoster {
  /** Same meaning as `ProviderSearchResult.posterRef`. */
  ref: string;
  thumbUrl: string;
}

interface TmdbSearchItem {
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

/** Whether the API key needed to talk to `provider` is configured. */
export function hasProviderKey(provider: dataSources, creds: ProviderCredentials): boolean {
  return provider === 'tvdb' ? !!creds.tvdbApiKey : !!creds.tmdbApiKey;
}

async function createTvdbProvider(creds: ProviderCredentials): Promise<TvdbProvider> {
  if (!creds.tvdbApiKey) throw new Error('TVDB API key is not set');
  const tvdb = new TvdbProvider(creds.tvdbApiKey, creds.tvdbPin ?? undefined);
  await tvdb.authenticate();
  return tvdb;
}

function requireTmdbKey(creds: ProviderCredentials): string {
  if (!creds.tmdbApiKey) throw new Error('TMDB API key is not set');
  return creds.tmdbApiKey;
}

function tmdbYear(item: TmdbSearchItem): number | undefined {
  const dateStr = item.release_date ?? item.first_air_date ?? '';
  const year = dateStr ? parseInt(dateStr.substring(0, 4), 10) : NaN;
  return Number.isFinite(year) && year > 0 ? year : undefined;
}

/**
 * Search `provider` for `query`. TMDB searches `tmdbType` (tv/movie); TVDB
 * ignores it and always searches shows. Throws on HTTP/auth failure; returns
 * an empty array when nothing matches.
 */
export async function searchProvider(
  provider: dataSources,
  query: string,
  tmdbType: TmdbSearchType,
  creds: ProviderCredentials,
): Promise<ProviderSearchResult[]> {
  if (provider === 'tvdb') {
    const tvdb = await createTvdbProvider(creds);
    logger.log('EditItem', `Poster search: TVDB query="${query}"`);
    const results = await tvdb.searchShow(query);
    return results.map((r) => ({
      provider: 'tvdb',
      id: r.id,
      title: r.title,
      year: r.year > 0 ? r.year : undefined,
      thumbUrl: r.posterThumbUrl,
      posterRef: r.posterUrl,
    }));
  }

  const apiKey = requireTmdbKey(creds);
  const tmdbQuery = buildTmdbSearchQuery(query);
  const url =
    `${TMDB_BASE_URL}/search/${tmdbType}` +
    `?api_key=${encodeURIComponent(apiKey)}` +
    `&query=${encodeURIComponent(tmdbQuery)}` +
    `&language=en-US&page=1`;
  logger.log('EditItem', `Poster search: TMDB ${tmdbType} query="${tmdbQuery}"`);
  const response = await fetch(url);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const data = await response.json();
  const items: TmdbSearchItem[] = data.results ?? [];
  return items.map((item) => ({
    provider: 'tmdb',
    id: String(item.id),
    title: item.title ?? item.name ?? '',
    year: tmdbYear(item),
    thumbUrl: item.poster_path ? POSTER_THUMB_URL + item.poster_path : null,
    posterRef: item.poster_path,
  }));
}

/**
 * Fetch every poster image the provider has for `result`. Falls back to the
 * result's own poster when the provider returns none. Throws on failure.
 */
export async function fetchPosterGallery(
  result: ProviderSearchResult,
  tmdbType: TmdbSearchType,
  creds: ProviderCredentials,
): Promise<GalleryPoster[]> {
  if (result.provider === 'tvdb') {
    const tvdb = await createTvdbProvider(creds);
    const posters = await tvdb.fetchSeriesPosters(result.id);
    const resolved = posters.length > 0 ? posters : (result.posterRef ? [result.posterRef] : []);
    return resolved.map((url) => ({ ref: url, thumbUrl: url }));
  }

  const apiKey = requireTmdbKey(creds);
  const url =
    `${TMDB_BASE_URL}/${tmdbType}/${result.id}/images` +
    `?api_key=${encodeURIComponent(apiKey)}` +
    `&include_image_language=en,null`;
  logger.log('EditItem', `Fetching TMDB images for ${tmdbType} ID ${result.id}`);
  const response = await fetch(url);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const data = await response.json();
  const paths = (data.posters ?? []).map((p: { file_path: string }) => p.file_path) as string[];
  const resolved = paths.length > 0 ? paths : (result.posterRef ? [result.posterRef] : []);
  return resolved.map((ref) => ({ ref, thumbUrl: POSTER_THUMB_URL + ref }));
}

/**
 * Download a provider poster into the local cache and return its file:// URI.
 * `posterRef` is a TMDB poster_path or a full TVDB URL (see `ProviderSearchResult`).
 */
export async function downloadProviderPoster(
  provider: dataSources,
  resultId: string,
  posterRef: string,
): Promise<string> {
  if (provider === 'tvdb') {
    return downloadTvdbPoster(resultId, posterRef);
  }
  const cacheKey = posterRef.replace(/^\//, '').replace(/\.[^.]+$/, '');
  return downloadPoster(cacheKey, posterRef);
}

/**
 * Copy a locally picked image (file:// or content:// URI) into the app's
 * persistent smb_posters directory and return the local file:// URI.
 */
export async function copyPickedPoster(sourceUri: string, key: string): Promise<string> {
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
