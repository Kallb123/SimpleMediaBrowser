import { File } from 'expo-file-system';
import { store } from '@/store/store';
import { updateShowMetadata, updateMovieMetadata, setScanProgress, mergeDuplicateShows, updateSeasonEpisodeMetadata, clearShowEpisodeMetadata } from '@/store/libraryReducer';
import type { IMediaLibrary, IMediaShow, IMediaSeason, dataSources } from '@/store/libraryReducer';
import type { IMediaObject } from '@/scripts/FileScanner';
import { fuzzyKey } from '@/scripts/FileScanner';
import { logger } from '@/scripts/Logger';
import type { IMetadataProvider } from '@/scripts/providers/IMetadataProvider';
import { TmdbProvider } from '@/scripts/providers/TmdbProvider';
import { TvdbProvider } from '@/scripts/providers/TvdbProvider';

export class MetadataService {
    private static _instance: MetadataService | null = null;

    static getInstance(): MetadataService {
        if (!MetadataService._instance) {
            MetadataService._instance = new MetadataService();
        }
        return MetadataService._instance;
    }

    /** Enrich both the TV library and the movie list concurrently. */
    async enrichAll(library: IMediaLibrary, movies: IMediaObject[]): Promise<void> {
        // Read credentials and global settings from the Redux store.
        const settings = store.getState().settingsReducer;
        const globalSource: dataSources = settings.dataSource ?? 'tmdb';

        // Instantiate available providers.
        const tmdbProvider: TmdbProvider | null = settings.tmdbApiKey
            ? new TmdbProvider(settings.tmdbApiKey)
            : null;
        const tvdbProvider: TvdbProvider | null = settings.tvdbApiKey
            ? new TvdbProvider(settings.tvdbApiKey, settings.tvdbPin ?? undefined)
            : null;

        // Authenticate TVDB once per enrichment run (short-lived JWT).
        if (tvdbProvider) {
            await tvdbProvider.authenticate();
        }

        // Provider resolver: checks per-item override → per-show source → global setting.
        const overrides = store.getState().libraryReducer.mediaOverrides;
        const resolveShowProvider = (showName: string, show: IMediaShow): IMetadataProvider | null => {
            const overrideSource = overrides[`show:${showName}`]?.metadataSourceOverride;
            const preferred = overrideSource ?? show.metadataSource ?? globalSource;
            if (preferred === 'tvdb') return tvdbProvider;
            return tmdbProvider;
        };
        const resolveMovieProvider = (movie: IMediaObject): IMetadataProvider | null => {
            const overrideSource = overrides[`movie:${movie.parsedPath}`]?.metadataSourceOverride;
            const preferred = overrideSource ?? globalSource;
            if (preferred === 'tvdb') return tvdbProvider;
            return tmdbProvider;
        };

        // First pass: collapse shows whose names differ only in punctuation / capitalisation.
        // This ensures we don't make separate requests for e.g. "Grey's Anatomy" and
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
            this.enrichLibrary(dedupedLibrary, resolveShowProvider, progress, dispatchProgress),
            this.enrichMovies(movies, resolveMovieProvider, progress, dispatchProgress),
        ]);
        for (const result of results) {
            if (result.status === 'rejected') {
                logger.error('MetadataService', 'enrichAll: a task was rejected', result.reason);
            }
        }
        // After both TV and movie enrichment, collapse any shows that share the same
        // provider ID into a single library entry.
        this.deduplicateByProviderId();

        // Episode-level enrichment (names and stills).
        const fetchEpisodeNames = settings.fetchEpisodeNames ?? true;
        const fetchEpisodeThumbnails = settings.fetchEpisodeThumbnails ?? true;
        if (fetchEpisodeNames || fetchEpisodeThumbnails) {
            const enrichedLibrary = store.getState().libraryReducer.mediaLibrary;
            // Count seasons for shows that now have a provider ID.
            let seasonCount = 0;
            for (const show of Object.values(enrichedLibrary) as IMediaShow[]) {
                if (show.ids.tmdb || show.ids.tvdb) {
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
                await this.enrichEpisodes(enrichedLibrary, resolveShowProvider, fetchEpisodeNames, fetchEpisodeThumbnails, progress, dispatchEpisodeProgress);
            }
        }
    }

    /** Fetch posters for every show in the library that does not yet have one cached. */
    async enrichLibrary(
        library: IMediaLibrary,
        resolveProvider: (showName: string, show: IMediaShow) => IMetadataProvider | null,
        progress: { done: number },
        dispatchProgress: () => void,
    ): Promise<void> {
        const showNames = Object.keys(library);
        logger.log('MetadataService', `enrichLibrary: ${showNames.length} show(s) to process`);

        const overrides = store.getState().libraryReducer.mediaOverrides;

        for (const showName of showNames) {
            const show = library[showName];

            try {
                // Honour a user-set poster override (from manual rematch or local browse).
                const overridePoster = overrides[`show:${showName}`]?.poster;
                if (overridePoster) {
                    if (new File(overridePoster).exists) {
                        const existingId = show.ids.tmdb ?? show.ids.tvdb ?? '';
                        store.dispatch(updateShowMetadata({ showName, tmdbId: existingId, poster: overridePoster }));
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

                const provider = resolveProvider(showName, show);
                if (!provider) {
                    logger.log('MetadataService', `No provider available for "${showName}" – skipping`);
                    continue;
                }

                const results = await provider.searchShow(showName, show.year > 0 ? show.year : undefined);
                if (results.length === 0) {
                    logger.log('MetadataService', `No poster found for show "${showName}" via ${provider.source}`);
                    continue;
                }

                // Year-aware result selection: prefer a result whose year matches the folder year.
                let bestResult = results[0];
                if (show.year > 0) {
                    const yearMatch = results.find((r) => r.year === show.year);
                    if (yearMatch) bestResult = yearMatch;
                }

                if (!bestResult.posterUrl) {
                    logger.log('MetadataService', `No poster URL for show "${showName}" via ${provider.source}`);
                    continue;
                }

                const localUri = await provider.downloadShowPoster(bestResult.id, bestResult.posterUrl);
                store.dispatch(updateShowMetadata({
                    showName,
                    tmdbId: bestResult.id,
                    source: provider.source,
                    poster: localUri,
                    title: bestResult.title,
                    year: bestResult.year || undefined,
                }));
                logger.log('MetadataService', `Show "${showName}" → ${provider.source} ID ${bestResult.id} (${bestResult.title}, ${bestResult.year || 'year unknown'}), poster cached at ${localUri}`);
            } catch (e) {
                logger.warn('MetadataService', `Error enriching show "${showName}"`, e);
            } finally {
                progress.done++;
                dispatchProgress();
            }
        }

        logger.log('MetadataService', 'enrichLibrary complete');
    }

    /** Fetch posters for every movie that does not yet have one cached. */
    async enrichMovies(
        movies: IMediaObject[],
        resolveProvider: (movie: IMediaObject) => IMetadataProvider | null,
        progress: { done: number },
        dispatchProgress: () => void,
    ): Promise<void> {
        logger.log('MetadataService', `enrichMovies: ${movies.length} movie(s) to process`);

        const overrides = store.getState().libraryReducer.mediaOverrides;

        for (const movie of movies) {
            const searchTitle = movie.title || movie.filename.replace(/\.[^.]+$/, '');
            try {
                // Honour a user-set poster override (from manual rematch or local browse).
                const overridePoster = overrides[`movie:${movie.parsedPath}`]?.poster;
                if (overridePoster) {
                    if (new File(overridePoster).exists) {
                        const existingId = movie.ids.tmdb ?? movie.ids.tvdb ?? '';
                        store.dispatch(updateMovieMetadata({ path: movie.path, tmdbId: existingId, poster: overridePoster }));
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

                const provider = resolveProvider(movie);
                if (!provider) {
                    logger.log('MetadataService', `No provider available for movie "${searchTitle}" – skipping`);
                    continue;
                }

                const results = await provider.searchMovie(searchTitle);
                if (results.length === 0 || !results[0].posterUrl) {
                    logger.log('MetadataService', `No poster found for movie "${searchTitle}" via ${provider.source}`);
                    continue;
                }

                const best = results[0];
                const localUri = await provider.downloadMoviePoster(best.id, best.posterUrl);
                store.dispatch(updateMovieMetadata({ path: movie.path, tmdbId: best.id, source: provider.source, poster: localUri }));
                logger.log('MetadataService', `Movie "${searchTitle}" → ${provider.source} ID ${best.id}, poster cached at ${localUri}`);
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
     * Fetch episode names and/or still images for all shows that have a provider ID.
     * Uses the per-season endpoint which returns all episodes in one API call per season.
     * Episodes are matched to their Redux entries by episode number via the standard `eNN` key format.
     */
    async enrichEpisodes(
        library: IMediaLibrary,
        resolveProvider: (showName: string, show: IMediaShow) => IMetadataProvider | null,
        fetchNames: boolean,
        fetchThumbnails: boolean,
        progress: { done: number },
        dispatchProgress: () => void,
    ): Promise<void> {
        logger.log('MetadataService', 'enrichEpisodes: starting episode metadata enrichment');

        for (const [showName, show] of Object.entries(library) as Array<[string, IMediaShow]>) {
            const provider = resolveProvider(showName, show);
            if (!provider) continue;

            // Resolve the provider-specific show ID.
            const showProviderId = provider.source === 'tvdb' ? show.ids.tvdb : show.ids.tmdb;
            if (!showProviderId) continue;

            const sortedSeasons = Object.entries(show.seasons).sort(
                (a, b) => (a[1] as IMediaSeason).seasonNumber - (b[1] as IMediaSeason).seasonNumber,
            );

            for (const [seasonKey, season] of sortedSeasons as Array<[string, IMediaSeason]>) {
                try {
                    const providerEpisodes = await provider.fetchSeasonEpisodes(showProviderId, season.seasonNumber);

                    const episodeUpdates: { [episodeKey: string]: { tmdbTitle?: string; tmdbThumbnail?: string } } = {};

                    for (const epData of providerEpisodes) {
                        const episodeKey = `e${String(epData.episodeNumber).padStart(2, '0')}`;
                        if (!season.episodes[episodeKey]) continue;

                        const update: { tmdbTitle?: string; tmdbThumbnail?: string } = {};

                        if (fetchNames && epData.title) {
                            update.tmdbTitle = epData.title;
                        }

                        if (fetchThumbnails && epData.stillUrl) {
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
                                    const thumbKey = `${provider.source}_${showProviderId}_S${season.seasonNumber}_E${epData.episodeNumber}`;
                                    thumbnailUri = await provider.downloadEpisodeThumbnail(thumbKey, epData.stillUrl);
                                } catch (e) {
                                    logger.warn('MetadataService', `Failed to download thumbnail for "${showName}" S${season.seasonNumber}E${epData.episodeNumber}`, e);
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
                        logger.log('MetadataService', `"${showName}" S${season.seasonNumber}: updated ${Object.keys(episodeUpdates).length} episode(s) via ${provider.source}`);
                    }
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
     * Re-enriches a single show's episode metadata after a manual rematch.
     *
     * Clears existing episode titles and thumbnails for the show, then fetches
     * fresh data using the newly confirmed provider ID.  Respects the user's
     * fetchEpisodeNames / fetchEpisodeThumbnails settings.
     *
     * @param showName   The canonical Redux library key for the show.
     * @param providerId The new provider-specific ID (TMDB or TVDB).
     * @param source     Which provider resolved the match. Defaults to 'tmdb'.
     */
    async rematchSingleShow(showName: string, providerId: string, source: dataSources = 'tmdb'): Promise<void> {
        const settings = store.getState().settingsReducer;
        const fetchNames = settings.fetchEpisodeNames ?? true;
        const fetchThumbnails = settings.fetchEpisodeThumbnails ?? true;
        if (!fetchNames && !fetchThumbnails) return;

        // Instantiate the appropriate provider.
        let provider: IMetadataProvider | null = null;
        if (source === 'tvdb' && settings.tvdbApiKey) {
            const tvdb = new TvdbProvider(settings.tvdbApiKey, settings.tvdbPin ?? undefined);
            await tvdb.authenticate();
            provider = tvdb;
        } else if (source === 'tmdb' && settings.tmdbApiKey) {
            provider = new TmdbProvider(settings.tmdbApiKey);
        }
        if (!provider) {
            logger.warn('MetadataService', `rematchSingleShow: no provider available for source "${source}"`);
            return;
        }

        // Clear stale episode data from the previous match.
        store.dispatch(clearShowEpisodeMetadata(showName));

        // Read the library after the clear so episodes have a blank slate.
        const library = store.getState().libraryReducer.mediaLibrary;
        const show = library[showName];
        if (!show) return;

        // Build a temporary single-show sub-library that carries the confirmed
        // new provider ID so enrichEpisodes fetches from the correct series.
        const updatedIds = source === 'tvdb'
            ? { ...show.ids, tvdb: providerId }
            : { ...show.ids, tmdb: providerId };
        const singleShowLibrary: IMediaLibrary = {
            [showName]: { ...show, ids: updatedIds },
        };

        const capturedProvider = provider;
        const resolveFixed = (_name: string, _show: IMediaShow) => capturedProvider;

        const progress = { done: 0 };
        const noOpProgress = () => {};
        logger.log('MetadataService', `rematchSingleShow: re-enriching "${showName}" with ${source} ID ${providerId}`);
        await this.enrichEpisodes(singleShowLibrary, resolveFixed, fetchNames, fetchThumbnails, progress, noOpProgress);
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
     * as the one that already has a provider ID (from a prior run); if none or
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
            // Prefer whichever entry already has a provider ID from a previous scan.
            const withId = showKeys.find((k) => !!(library[k]?.ids.tmdb || library[k]?.ids.tvdb));
            const keepKey = withId ?? showKeys[0];
            const removeKeys = showKeys.filter((k) => k !== keepKey);
            logger.log(
                'MetadataService',
                `Deduplicating by fuzzy name "${fk}": keeping "${keepKey}", merging [${removeKeys.map((k) => `"${k}"`).join(', ')}]`,
            );
            store.dispatch(mergeDuplicateShows({ keepKey, removeKeys }));
        }
    }

    /**
     * Scans the current Redux library for shows that share the same provider ID
     * (possible when folder naming differs but the provider resolved them to the same
     * series) and merges the duplicates into a single canonical entry.
     *
     * Checks both TMDB and TVDB IDs independently.
     */
    private deduplicateByProviderId(): void {
        const library = store.getState().libraryReducer.mediaLibrary;

        for (const idField of ['tmdb', 'tvdb'] as const) {
            const byId = new Map<string, string[]>();
            for (const [showKey, show] of Object.entries(library) as Array<[string, IMediaShow]>) {
                const id = show.ids[idField];
                if (!id) continue;
                const group = byId.get(id);
                if (group) {
                    group.push(showKey);
                } else {
                    byId.set(id, [showKey]);
                }
            }

            for (const [id, showKeys] of byId) {
                if (showKeys.length <= 1) continue;
                showKeys.sort();
                const keepKey = showKeys[0];
                const removeKeys = showKeys.slice(1);
                logger.log(
                    'MetadataService',
                    `Deduplicating by ${idField} ID ${id}: keeping "${keepKey}", merging [${removeKeys.map((k) => `"${k}"`).join(', ')}]`,
                );
                store.dispatch(mergeDuplicateShows({ keepKey, removeKeys }));
            }
        }
    }
}
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
