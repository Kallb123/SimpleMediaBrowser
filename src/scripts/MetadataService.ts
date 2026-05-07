import { File, Directory, Paths } from 'expo-file-system';
import { store } from '@/store/store';
import { updateShowMetadata, updateMovieMetadata, setScanProgress, mergeDuplicateShows, updateSeasonEpisodeMetadata, clearShowEpisodeMetadata } from '@/store/libraryReducer';
import type { IMediaLibrary, IMediaShow, IMediaSeason } from '@/store/libraryReducer';
import type { IMediaObject } from '@/scripts/FileScanner';
import { fuzzyKey, buildTmdbSearchQuery } from '@/scripts/FileScanner';
import { logger } from '@/scripts/Logger';

const TMDB_BASE_URL = 'https://api.themoviedb.org/3';
const POSTER_BASE_URL = 'https://image.tmdb.org/t/p/w500';
const EPISODE_THUMB_BASE_URL = 'https://image.tmdb.org/t/p/w780';
const POSTERS_DIR = new Directory(Paths.document, 'smb_posters');
const EPISODE_THUMBS_DIR = new Directory(Paths.document, 'smb_thumbnails_tmdb');

/** Milliseconds to wait between successive TMDB API requests. */
const REQUEST_DELAY_MS = 150;

function delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Parse the year from a TMDB date string (e.g. "2018-04-23") or return 0.
 * Centralises the repeated `parseInt(dateStr.substring(0, 4), 10)` pattern.
 */
function extractYearFromDate(dateString?: string): number {
    return dateString ? parseInt(dateString.substring(0, 4), 10) : 0;
}

async function ensurePostersDir(): Promise<void> {
    if (!POSTERS_DIR.exists) {
        POSTERS_DIR.create({ intermediates: true, idempotent: true });
    }
}

