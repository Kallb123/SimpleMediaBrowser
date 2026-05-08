import { File, Directory, Paths } from 'expo-file-system';
import { logger } from '@/scripts/Logger';
import type { IMetadataProvider, ProviderShowResult, ProviderMovieResult, ProviderEpisode } from './IMetadataProvider';

const TVDB_BASE_URL = 'https://api4.thetvdb.com/v4';

/** Directory for TVDB poster files — separate from TMDB posters. */
const POSTERS_DIR = new Directory(Paths.document, 'smb_posters_tvdb');
/** Directory for TVDB episode thumbnail files — separate from TMDB thumbnails. */
const EPISODE_THUMBS_DIR = new Directory(Paths.document, 'smb_thumbnails_tvdb');

/** Milliseconds to wait between successive TVDB API requests. */
const REQUEST_DELAY_MS = 200;

function delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

async function ensureDir(dir: Directory): Promise<void> {
    if (!dir.exists) {
        dir.create({ intermediates: true, idempotent: true });
    }
}

interface TvdbLoginResponse {
    status: string;
    data?: { token?: string };
}

interface TvdbSearchResult {
    objectID?: string;
    tvdb_id?: string | number;
    name?: string;
    translations?: { eng?: string };
    first_air_time?: string;
    year?: string;
    image_url?: string;
    thumbnail?: string;
    overviews?: Record<string, string>;
}

interface TvdbArtwork {
    id: number;
    image: string;
    thumbnail: string;
    type: number;
    score: number;
}

interface TvdbEpisode {
    id: number;
    name?: string;
    image?: string | null;
    number: number;
    seasonNumber: number;
}

/**
 * Metadata provider backed by TheTVDB v4 API.
 *
 * Authentication uses a short-lived JWT that is cached in memory and refreshed
 * automatically on 401 responses.  TVDB does not have a well-supported movie
 * search endpoint, so `searchMovie` always returns an empty array (the caller
 * will fall back to TMDB for movies).
 */
export class TvdbProvider implements IMetadataProvider {
    readonly source = 'tvdb' as const;

    private token: string | null = null;

    constructor(
        private readonly apiKey: string,
        private readonly pin?: string,
    ) {}

    // ─── Authentication ───────────────────────────────────────────────────────

