import { File, Directory, Paths } from 'expo-file-system';
import { store } from '@/store/store';
import { updateShowMetadata, updateMovieMetadata } from '@/store/libraryReducer';
import type { IMediaLibrary } from '@/store/libraryReducer';
import type { IMediaObject } from '@/scripts/FileScanner';
import { logger } from '@/scripts/Logger';

const TMDB_BASE_URL = 'https://api.themoviedb.org/3';
const POSTER_BASE_URL = 'https://image.tmdb.org/t/p/w500';
const POSTERS_DIR = new Directory(Paths.document, 'smb_posters');

/** Milliseconds to wait between successive TMDB API requests. */
const REQUEST_DELAY_MS = 150;

function delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

async function ensurePostersDir(): Promise<void> {
    if (!POSTERS_DIR.exists) {
        POSTERS_DIR.create({ intermediates: true, idempotent: true });
    }
}

/**
 * Download a TMDB poster image to local storage and return the local file URI.
 * If the file already exists locally it is returned immediately without a network
 * request, making the app fully usable offline once posters have been cached.
 */
async function downloadPoster(tmdbId: string, posterPath: string): Promise<string> {
    await ensurePostersDir();
    // Sanitize the TMDB ID so it cannot contain path-traversal characters.
    const safeName = tmdbId.replace(/[^a-zA-Z0-9_-]/g, '_');
    const localFile = new File(POSTERS_DIR, `${safeName}.jpg`);
    if (localFile.exists) {
        logger.log('MetadataService', `Poster already cached locally for TMDB ID ${tmdbId}`);
        return localFile.uri;
    }
    const remoteUrl = POSTER_BASE_URL + posterPath;
    logger.log('MetadataService', `Downloading poster: ${remoteUrl} → ${localFile.uri}`);
    await File.downloadFileAsync(remoteUrl, localFile);
    return localFile.uri;
}

export class MetadataService {
    private static _instance: MetadataService | null = null;

    static getInstance(): MetadataService {
        if (!MetadataService._instance) {
            MetadataService._instance = new MetadataService();
        }
        return MetadataService._instance;
    }

    /** Enrich both the TV library and the movie list concurrently. */
    async enrichAll(library: IMediaLibrary, movies: IMediaObject[], apiKey: string): Promise<void> {
        const results = await Promise.allSettled([
            this.enrichLibrary(library, apiKey),
            this.enrichMovies(movies, apiKey),
        ]);
        for (const result of results) {
            if (result.status === 'rejected') {
                logger.error('MetadataService', 'enrichAll: a task was rejected', result.reason);
            }
        }
    }

    /** Fetch TMDB posters for every show in the library that does not yet have one cached. */
    async enrichLibrary(library: IMediaLibrary, apiKey: string): Promise<void> {
        const showNames = Object.keys(library);
        logger.log('MetadataService', `enrichLibrary: ${showNames.length} show(s) to process`);

        const overrides = store.getState().libraryReducer.mediaOverrides;

        for (const showName of showNames) {
            const show = library[showName];

            // Honour a user-set poster override (from manual TMDB rematch or local browse).
            const overridePoster = overrides[`show:${showName}`]?.poster;
            if (overridePoster) {
                if (new File(overridePoster).exists) {
                    store.dispatch(updateShowMetadata({ showName, tmdbId: show.ids.tmdb ?? '', poster: overridePoster }));
                    logger.log('MetadataService', `Applying poster override for "${showName}"`);
                    continue;
                }
            }

            // Skip if we already have a locally cached poster for this show.
            if (show.poster) {
                if (new File(show.poster).exists) {
                    logger.log('MetadataService', `Skipping "${showName}" – poster already cached`);
                    continue;
                }
            }

            try {
                const url =
                    `${TMDB_BASE_URL}/search/tv` +
                    `?api_key=${encodeURIComponent(apiKey)}` +
                    `&query=${encodeURIComponent(showName)}` +
                    `&language=en-US&page=1`;

                const response = await fetch(url);
                if (!response.ok) {
                    logger.warn('MetadataService', `TMDB TV search failed for "${showName}": HTTP ${response.status}`);
                    await delay(REQUEST_DELAY_MS);
                    continue;
                }

                const data = await response.json();
                const results: Array<{ id: number; poster_path: string | null }> = data.results ?? [];

                if (results.length === 0 || !results[0].poster_path) {
                    logger.log('MetadataService', `No TMDB poster found for show "${showName}"`);
                    await delay(REQUEST_DELAY_MS);
                    continue;
                }

                const tmdbId = String(results[0].id);
                const localUri = await downloadPoster(tmdbId, results[0].poster_path);
                store.dispatch(updateShowMetadata({ showName, tmdbId, poster: localUri }));
                logger.log('MetadataService', `Show "${showName}" → TMDB ID ${tmdbId}, poster cached at ${localUri}`);
            } catch (e) {
                logger.warn('MetadataService', `Error enriching show "${showName}"`, e);
            }

            await delay(REQUEST_DELAY_MS);
        }

        logger.log('MetadataService', 'enrichLibrary complete');
    }

    /** Fetch TMDB posters for every movie that does not yet have one cached. */
    async enrichMovies(movies: IMediaObject[], apiKey: string): Promise<void> {
        logger.log('MetadataService', `enrichMovies: ${movies.length} movie(s) to process`);

        const overrides = store.getState().libraryReducer.mediaOverrides;

        for (const movie of movies) {
            // Honour a user-set poster override (from manual TMDB rematch or local browse).
            const overridePoster = overrides[`movie:${movie.path}`]?.poster;
            if (overridePoster) {
                if (new File(overridePoster).exists) {
                    store.dispatch(updateMovieMetadata({ path: movie.path, tmdbId: movie.ids.tmdb ?? '', poster: overridePoster }));
                    logger.log('MetadataService', `Applying poster override for movie "${movie.title}"`);
                    continue;
                }
            }

            // Skip if we already have a locally cached poster for this movie.
            if (movie.poster) {
                if (new File(movie.poster).exists) {
                    logger.log('MetadataService', `Skipping movie "${movie.title}" – poster already cached`);
                    continue;
                }
            }

            const searchTitle = movie.title || movie.filename.replace(/\.[^.]+$/, '');

            try {
                const url =
                    `${TMDB_BASE_URL}/search/movie` +
                    `?api_key=${encodeURIComponent(apiKey)}` +
                    `&query=${encodeURIComponent(searchTitle)}` +
                    `&language=en-US&page=1`;

                const response = await fetch(url);
                if (!response.ok) {
                    logger.warn('MetadataService', `TMDB movie search failed for "${searchTitle}": HTTP ${response.status}`);
                    await delay(REQUEST_DELAY_MS);
                    continue;
                }

                const data = await response.json();
                const results: Array<{ id: number; poster_path: string | null }> = data.results ?? [];

                if (results.length === 0 || !results[0].poster_path) {
                    logger.log('MetadataService', `No TMDB poster found for movie "${searchTitle}"`);
                    await delay(REQUEST_DELAY_MS);
                    continue;
                }

                const tmdbId = String(results[0].id);
                const localUri = await downloadPoster(tmdbId, results[0].poster_path);
                store.dispatch(updateMovieMetadata({ path: movie.path, tmdbId, poster: localUri }));
                logger.log('MetadataService', `Movie "${searchTitle}" → TMDB ID ${tmdbId}, poster cached at ${localUri}`);
            } catch (e) {
                logger.warn('MetadataService', `Error enriching movie "${searchTitle}"`, e);
            }

            await delay(REQUEST_DELAY_MS);
        }

        logger.log('MetadataService', 'enrichMovies complete');
    }
}