async function ensureEpisodeThumbsDir(): Promise<void> {
    if (!EPISODE_THUMBS_DIR.exists) {
        EPISODE_THUMBS_DIR.create({ intermediates: true, idempotent: true });
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

/**
 * Download a TMDB episode still image to local storage and return the local file URI.
 * If the file already exists locally it is returned immediately without a network request.
 * `key` should be a safe string like "12345_S01_E03" that uniquely identifies the episode.
 */
async function downloadEpisodeThumbnail(key: string, stillPath: string): Promise<string> {
    await ensureEpisodeThumbsDir();
    const safeName = key.replace(/[^a-zA-Z0-9_-]/g, '_');
    const localFile = new File(EPISODE_THUMBS_DIR, `${safeName}.jpg`);
    if (localFile.exists) {
        logger.log('MetadataService', `Episode thumbnail already cached locally for key ${key}`);
        return localFile.uri;
    }
    const remoteUrl = EPISODE_THUMB_BASE_URL + stillPath;
    logger.log('MetadataService', `Downloading episode thumbnail: ${remoteUrl} → ${localFile.uri}`);
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
        // First pass: collapse shows whose names differ only in punctuation / capitalisation.
        // This ensures we don't make separate TMDB requests for e.g. "Grey's Anatomy" and
        // "Greys Anatomy" that would otherwise remain as two distinct library entries.
        this.deduplicateByFuzzyName();
        // Re-read the library after fuzzy dedup so we don't enrich entries that were merged.
        const dedupedLibrary = store.getState().libraryReducer.mediaLibrary;

        const showNames = Object.keys(dedupedLibrary);
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
        // Shared mutable progress state threaded through both enrichment tasks so TV + movie
        // completions both contribute to the same running total.
        const progress = { done: 0 };
        // Dispatch progress every N items to avoid flooding Redux for large libraries,
        // and always on the final item so the counter reaches 100%.
        const METADATA_PROGRESS_INTERVAL = 5;
        const makeDispatchProgress = (currentTotal: number) => () => {
            if (progress.done % METADATA_PROGRESS_INTERVAL === 0 || progress.done === currentTotal) {
                store.dispatch(setScanProgress({
                    phase: 'enriching',
                    filesFound: 0,
                    thumbnailsDone: 0,
                    thumbnailsTotal: 0,
                    metadataDone: progress.done,
                    metadataTotal: currentTotal,
                }));
            }
        };
        const dispatchProgress = makeDispatchProgress(metadataTotal);
        const results = await Promise.allSettled([
            this.enrichLibrary(dedupedLibrary, apiKey, progress, dispatchProgress),
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

        // Episode-level enrichment (names and stills) – uses the per-season TMDB endpoint
        // so one API call covers all episodes in a season, minimising total request count.
        const settings = store.getState().settingsReducer;
        const fetchEpisodeNames = settings.fetchEpisodeNames ?? true;
        const fetchEpisodeThumbnails = settings.fetchEpisodeThumbnails ?? true;
        if (fetchEpisodeNames || fetchEpisodeThumbnails) {
            const enrichedLibrary = store.getState().libraryReducer.mediaLibrary;
            // Count seasons for shows that now have a TMDB ID (resolved during enrichLibrary).
            let seasonCount = 0;
            for (const show of Object.values(enrichedLibrary) as IMediaShow[]) {
                if (show.ids.tmdb) {
                    seasonCount += Object.keys(show.seasons).length;
                }
            }
            if (seasonCount > 0) {
                const episodeMetadataTotal = progress.done + seasonCount;
                store.dispatch(setScanProgress({
                    phase: 'enriching',
                    filesFound: 0,
                    thumbnailsDone: 0,
                    thumbnailsTotal: 0,
                    metadataDone: progress.done,
                    metadataTotal: episodeMetadataTotal,
                }));
                const dispatchEpisodeProgress = makeDispatchProgress(episodeMetadataTotal);
                await this.enrichEpisodes(enrichedLibrary, apiKey, fetchEpisodeNames, fetchEpisodeThumbnails, progress, dispatchEpisodeProgress);
            }
        }
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
                    `&query=${encodeURIComponent(buildTmdbSearchQuery(showName))}` +
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
                    const yearMatch = results.find((r) => extractYearFromDate(r.first_air_date) === showYear);
                    if (yearMatch) bestResult = yearMatch;
                }

                if (!bestResult.poster_path) {
                    logger.log('MetadataService', `No TMDB poster found for show "${showName}"`);
                    await delay(REQUEST_DELAY_MS);
                    continue;
                }

                const tmdbId = String(bestResult.id);
                const tmdbTitle = bestResult.name ?? showName;
                const tmdbYear = extractYearFromDate(bestResult.first_air_date);
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
                    `&query=${encodeURIComponent(buildTmdbSearchQuery(searchTitle))}` +
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
     * Fetch episode names and/or still images from TMDB for all shows that have
     * a TMDB ID.  Uses the `/tv/{id}/season/{n}` endpoint which returns the full
     * episode list for a season in a single API call, making this significantly
     * more efficient than one request per episode.
     *
     * Episodes are matched to their Redux entries by episode number via the
     * standard `eNN` key format used throughout the library.
     */
    async enrichEpisodes(
        library: IMediaLibrary,
        apiKey: string,
        fetchNames: boolean,
        fetchThumbnails: boolean,
        progress: { done: number },
        dispatchProgress: () => void,
    ): Promise<void> {
        logger.log('MetadataService', 'enrichEpisodes: starting episode metadata enrichment');

        for (const [showName, show] of Object.entries(library) as Array<[string, IMediaShow]>) {
            const tmdbId = show.ids.tmdb;
            if (!tmdbId) continue;

            const sortedSeasons = Object.entries(show.seasons).sort(
                (a, b) => (a[1] as IMediaSeason).seasonNumber - (b[1] as IMediaSeason).seasonNumber,
            );

            for (const [seasonKey, season] of sortedSeasons as Array<[string, IMediaSeason]>) {
                try {
                    const url =
                        `${TMDB_BASE_URL}/tv/${encodeURIComponent(tmdbId)}/season/${season.seasonNumber}` +
                        `?api_key=${encodeURIComponent(apiKey)}&language=en-US`;

                    const response = await fetch(url);
                    if (!response.ok) {
                        logger.warn('MetadataService', `TMDB season fetch failed for "${showName}" S${season.seasonNumber}: HTTP ${response.status}`);
                        await delay(REQUEST_DELAY_MS);
                        continue;
                    }

                    const data = await response.json();
                    const tmdbEpisodes: Array<{
                        episode_number: number;
                        name?: string;
                        still_path: string | null;
                    }> = data.episodes ?? [];

                    const episodeUpdates: { [episodeKey: string]: { tmdbTitle?: string; tmdbThumbnail?: string } } = {};

                    for (const epData of tmdbEpisodes) {
                        const episodeKey = `e${String(epData.episode_number).padStart(2, '0')}`;
                        if (!season.episodes[episodeKey]) continue;

                        const update: { tmdbTitle?: string; tmdbThumbnail?: string } = {};

                        if (fetchNames && epData.name) {
                            update.tmdbTitle = epData.name;
                        }

                        if (fetchThumbnails && epData.still_path) {
                            // Reuse cached thumbnail if it already exists on disk.
                            const existingThumbnail = season.episodes[episodeKey].tmdbThumbnail;
                            let thumbnailUri: string | undefined;
                            if (existingThumbnail) {
                                try {
                                    if (new File(existingThumbnail).exists) {
                                        thumbnailUri = existingThumbnail;
                                    }
                                } catch {
                                    // File check failed; will download below.
                                }
                            }
                            if (!thumbnailUri) {
                                try {
                                    const thumbKey = `${tmdbId}_S${season.seasonNumber}_E${epData.episode_number}`;
                                    thumbnailUri = await downloadEpisodeThumbnail(thumbKey, epData.still_path);
                                } catch (e) {
                                    logger.warn('MetadataService', `Failed to download thumbnail for "${showName}" S${season.seasonNumber}E${epData.episode_number}`, e);
                                }
                            }
                            if (thumbnailUri) update.tmdbThumbnail = thumbnailUri;
                        }

                        if (Object.keys(update).length > 0) {
                            episodeUpdates[episodeKey] = update;
                        }
                    }

                    if (Object.keys(episodeUpdates).length > 0) {
                        store.dispatch(updateSeasonEpisodeMetadata({ showName, seasonKey, episodeUpdates }));
                        logger.log('MetadataService', `"${showName}" S${season.seasonNumber}: updated ${Object.keys(episodeUpdates).length} episode(s)`);
                    }

                    await delay(REQUEST_DELAY_MS);
                } catch (e) {
                    logger.warn('MetadataService', `Error enriching episodes for "${showName}" S${season.seasonNumber}`, e);
                } finally {
                    progress.done++;
                    dispatchProgress();
                }
            }
        }

        logger.log('MetadataService', 'enrichEpisodes complete');
    }

    /**
     * Re-enriches a single show's episode metadata after a manual TMDB rematch.
     *
     * Clears existing TMDB episode titles and thumbnails for the show, then
     * fetches fresh data from TMDB using the newly confirmed tmdbId.  Respects
     * the user's fetchEpisodeNames / fetchEpisodeThumbnails settings.
     */
    async rematchSingleShow(showName: string, tmdbId: string, apiKey: string): Promise<void> {
        const settings = store.getState().settingsReducer;
        const fetchNames = settings.fetchEpisodeNames ?? true;
        const fetchThumbnails = settings.fetchEpisodeThumbnails ?? true;
        if (!fetchNames && !fetchThumbnails) return;

        // Clear stale episode data from the previous TMDB match.
        store.dispatch(clearShowEpisodeMetadata(showName));

        // Read the library after the clear so episodes have a blank slate.
        const library = store.getState().libraryReducer.mediaLibrary;
        const show = library[showName];
        if (!show) return;

        // Build a temporary single-show sub-library that carries the confirmed
        // new TMDB ID so enrichEpisodes fetches from the correct series.
        const singleShowLibrary: IMediaLibrary = {
            [showName]: { ...show, ids: { ...show.ids, tmdb: tmdbId } },
        };

        const progress = { done: 0 };
        // No-op progress callback: rematch is a one-off operation; progress is not reported to the UI.
        const noOpProgress = () => {};
        logger.log('MetadataService', `rematchSingleShow: re-enriching "${showName}" with TMDB ID ${tmdbId}`);
        await this.enrichEpisodes(singleShowLibrary, apiKey, fetchNames, fetchThumbnails, progress, noOpProgress);
        logger.log('MetadataService', `rematchSingleShow: done for "${showName}"`);
    }

    /**
     * Scans the current Redux library for shows whose names are equivalent after
     * fuzzy normalisation (lower-case, punctuation stripped, "&" → "and") and
     * merges them into a single canonical entry.
     *
     * This handles common naming mismatches such as:
     *   "Grey's Anatomy"  vs  "Greys Anatomy"
     *   "Tom & Jerry"     vs  "Tom and Jerry"
     *   "Bluey (2018)"    vs  "Bluey"           (year suffix already handled at
     *                                             scan time; covered here as defence)
     *
     * When multiple keys share the same fuzzy key the canonical entry is chosen
     * as the one that already has a TMDB ID (from a prior run); if none or
     * multiple do, the alphabetically first key is used for determinism.
     */
    private deduplicateByFuzzyName(): void {
        const library = store.getState().libraryReducer.mediaLibrary;

        // Group library keys by their normalised fuzzy key.
        const byFuzzyKey = new Map<string, string[]>();
        for (const showKey of Object.keys(library)) {
            const fk = fuzzyKey(showKey);
            const group = byFuzzyKey.get(fk);
            if (group) {
                group.push(showKey);
            } else {
                byFuzzyKey.set(fk, [showKey]);
            }
        }

        for (const [fk, showKeys] of byFuzzyKey) {
            if (showKeys.length <= 1) continue;
            // Sort for deterministic canonical selection.
            showKeys.sort();
            // Prefer whichever entry already has a TMDB ID from a previous scan.
            const withTmdb = showKeys.find((k) => !!library[k]?.ids.tmdb);
            const keepKey = withTmdb ?? showKeys[0];
            const removeKeys = showKeys.filter((k) => k !== keepKey);
            logger.log(
                'MetadataService',
                `Deduplicating by fuzzy name "${fk}": keeping "${keepKey}", merging [${removeKeys.map((k) => `"${k}"`).join(', ')}]`,
            );
            store.dispatch(mergeDuplicateShows({ keepKey, removeKeys }));
        }
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