    /** Obtain (or refresh) the authentication token. */
    async authenticate(): Promise<void> {
        try {
            const body: Record<string, string> = { apikey: this.apiKey };
            if (this.pin) body.pin = this.pin;
            const response = await fetch(`${TVDB_BASE_URL}/login`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
            });
            if (!response.ok) {
                logger.warn('TvdbProvider', `Login failed: HTTP ${response.status}`);
                this.token = null;
                return;
            }
            const data: TvdbLoginResponse = await response.json();
            this.token = data.data?.token ?? null;
            if (this.token) {
                logger.log('TvdbProvider', 'Authentication successful');
            } else {
                logger.warn('TvdbProvider', 'Login response did not include a token');
            }
        } catch (e) {
            logger.warn('TvdbProvider', 'Authentication error', e);
            this.token = null;
        }
    }

    /** Build headers including the Bearer token. Re-authenticates if token is missing. */
    private async authHeaders(): Promise<Record<string, string>> {
        if (!this.token) {
            await this.authenticate();
        }
        return this.token
            ? { Authorization: `Bearer ${this.token}` }
            : {};
    }

    /**
     * Perform an authenticated GET request.  Automatically re-authenticates
     * once on 401 and retries the request.
     */
    private async fetchAuthed(url: string): Promise<Response> {
        const headers = await this.authHeaders();
        let response = await fetch(url, { headers });
        if (response.status === 401) {
            logger.log('TvdbProvider', 'Token expired – re-authenticating');
            await this.authenticate();
            const refreshedHeaders = await this.authHeaders();
            response = await fetch(url, { headers: refreshedHeaders });
        }
        return response;
    }

    // ─── IMetadataProvider ────────────────────────────────────────────────────

    async searchShow(name: string, year?: number): Promise<ProviderShowResult[]> {
        try {
            const url =
                `${TVDB_BASE_URL}/search` +
                `?query=${encodeURIComponent(name)}` +
                `&type=series` +
                `&limit=10`;
            const response = await this.fetchAuthed(url);
            await delay(REQUEST_DELAY_MS);
            if (!response.ok) {
                logger.warn('TvdbProvider', `Show search failed for "${name}": HTTP ${response.status}`);
                return [];
            }
            const data = await response.json();
            const results: TvdbSearchResult[] = data.data ?? [];
            return results
                .filter((r) => r.tvdb_id !== undefined || r.objectID !== undefined)
                .map((r) => {
                    const id = String(r.tvdb_id ?? r.objectID ?? '');
                    const title = r.name ?? r.translations?.eng ?? name;
                    const rawYear = r.year ?? r.first_air_time?.substring(0, 4) ?? '';
                    const resultYear = rawYear ? parseInt(rawYear, 10) : 0;
                    return {
                        id,
                        title,
                        year: resultYear,
                        posterUrl: r.image_url ?? null,
                        posterThumbUrl: r.thumbnail ?? r.image_url ?? null,
                    };
                });
        } catch (e) {
            logger.warn('TvdbProvider', `searchShow error for "${name}"`, e);
            return [];
        }
    }

    /**
     * TVDB does not have a reliable movie search endpoint in v4.
     * Always returns an empty array; callers should fall back to TMDB for movies.
     */
    async searchMovie(_title: string, _year?: number): Promise<ProviderMovieResult[]> {
        return [];
    }

    async downloadShowPoster(providerId: string, posterUrl: string): Promise<string> {
        return this._downloadImage(providerId, posterUrl, POSTERS_DIR);
    }

    async downloadMoviePoster(providerId: string, posterUrl: string): Promise<string> {
        return this._downloadImage(providerId, posterUrl, POSTERS_DIR);
    }

    private async _downloadImage(id: string, url: string, dir: Directory): Promise<string> {
        await ensureDir(dir);
        const safeName = id.replace(/[^a-zA-Z0-9_-]/g, '_');
        const localFile = new File(dir, `${safeName}.jpg`);
        if (localFile.exists) {
            logger.log('TvdbProvider', `Image already cached for TVDB ID ${id}`);
            return localFile.uri;
        }
        logger.log('TvdbProvider', `Downloading image: ${url} → ${localFile.uri}`);
        await File.downloadFileAsync(url, localFile);
        return localFile.uri;
    }

    async fetchSeasonEpisodes(showProviderId: string, seasonNumber: number): Promise<ProviderEpisode[]> {
        const allEpisodes: ProviderEpisode[] = [];
        let page = 0;
        const maxPages = 10; // safety cap to prevent infinite loops

        try {
            while (page < maxPages) {
                const url =
                    `${TVDB_BASE_URL}/series/${encodeURIComponent(showProviderId)}/episodes/default` +
                    `?page=${page}`;
                const response = await this.fetchAuthed(url);
                await delay(REQUEST_DELAY_MS);
                if (!response.ok) {
                    logger.warn('TvdbProvider', `Episodes fetch failed for TVDB ID ${showProviderId} page ${page}: HTTP ${response.status}`);
                    break;
                }
                const data = await response.json();
                const episodes: TvdbEpisode[] = data.data?.episodes ?? [];

                if (episodes.length === 0) break; // no more pages

                for (const ep of episodes) {
                    if (ep.seasonNumber === seasonNumber) {
                        allEpisodes.push({
                            episodeNumber: ep.number,
                            title: ep.name ?? undefined,
                            stillUrl: ep.image ?? null,
                        });
                    }
                }

                // TVDB paginates; check if there are more pages
                const links = data.links;
                if (!links?.next) break;
                page++;
            }
        } catch (e) {
            logger.warn('TvdbProvider', `fetchSeasonEpisodes error for TVDB ID ${showProviderId} S${seasonNumber}`, e);
        }

        logger.log('TvdbProvider', `fetchSeasonEpisodes: TVDB ID ${showProviderId} S${seasonNumber} → ${allEpisodes.length} episode(s)`);
        return allEpisodes;
    }

    async downloadEpisodeThumbnail(key: string, stillUrl: string): Promise<string> {
        await ensureDir(EPISODE_THUMBS_DIR);
        const safeName = key.replace(/[^a-zA-Z0-9_-]/g, '_');
        const localFile = new File(EPISODE_THUMBS_DIR, `${safeName}.jpg`);
        if (localFile.exists) {
            logger.log('TvdbProvider', `Episode thumbnail already cached for key ${key}`);
            return localFile.uri;
        }
        logger.log('TvdbProvider', `Downloading episode thumbnail: ${stillUrl} → ${localFile.uri}`);
        await File.downloadFileAsync(stillUrl, localFile);
        return localFile.uri;
    }

    /**
     * Fetch all poster artworks for a TVDB series and return their URLs sorted
     * by score descending.  Used by the edit-item rematch screen.
     *
     * TVDB artwork type IDs: 1 = banner, 2 = poster, 3 = background/fanart.
     */
    async fetchSeriesPosters(tvdbId: string): Promise<string[]> {
        try {
            const url = `${TVDB_BASE_URL}/series/${encodeURIComponent(tvdbId)}/artworks?type=2`;
            const response = await this.fetchAuthed(url);
            if (!response.ok) {
                logger.warn('TvdbProvider', `Artworks fetch failed for TVDB ID ${tvdbId}: HTTP ${response.status}`);
                return [];
            }
            const data = await response.json();
            const artworks: TvdbArtwork[] = data.data?.artworks ?? [];
            return artworks
                .filter((a) => a.type === 2 && a.image)
                .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
                .map((a) => a.image);
        } catch (e) {
            logger.warn('TvdbProvider', `fetchSeriesPosters error for TVDB ID ${tvdbId}`, e);
            return [];
        }
    }
}
