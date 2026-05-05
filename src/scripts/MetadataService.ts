import { File, Directory, Paths } from 'expo-file-system';
import { store } from '@/store/store';
import { updateShowMetadata, updateMovieMetadata, setScanProgress, mergeDuplicateShows } from '@/store/libraryReducer';
import type { IMediaLibrary, IMediaShow } from '@/store/libraryReducer';
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

/**
 * Remove common year suffixes so TMDB can find titles like "Breaking Bad (2008)"
 * or "Movie Title 2008". Strips patterns like "(2008)", "[2008]", or " 2008" at
 * the end of the string.
 */
function stripYearSuffix(title: string): string {
    return title.replace(/\s*[\[(]?\d{4}[\])]?\s*$/, '').trim();
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
        const showNames = Object.keys(library);
        const metadataTotal = showNames.length + movies.length;
        // Announce the enriching phase so the UI can show a progress banner.
        store.dispatch(setScanProgress({
            phase: 'enriching',
            filesFound: 0,
            thumbnailsDone: 0,
            thumbnailsTotal: 0,
            metadataDone: 0,
            metadataTotal,
        }));
        // Shared counter threaded through both enrichment tasks so TV + movie
        // completions both contribute to the same running total.
        const progress = { done: 0 };
        // Dispatch progress every N items to avoid flooding Redux for large libraries,
        // and always on the final item so the counter reaches 100%.
        const METADATA_PROGRESS_INTERVAL = 5;
        const dispatchProgress = () => {
            if (progress.done % METADATA_PROGRESS_INTERVAL === 0 || progress.done === metadataTotal) {
                store.dispatch(setScanProgress({
                    phase: 'enriching',
                    filesFound: 0,
                    thumbnailsDone: 0,
                    thumbnailsTotal: 0,
                    metadataDone: progress.done,
                    metadataTotal,
                }));
            }
        };
        const results = await Promise.allSettled([
            this.enrichLibrary(library, apiKey, progress, dispatchProgress),
            this.enrichMovies(movies, apiKey, progress, dispatchProgress),
        ]);
        for (const result of results) {
            if (result.status === 'rejected') {
                logger.error('MetadataService', 'enrichAll: a task was rejected', result.reason);
            }
        }
        // After both TV and movie enrichment, collapse any shows that TMDB resolved
        // to the same series ID into a single library entry.
        this.deduplicateByTmdbId();
    }

    /** Fetch TMDB posters for every show in the library that does not yet have one cached. */
    async enrichLibrary(
        library: IMediaLibrary,
        apiKey: string,
        progress: { done: number },
        dispatchProgress: () => void,
    ): Promise<void> {
        const showNames = Object.keys(library);
        logger.log('MetadataService', `enrichLibrary: ${showNames.length} show(s) to process`);

        const overrides = store.getState().libraryReducer.mediaOverrides;

        for (const showName of showNames) {
            const show = library[showName];

            try {
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

                const url =
                    `${TMDB_BASE_URL}/search/tv` +
                    `?api_key=${encodeURIComponent(apiKey)}` +
                    `&query=${encodeURIComponent(stripYearSuffix(showName))}` +
                    `&language=en-US&page=1`;

                const response = await fetch(url);
                if (!response.ok) {
                    logger.warn('MetadataService', `TMDB TV search failed for "${showName}": HTTP ${response.status}`);
                    await delay(REQUEST_DELAY_MS);
                    continue;
                }

                const data = await response.json();
                const results: Array<{ id: number; name?: string; poster_path: string | null; first_air_date?: string }> = data.results ?? [];

                if (results.length === 0) {
                    logger.log('MetadataService', `No TMDB poster found for show "${showName}"`);
                    await delay(REQUEST_DELAY_MS);
                    continue;
                }

                // Year-aware result selection: if the show has a known year (from the
                // folder name suffix), prefer a TMDB result whose first_air_date year
                // matches rather than blindly taking results[0].
                const showYear = show.year;
                let bestResult = results[0];
                if (showYear > 0) {
                    const yearMatch = results.find((r) => {
                        const y = r.first_air_date ? parseInt(r.first_air_date.substring(0, 4), 10) : 0;
                        return y === showYear;
                    });
                    if (yearMatch) bestResult = yearMatch;
                }

                if (!bestResult.poster_path) {
                    logger.log('MetadataService', `No TMDB poster found for show "${showName}"`);
                    await delay(REQUEST_DELAY_MS);
                    continue;
                }

                const tmdbId = String(bestResult.id);
                const tmdbTitle = bestResult.name ?? showName;
                const tmdbYear = bestResult.first_air_date
                    ? parseInt(bestResult.first_air_date.substring(0, 4), 10)
                    : 0;
                const localUri = await downloadPoster(tmdbId, bestResult.poster_path);
                store.dispatch(updateShowMetadata({
                    showName,
                    tmdbId,
                    poster: localUri,
                    title: tmdbTitle,
                    year: tmdbYear || undefined,
                }));
                logger.log('MetadataService', `Show "${showName}" → TMDB ID ${tmdbId} (${tmdbTitle}, ${tmdbYear || 'year unknown'}), poster cached at ${localUri}`);
                await delay(REQUEST_DELAY_MS);
            } catch (e) {
                logger.warn('MetadataService', `Error enriching show "${showName}"`, e);
            } finally {
                progress.done++;
                dispatchProgress();
            }
        }

        logger.log('MetadataService', 'enrichLibrary complete');
    }

    /** Fetch TMDB posters for every movie that does not yet have one cached. */
    async enrichMovies(
        movies: IMediaObject[],
        apiKey: string,
        progress: { done: number },
        dispatchProgress: () => void,
    ): Promise<void> {
        logger.log('MetadataService', `enrichMovies: ${movies.length} movie(s) to process`);

        const overrides = store.getState().libraryReducer.mediaOverrides;

        for (const movie of movies) {
            const searchTitle = movie.title || movie.filename.replace(/\.[^.]+$/, '');
            try {
                // Honour a user-set poster override (from manual TMDB rematch or local browse).
                const overridePoster = overrides[`movie:${movie.parsedPath}`]?.poster;
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

                const url =
                    `${TMDB_BASE_URL}/search/movie` +
                    `?api_key=${encodeURIComponent(apiKey)}` +
                    `&query=${encodeURIComponent(stripYearSuffix(searchTitle))}` +
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
                await delay(REQUEST_DELAY_MS);
            } catch (e) {
                logger.warn('MetadataService', `Error enriching movie "${searchTitle}"`, e);
            } finally {
                progress.done++;
                dispatchProgress();
            }
        }

        logger.log('MetadataService', 'enrichMovies complete');
    }

    /**
     * Scans the current Redux library for shows that share the same TMDB ID
     * (possible when folder naming differs but TMDB resolved them to the same
     * series) and merges the duplicates into a single canonical entry.
     *
     * The canonical entry is chosen as the one that appears first alphabetically
     * among the group; all seasons and episodes from the other entries are folded
     * into it and those entries are removed from the library.
     */
    private deduplicateByTmdbId(): void {
        const library = store.getState().libraryReducer.mediaLibrary;

        // Group library keys by their TMDB ID; skip shows without one.
        const byTmdbId = new Map<string, string[]>();
        for (const [showKey, show] of Object.entries(library) as Array<[string, IMediaShow]>) {
            const tmdbId = show.ids.tmdb;
            if (!tmdbId) continue;
            const group = byTmdbId.get(tmdbId);
            if (group) {
                group.push(showKey);
            } else {
                byTmdbId.set(tmdbId, [showKey]);
            }
        }

        for (const [tmdbId, showKeys] of byTmdbId) {
            if (showKeys.length <= 1) continue;
            // Sort for a stable, reproducible choice of canonical entry.
            showKeys.sort();
            const keepKey = showKeys[0];
            const removeKeys = showKeys.slice(1);
            logger.log(
                'MetadataService',
                `Deduplicating by TMDB ID ${tmdbId}: keeping "${keepKey}", merging [${removeKeys.map((k) => `"${k}"`).join(', ')}]`,
            );
            store.dispatch(mergeDuplicateShows({ keepKey, removeKeys }));
        }
    }
}
