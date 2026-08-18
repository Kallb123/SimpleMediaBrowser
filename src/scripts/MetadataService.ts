import { File } from 'expo-file-system';
import { store } from '@/store/store';
import { updateShowMetadata, updateMovieMetadata, updateAudiobookMetadata, setScanProgress, mergeDuplicateShows, updateSeasonEpisodeMetadata, clearShowEpisodeMetadata } from '@/store/libraryReducer';
import type { IMediaLibrary, IMediaShow, IMediaSeason, IMediaAudiobook, dataSources } from '@/store/libraryReducer';
import type { IMediaObject } from '@/scripts/FileScanner';
import { fuzzyKey } from '@/scripts/FileScanner';
import { logger } from '@/scripts/Logger';
import type { IMetadataProvider } from '@/scripts/providers/IMetadataProvider';
import { TmdbProvider } from '@/scripts/providers/TmdbProvider';
import { TvdbProvider } from '@/scripts/providers/TvdbProvider';
import { AudiobookProvider } from '@/scripts/providers/AudiobookProvider';

export class MetadataService {
    private static _instance: MetadataService | null = null;

    static getInstance(): MetadataService {
        if (!MetadataService._instance) {
            MetadataService._instance = new MetadataService();
        }
        return MetadataService._instance;
    }

    /**
     * Instantiates the configured providers and builds the per-item provider resolvers
     * used by every enrichment entry point.  The resolvers check, in order: a per-item
     * `metadataSourceOverride`, the item's own `metadataSource`, then the global setting.
     *
     * Authenticates TVDB (short-lived JWT) once per call, so this runs once per
     * enrichment run rather than per item.
     */
    private async buildProviders(): Promise<{
        resolveShowProvider: (showName: string, show: IMediaShow) => IMetadataProvider | null;
        resolveMovieProvider: (movie: IMediaObject) => IMetadataProvider | null;
    }> {
        const settings = store.getState().settingsReducer;
        const globalSource: dataSources = settings.dataSource ?? 'tmdb';

        const tmdbProvider: TmdbProvider | null = settings.tmdbApiKey
            ? new TmdbProvider(settings.tmdbApiKey)
            : null;
        const tvdbProvider: TvdbProvider | null = settings.tvdbApiKey
            ? new TvdbProvider(settings.tvdbApiKey, settings.tvdbPin ?? undefined)
            : null;

        if (tvdbProvider) {
            await tvdbProvider.authenticate();
        }

        const overrides = store.getState().libraryReducer.mediaOverrides;
        const resolveShowProvider = (showName: string, show: IMediaShow): IMetadataProvider | null => {
            const overrideSource = overrides[`show:${showName}`]?.metadataSourceOverride;
            const preferred = overrideSource ?? show.metadataSource ?? globalSource;
            if (preferred === 'tvdb') return tvdbProvider;
            return tmdbProvider;
        };
        const resolveMovieProvider = (movie: IMediaObject): IMetadataProvider | null => {
            const overrideSource = overrides[`movie:${movie.parsedPath}`]?.metadataSourceOverride;
            const preferred = overrideSource ?? movie.metadataSource ?? globalSource;
            if (preferred === 'tvdb') return tvdbProvider;
            return tmdbProvider;
        };

        return { resolveShowProvider, resolveMovieProvider };
    }

