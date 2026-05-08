import { File, Directory, Paths } from 'expo-file-system';
import { logger } from '@/scripts/Logger';
import { buildTmdbSearchQuery } from '@/scripts/FileScanner';
import type { IMetadataProvider, ProviderShowResult, ProviderMovieResult, ProviderEpisode } from './IMetadataProvider';

const TMDB_BASE_URL = 'https://api.themoviedb.org/3';
const POSTER_FULL_URL = 'https://image.tmdb.org/t/p/w500';
const POSTER_THUMB_URL = 'https://image.tmdb.org/t/p/w185';
const EPISODE_THUMB_BASE_URL = 'https://image.tmdb.org/t/p/w780';

const POSTERS_DIR = new Directory(Paths.document, 'smb_posters');
const EPISODE_THUMBS_DIR = new Directory(Paths.document, 'smb_thumbnails_tmdb');

/** Milliseconds to wait between successive TMDB API requests. */
const REQUEST_DELAY_MS = 150;

function delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function extractYearFromDate(dateString?: string): number {
    return dateString ? parseInt(dateString.substring(0, 4), 10) : 0;
}

async function ensureDir(dir: Directory): Promise<void> {
    if (!dir.exists) {
        dir.create({ intermediates: true, idempotent: true });
    }
}

/**
 * Metadata provider backed by The Movie Database (TMDB) v3 API.
 * Handles shows, movies, and episode metadata including posters and stills.
 */
export class TmdbProvider implements IMetadataProvider {
    readonly source = 'tmdb' as const;

    constructor(private readonly apiKey: string) {}

    async searchShow(name: string, year?: number): Promise<ProviderShowResult[]> {
        try {
            const url =
                `${TMDB_BASE_URL}/search/tv` +
                `?api_key=${encodeURIComponent(this.apiKey)}` +
                `&query=${encodeURIComponent(buildTmdbSearchQuery(name))}` +
                `&language=en-US&page=1`;
            const response = await fetch(url);
            await delay(REQUEST_DELAY_MS);
            if (!response.ok) {
                logger.warn('TmdbProvider', `TV search failed for "${name}": HTTP ${response.status}`);
                return [];
            }
            const data = await response.json();
            const results: Array<{
                id: number;
                name?: string;
                poster_path: string | null;
                first_air_date?: string;
            }> = data.results ?? [];
            return results.map((r) => ({
                id: String(r.id),
                title: r.name ?? name,
                year: extractYearFromDate(r.first_air_date),
                posterUrl: r.poster_path ? POSTER_FULL_URL + r.poster_path : null,
                posterThumbUrl: r.poster_path ? POSTER_THUMB_URL + r.poster_path : null,
            }));
        } catch (e) {
            logger.warn('TmdbProvider', `searchShow error for "${name}"`, e);
            return [];
        }
    }

    async searchMovie(title: string, year?: number): Promise<ProviderMovieResult[]> {
        try {
            const url =
                `${TMDB_BASE_URL}/search/movie` +
                `?api_key=${encodeURIComponent(this.apiKey)}` +
                `&query=${encodeURIComponent(buildTmdbSearchQuery(title))}` +
                `&language=en-US&page=1`;
            const response = await fetch(url);
            await delay(REQUEST_DELAY_MS);
            if (!response.ok) {
                logger.warn('TmdbProvider', `Movie search failed for "${title}": HTTP ${response.status}`);
                return [];
            }
            const data = await response.json();
            const results: Array<{
                id: number;
                title?: string;
                poster_path: string | null;
                release_date?: string;
            }> = data.results ?? [];
            return results.map((r) => ({
                id: String(r.id),
                title: r.title ?? title,
                year: extractYearFromDate(r.release_date),
                posterUrl: r.poster_path ? POSTER_FULL_URL + r.poster_path : null,
                posterThumbUrl: r.poster_path ? POSTER_THUMB_URL + r.poster_path : null,
            }));
        } catch (e) {
            logger.warn('TmdbProvider', `searchMovie error for "${title}"`, e);
            return [];
        }
    }

    async downloadShowPoster(providerId: string, posterUrl: string): Promise<string> {
        return this._downloadPoster(providerId, posterUrl, POSTERS_DIR);
    }

    async downloadMoviePoster(providerId: string, posterUrl: string): Promise<string> {
        return this._downloadPoster(providerId, posterUrl, POSTERS_DIR);
    }

    private async _downloadPoster(id: string, url: string, dir: Directory): Promise<string> {
        await ensureDir(dir);
        const safeName = id.replace(/[^a-zA-Z0-9_-]/g, '_');
        const localFile = new File(dir, `${safeName}.jpg`);
        if (localFile.exists) {
            logger.log('TmdbProvider', `Poster already cached for TMDB ID ${id}`);
            return localFile.uri;
        }
        logger.log('TmdbProvider', `Downloading poster: ${url} → ${localFile.uri}`);
        await File.downloadFileAsync(url, localFile);
        return localFile.uri;
    }

    async fetchSeasonEpisodes(showProviderId: string, seasonNumber: number): Promise<ProviderEpisode[]> {
        try {
            const url =
                `${TMDB_BASE_URL}/tv/${encodeURIComponent(showProviderId)}/season/${seasonNumber}` +
                `?api_key=${encodeURIComponent(this.apiKey)}&language=en-US`;
            const response = await fetch(url);
            await delay(REQUEST_DELAY_MS);
            if (!response.ok) {
                logger.warn('TmdbProvider', `Season fetch failed for TMDB ID ${showProviderId} S${seasonNumber}: HTTP ${response.status}`);
                return [];
            }
            const data = await response.json();
            const episodes: Array<{
                episode_number: number;
                name?: string;
                still_path: string | null;
            }> = data.episodes ?? [];
            return episodes.map((ep) => ({
                episodeNumber: ep.episode_number,
                title: ep.name,
                stillUrl: ep.still_path ? EPISODE_THUMB_BASE_URL + ep.still_path : null,
            }));
        } catch (e) {
            logger.warn('TmdbProvider', `fetchSeasonEpisodes error for TMDB ID ${showProviderId} S${seasonNumber}`, e);
            return [];
        }
    }

    async downloadEpisodeThumbnail(key: string, stillUrl: string): Promise<string> {
        await ensureDir(EPISODE_THUMBS_DIR);
        const safeName = key.replace(/[^a-zA-Z0-9_-]/g, '_');
        const localFile = new File(EPISODE_THUMBS_DIR, `${safeName}.jpg`);
        if (localFile.exists) {
            logger.log('TmdbProvider', `Episode thumbnail already cached for key ${key}`);
            return localFile.uri;
        }
        logger.log('TmdbProvider', `Downloading episode thumbnail: ${stillUrl} → ${localFile.uri}`);
        await File.downloadFileAsync(stillUrl, localFile);
        return localFile.uri;
    }

    /**
     * Fetch all poster image paths for a specific TMDB show or movie.
     * Used by the edit-item rematch screen to display a poster gallery.
     * @param id       TMDB numeric ID.
     * @param type     'tv' for shows, 'movie' for movies.
     * @returns Array of full-URL poster strings.
     */
    async fetchAllPosters(id: string, type: 'tv' | 'movie'): Promise<string[]> {
        try {
            const url =
                `${TMDB_BASE_URL}/${type}/${encodeURIComponent(id)}/images` +
                `?api_key=${encodeURIComponent(this.apiKey)}` +
                `&include_image_language=en,null`;
            const response = await fetch(url);
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const data = await response.json();
            return (data.posters ?? []).map(
                (p: { file_path: string }) => POSTER_THUMB_URL + p.file_path,
            ) as string[];
        } catch (e) {
            logger.warn('TmdbProvider', `fetchAllPosters error for TMDB ID ${id}`, e);
            return [];
        }
    }

    /** Builds the full-resolution download URL from a TMDB poster path (e.g. "/abc.jpg"). */
    static posterDownloadUrl(posterPath: string): string {
        return POSTER_FULL_URL + posterPath;
    }

    /** Builds the thumbnail display URL from a TMDB poster path (e.g. "/abc.jpg"). */
    static posterThumbUrl(posterPath: string): string {
        return POSTER_THUMB_URL + posterPath;
    }
}