    /** Enrich the TV library, the movie list, and audiobooks concurrently. */
    async enrichAll(library: IMediaLibrary, movies: IMediaObject[], audiobooks: IMediaAudiobook[] = [], isCancelled: () => boolean = () => false): Promise<void> {
        // Read global settings from the Redux store (credentials are handled in buildProviders).
        const settings = store.getState().settingsReducer;

        const { resolveShowProvider, resolveMovieProvider } = await this.buildProviders();

        if (isCancelled()) return;

        // First pass: collapse shows whose names differ only in punctuation / capitalisation.
        // This ensures we don't make separate requests for e.g. "Grey's Anatomy" and
        // "Greys Anatomy" that would otherwise remain as two distinct library entries.
        this.deduplicateByFuzzyName();
        // Re-read the library after fuzzy dedup so we don't enrich entries that were merged.
        const dedupedLibrary = store.getState().libraryReducer.mediaLibrary;

        // Audiobook cover art comes from the keyless iTunes Search API.
        const audiobookProvider = new AudiobookProvider();

        const showNames = Object.keys(dedupedLibrary);
        const metadataTotal = showNames.length + movies.length + audiobooks.length;
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
            this.enrichLibrary(dedupedLibrary, resolveShowProvider, progress, dispatchProgress, isCancelled),
            this.enrichMovies(movies, resolveMovieProvider, progress, dispatchProgress, isCancelled),
            this.enrichAudiobooks(audiobooks, audiobookProvider, progress, dispatchProgress, isCancelled),
        ]);
        for (const result of results) {
            if (result.status === 'rejected') {
                logger.error('MetadataService', 'enrichAll: a task was rejected', result.reason);
            }
        }

        if (isCancelled()) return;

        // After both TV and movie enrichment, collapse any shows that share the same
        // provider ID into a single library entry.
        this.deduplicateByProviderIds();

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
                await this.enrichEpisodes(enrichedLibrary, resolveShowProvider, fetchEpisodeNames, fetchEpisodeThumbnails, progress, dispatchEpisodeProgress, isCancelled);
            }
        }
    }

    /**
     * Enriches only the given shows and movies, then their episodes.
     *
     * Used by the bulk edit-mode actions, which act on an explicit selection rather than
     * the whole library.  Deliberately skips the fuzzy-name and provider-ID dedup passes
     * that {@link enrichAll} runs — those look at the entire library and could merge
     * entries the user never selected.
     *
     * Note this does *not* bypass the "poster already cached" skip in `enrichLibrary` /
     * `enrichMovies`; callers wanting a forced refetch must clear the cached poster state
     * for the selection first.
     *
     * @param showNames  Redux library keys of the selected shows.
     * @param moviePaths `parsedPath` values of the selected movies.
     */
    async enrichSelection(showNames: string[], moviePaths: string[], isCancelled: () => boolean = () => false): Promise<void> {
        const settings = store.getState().settingsReducer;
        const { resolveShowProvider, resolveMovieProvider } = await this.buildProviders();

        if (isCancelled()) return;

        // Read the subsets fresh so any state the caller just cleared is reflected here.
        const state = store.getState();
        const librarySubset: IMediaLibrary = {};
        for (const showName of showNames) {
            const show = state.libraryReducer.mediaLibrary[showName];
            if (show) librarySubset[showName] = show;
        }
        const moviesSubset = (state.libraryReducer.movies as IMediaObject[])
            .filter((movie) => moviePaths.includes(movie.parsedPath));

        const selectedShowNames = Object.keys(librarySubset);
        const metadataTotal = selectedShowNames.length + moviesSubset.length;
        if (metadataTotal === 0) {
            logger.log('MetadataService', 'enrichSelection: nothing to enrich');
            return;
        }
        logger.log('MetadataService', `enrichSelection: ${selectedShowNames.length} show(s), ${moviesSubset.length} movie(s)`);

        store.dispatch(setScanProgress({
            phase: 'enriching',
            filesFound: 0,
            thumbnailsDone: 0,
            thumbnailsTotal: 0,
            metadataDone: 0,
            metadataTotal,
        }));
        const progress = { done: 0 };
        const dispatchProgress = () => {
            store.dispatch(setScanProgress({
                phase: 'enriching',
                filesFound: 0,
                thumbnailsDone: 0,
                thumbnailsTotal: 0,
                metadataDone: progress.done,
                metadataTotal,
            }));
        };

        const results = await Promise.allSettled([
            this.enrichLibrary(librarySubset, resolveShowProvider, progress, dispatchProgress, isCancelled),
            this.enrichMovies(moviesSubset, resolveMovieProvider, progress, dispatchProgress, isCancelled),
        ]);
        for (const result of results) {
            if (result.status === 'rejected') {
                logger.error('MetadataService', 'enrichSelection: a task was rejected', result.reason);
            }
        }

        if (isCancelled()) return;

        // Episode-level enrichment for the selected shows only.
        const fetchEpisodeNames = settings.fetchEpisodeNames ?? true;
        const fetchEpisodeThumbnails = settings.fetchEpisodeThumbnails ?? true;
        if (selectedShowNames.length > 0 && (fetchEpisodeNames || fetchEpisodeThumbnails)) {
            // Re-read after poster enrichment so newly resolved provider IDs are picked up.
            const enrichedLibrary = store.getState().libraryReducer.mediaLibrary;
            const enrichedSubset: IMediaLibrary = {};
            let seasonCount = 0;
            for (const showName of selectedShowNames) {
                const show = enrichedLibrary[showName];
                if (!show) continue;
                enrichedSubset[showName] = show;
                if (show.ids.tmdb || show.ids.tvdb) seasonCount += Object.keys(show.seasons).length;
            }
            if (seasonCount > 0) {
                const episodeMetadataTotal = progress.done + seasonCount;
                const dispatchEpisodeProgress = () => {
                    store.dispatch(setScanProgress({
                        phase: 'enriching',
                        filesFound: 0,
                        thumbnailsDone: 0,
                        thumbnailsTotal: 0,
                        metadataDone: progress.done,
                        metadataTotal: episodeMetadataTotal,
                    }));
                };
                dispatchEpisodeProgress();
                await this.enrichEpisodes(enrichedSubset, resolveShowProvider, fetchEpisodeNames, fetchEpisodeThumbnails, progress, dispatchEpisodeProgress, isCancelled);
            }
        }

        logger.log('MetadataService', 'enrichSelection complete');
    }

    /** Fetch posters for every show in the library that does not yet have one cached. */
    async enrichLibrary(
        library: IMediaLibrary,
        resolveProvider: (showName: string, show: IMediaShow) => IMetadataProvider | null,
        progress: { done: number },
        dispatchProgress: () => void,
        isCancelled: () => boolean = () => false,
    ): Promise<void> {
        const showNames = Object.keys(library);
        logger.log('MetadataService', `enrichLibrary: ${showNames.length} show(s) to process`);

        const overrides = store.getState().libraryReducer.mediaOverrides;

        for (const showName of showNames) {
            if (isCancelled()) {
                logger.log('MetadataService', 'enrichLibrary: cancelled');
                break;
            }
            const show = library[showName];

            try {
                // Honour a user-set poster override (from manual rematch or local browse).
                const overridePoster = overrides[`show:${showName}`]?.poster;
                if (overridePoster) {
                    if (new File(overridePoster).exists) {
                        const existingId = show.ids.tmdb ?? show.ids.tvdb ?? '';
                        store.dispatch(updateShowMetadata({ showName, providerId: existingId, poster: overridePoster }));
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
                    providerId: bestResult.id,
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
        isCancelled: () => boolean = () => false,
    ): Promise<void> {
        logger.log('MetadataService', `enrichMovies: ${movies.length} movie(s) to process`);

        const overrides = store.getState().libraryReducer.mediaOverrides;

        for (const movie of movies) {
            if (isCancelled()) {
                logger.log('MetadataService', 'enrichMovies: cancelled');
                break;
            }
            const searchTitle = movie.title || movie.filename.replace(/\.[^.]+$/, '');
            try {
                // Honour a user-set poster override (from manual rematch or local browse).
                const overridePoster = overrides[`movie:${movie.parsedPath}`]?.poster;
                if (overridePoster) {
                    if (new File(overridePoster).exists) {
                        const existingId = movie.ids.tmdb ?? movie.ids.tvdb ?? '';
                        store.dispatch(updateMovieMetadata({ path: movie.path, providerId: existingId, poster: overridePoster }));
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
                const best = results[0];
                if (!best || !best.posterUrl) {
                    logger.log('MetadataService', `No poster found for movie "${searchTitle}" via ${provider.source}`);
                    continue;
                }

                const localUri = await provider.downloadMoviePoster(best.id, best.posterUrl);
                store.dispatch(updateMovieMetadata({ path: movie.path, providerId: best.id, source: provider.source, poster: localUri }));
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
     * Fetch cover art for every audiobook that does not yet have one cached.
     * Uses the keyless iTunes Search API via {@link AudiobookProvider}.
     */
    async enrichAudiobooks(
        audiobooks: IMediaAudiobook[],
        provider: AudiobookProvider,
        progress: { done: number },
        dispatchProgress: () => void,
        isCancelled: () => boolean = () => false,
    ): Promise<void> {
        logger.log('MetadataService', `enrichAudiobooks: ${audiobooks.length} audiobook(s) to process`);

        const overrides = store.getState().libraryReducer.mediaOverrides;

        for (const audiobook of audiobooks) {
            if (isCancelled()) {
                logger.log('MetadataService', 'enrichAudiobooks: cancelled');
                break;
            }
            const searchTitle = audiobook.title || audiobook.scannedTitle || '';
            try {
                // Honour a user-set cover override.
                const overrideCover = overrides[`audiobook:${audiobook.folderKey}`]?.poster;
                if (overrideCover) {
                    if (new File(overrideCover).exists) {
                        store.dispatch(updateAudiobookMetadata({ folderKey: audiobook.folderKey, poster: overrideCover }));
                        logger.log('MetadataService', `Applying cover override for audiobook "${audiobook.title}"`);
                        continue;
                    }
                }

                // Skip if we already have a locally cached cover for this audiobook.
                if (audiobook.poster) {
                    if (new File(audiobook.poster).exists) {
                        logger.log('MetadataService', `Skipping audiobook "${audiobook.title}" – cover already cached`);
                        continue;
                    }
                }

                if (!searchTitle.trim()) {
                    logger.log('MetadataService', 'Skipping audiobook with empty title');
                    continue;
                }

                const searchResults = await provider.searchAudiobook(searchTitle, audiobook.author);
                const best = searchResults[0];
                if (!best || !best.coverUrl) {
                    logger.log('MetadataService', `No cover found for audiobook "${searchTitle}"`);
                    continue;
                }

                const localUri = await provider.downloadCover(best.id, best.coverUrl);
                store.dispatch(updateAudiobookMetadata({
                    folderKey: audiobook.folderKey,
                    itunesId: best.id,
                    author: best.author,
                    poster: localUri,
                }));
                logger.log('MetadataService', `Audiobook "${searchTitle}" → iTunes ID ${best.id}, cover cached at ${localUri}`);
            } catch (e) {
                logger.warn('MetadataService', `Error enriching audiobook "${searchTitle}"`, e);
            } finally {
                progress.done++;
                dispatchProgress();
            }
        }

        logger.log('MetadataService', 'enrichAudiobooks complete');
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
        isCancelled: () => boolean = () => false,
    ): Promise<void> {
        logger.log('MetadataService', 'enrichEpisodes: starting episode metadata enrichment');

        for (const [showName, show] of Object.entries(library) as [string, IMediaShow][]) {
            if (isCancelled()) {
                logger.log('MetadataService', 'enrichEpisodes: cancelled');
                break;
            }
            const provider = resolveProvider(showName, show);
            if (!provider) continue;

            // Resolve the provider-specific show ID.
            const showProviderId = provider.source === 'tvdb' ? show.ids.tvdb : show.ids.tmdb;
            if (!showProviderId) continue;

            const sortedSeasons = Object.entries(show.seasons).sort(
                (a, b) => (a[1] as IMediaSeason).seasonNumber - (b[1] as IMediaSeason).seasonNumber,
            );

            for (const [seasonKey, season] of sortedSeasons as [string, IMediaSeason][]) {
                if (isCancelled()) break;
                try {
                    const providerEpisodes = await provider.fetchSeasonEpisodes(showProviderId, season.seasonNumber);

                    const episodeUpdates: { [episodeKey: string]: { resolvedTitle?: string; resolvedThumbnail?: string } } = {};

                    for (const epData of providerEpisodes) {
                        const episodeKey = `e${String(epData.episodeNumber).padStart(2, '0')}`;
                        if (!season.episodes[episodeKey]) continue;

                        const update: { resolvedTitle?: string; resolvedThumbnail?: string } = {};

                        if (fetchNames && epData.title) {
                            update.resolvedTitle = epData.title;
                        }

                        if (fetchThumbnails && epData.stillUrl) {
                            // Reuse cached thumbnail if it already exists on disk.
                            const existingThumbnail = season.episodes[episodeKey].resolvedThumbnail;
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
                            if (thumbnailUri) update.resolvedThumbnail = thumbnailUri;
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
    private deduplicateByProviderIds(): void {
        const library = store.getState().libraryReducer.mediaLibrary;

        for (const idField of ['tmdb', 'tvdb'] as const) {
            const byId = new Map<string, string[]>();
            for (const [showKey, show] of Object.entries(library) as [string, IMediaShow][]) {
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
