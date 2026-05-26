/**
 * ImportExportService — import/export functionality for SimpleMediaBrowser.
 *
 * Provides three operations:
 *  1. exportJson  – save settings, overrides and/or matched metadata to a JSON file.
 *  2. importJson  – restore state from a previously exported JSON file.
 *  3. exportToFilesystem – write smb.json metadata, poster images and episode thumbnails
 *                          alongside the media files in the configured SAF directories.
 */

import { File } from 'expo-file-system';
import { StorageAccessFramework } from 'expo-file-system/legacy';
import * as DocumentPicker from 'expo-document-picker';
import { store } from '@/store/store';
import {
    setMediaOverride,
    clearAllOverrides,
    updateShowMetadata,
    updateMovieMetadata,
    updateSeasonEpisodeMetadata,
} from '@/store/libraryReducer';
import type { IMediaOverride, IMediaShow } from '@/store/libraryReducer';
import {
    setDataSource,
    setMediaStructure,
    setViewOrientation,
    setViewScale,
    setTmdbApiKey,
    setTvdbApiKey,
    setTvdbPin,
    setDefaultPage,
    setEnablePosterFetching,
    setEnableThumbnailGeneration,
    setRescanOnStartup,
    setFetchEpisodeNames,
    setFetchEpisodeThumbnails,
    setAppColorScheme,
} from '@/store/settingsReducer';
import type { IMediaSource, dataSources, viewTypes, viewOrientations, defaultPages, appColorSchemes } from '@/store/settingsReducer';
import { logger } from '@/scripts/Logger';
import type { SmbJsonData, SmbJsonShowData, SmbJsonMovieData } from '@/scripts/SmbTypes';
import { smbThumbFilename } from '@/scripts/SmbTypes';

// Re-export smb.json types so callers can import them from this module.
export type { SmbJsonData, SmbJsonShowData, SmbJsonMovieData };
export type { SmbJsonEpisodeData, SmbJsonSeasonData } from '@/scripts/SmbTypes';

/**
 * StorageAccessFramework.writeAsStringAsync accepts an encoding option at runtime,
 * but the TypeScript declaration omits it. This typed wrapper encapsulates the cast
 * in one place so callers stay clean.
 */
async function writeSafBase64(uri: string, base64Content: string): Promise<void> {
    const writeFn = StorageAccessFramework.writeAsStringAsync as (
        uri: string,
        content: string,
        options: { encoding: string },
    ) => Promise<void>;
    await writeFn(uri, base64Content, { encoding: 'base64' });
}

// ─── SAF helpers ─────────────────────────────────────────────────────────────

/**
 * Returns the SAF URI of the parent directory for a given file URI.
 *
 * Example:
 *   …/document/primary%3ATV%2FShow%2FSeason1%2FEp.mkv
 *   → …/document/primary%3ATV%2FShow%2FSeason1
 */
export function getSafParentDirUri(fileUri: string): string | null {
    const docMarker = '/document/';
    const docIdx = fileUri.indexOf(docMarker);
    if (docIdx === -1) return null;
    const prefix = fileUri.substring(0, docIdx + docMarker.length);
    const encodedDocId = fileUri.substring(docIdx + docMarker.length);
    const docId = decodeURIComponent(encodedDocId);
    const lastSlash = docId.lastIndexOf('/');
    if (lastSlash === -1) return null;
    return prefix + encodeURIComponent(docId.substring(0, lastSlash));
}

/**
 * Returns the SAF URI for the first-level subfolder (show/movie folder) that
 * contains the given file, relative to the matching TV source root.
 */
export function getShowFolderUri(episodePath: string, mediaSources: IMediaSource[]): string | null {
    for (const source of mediaSources) {
        if (source.contentType !== 'tv') continue;
        const treeMatch = source.uri.match(/^content:\/\/([^/]+)\/tree\/([^/]+)$/);
        if (!treeMatch) continue;
        const authority = treeMatch[1];
        const encodedTreeDocId = treeMatch[2];
        const expectedPrefix = `content://${authority}/tree/${encodedTreeDocId}/document/`;
        if (!episodePath.startsWith(expectedPrefix)) continue;
        const encodedEpisodeDocId = episodePath.substring(expectedPrefix.length);
        const episodeDocId = decodeURIComponent(encodedEpisodeDocId);
        const treeDocId = decodeURIComponent(encodedTreeDocId);
        if (!episodeDocId.startsWith(treeDocId + '/')) continue;
        const relativePath = episodeDocId.substring(treeDocId.length + 1);
        const showFolderName = relativePath.split('/')[0];
        if (!showFolderName) continue;
        const showDocId = `${treeDocId}/${showFolderName}`;
        return `content://${authority}/tree/${encodedTreeDocId}/document/${encodeURIComponent(showDocId)}`;
    }
    return null;
}

/**
 * Returns the number of path segments between a file and its SAF source root.
 * Returns -1 when the file is not within any of the provided sources.
 *
 * Examples (relative to source root):
 *   "movie.mkv"              → 1  (movie directly in source root)
 *   "Avatar/avatar.mkv"      → 2  (movie in subfolder)
 */
function getRelativeDepth(filePath: string, mediaSources: IMediaSource[]): number {
    for (const source of mediaSources) {
        const treeMatch = source.uri.match(/^content:\/\/([^/]+)\/tree\/([^/]+)$/);
        if (!treeMatch) continue;
        const authority = treeMatch[1];
        const encodedTreeDocId = treeMatch[2];
        const expectedPrefix = `content://${authority}/tree/${encodedTreeDocId}/document/`;
        if (!filePath.startsWith(expectedPrefix)) continue;
        const encodedDocId = filePath.substring(expectedPrefix.length);
        const docId = decodeURIComponent(encodedDocId);
        const treeDocId = decodeURIComponent(encodedTreeDocId);
        if (!docId.startsWith(treeDocId + '/')) continue;
        const relativePath = docId.substring(treeDocId.length + 1);
        return relativePath.split('/').length;
    }
    return -1;
}

/**
 * Write (or overwrite) a named file inside a SAF directory.
 * Checks whether the file already exists by listing the directory first;
 * overwrites in-place when found, otherwise creates a new file.
 */
async function writeToSafDir(
    dirUri: string,
    filename: string,
    content: string,
    mimeType: string,
    encoding: 'utf8' | 'base64' = 'utf8',
): Promise<void> {
    let fileUri: string | null = null;
    try {
        const entries = await StorageAccessFramework.readDirectoryAsync(dirUri);
        for (const uri of entries) {
            const decoded = decodeURIComponent(uri);
            if (decoded.endsWith('/' + filename)) {
                fileUri = uri;
                break;
            }
        }
    } catch {
        // Proceed to create; listing may fail on some SAF providers.
    }
    if (!fileUri) {
        fileUri = await StorageAccessFramework.createFileAsync(dirUri, filename, mimeType);
    }
    if (encoding === 'base64') {
        await writeSafBase64(fileUri, content);
    } else {
        await StorageAccessFramework.writeAsStringAsync(fileUri, content);
    }
}

/**
 * Finds the show folder SAF URI by scanning the show's episodes for a known path.
 */
function getShowFolderUriFromShow(show: IMediaShow, mediaSources: IMediaSource[]): string | null {
    for (const season of Object.values(show.seasons)) {
        for (const ep of Object.values(season.episodes)) {
            const folderUri = getShowFolderUri(ep.path, mediaSources);
            if (folderUri) return folderUri;
        }
    }
    return null;
}

// ─── JSON export options ──────────────────────────────────────────────────────

export interface JsonExportOptions {
    /** Include app settings (API keys, view options, etc.) in the export. */
    includeSettings: boolean;
    /** Include all user-defined media overrides (title, sort title, poster, etc.). */
    includeOverrides: boolean;
    /** Include matched metadata IDs and episode names from enrichment. */
    includeMatches: boolean;
}

// Internal shape of the exported JSON file
interface ShowMatchExport {
    ids: { tmdb: string | null; tvdb: string | null; imdb: string | null };
    title: string;
    year: number;
    seasons: Record<string, { episodes: Record<string, { episodeTitle?: string }> }>;
}

interface MovieMatchExport {
    parsedPath: string;
    ids: { tmdb: string | null; tvdb: string | null; imdb: string | null };
    title: string;
}

interface SmbExportJson {
    smbVersion: 1;
    exportedAt: string;
    settings?: Record<string, unknown>;
    overrides?: Record<string, IMediaOverride>;
    matches?: {
        shows: Record<string, ShowMatchExport>;
        movies: MovieMatchExport[];
    };
}

// ─── JSON export ─────────────────────────────────────────────────────────────

/**
 * Builds a JSON export blob from the current Redux state and prompts the user
 * to choose a save directory.  The file is named
 * `smb_export_YYYY-MM-DDTHH-MM-SS.json`.
 *
 * Note: media source URIs and the settings password are intentionally excluded
 * from the export because they are device-specific or sensitive.
 */
export async function exportJson(options: JsonExportOptions): Promise<void> {
    const state = store.getState();
    const payload: SmbExportJson = {
        smbVersion: 1,
        exportedAt: new Date().toISOString(),
    };

    if (options.includeSettings) {
        const s = state.settingsReducer;
        payload.settings = {
            dataSource: s.dataSource,
            viewType: s.viewType,
            viewScale: s.viewScale,
            viewOrientation: s.viewOrientation,
            tmdbApiKey: s.tmdbApiKey,
            tvdbApiKey: s.tvdbApiKey,
            tvdbPin: s.tvdbPin,
            defaultPage: s.defaultPage,
            enablePosterFetching: s.enablePosterFetching,
            enableThumbnailGeneration: s.enableThumbnailGeneration,
            rescanOnStartup: s.rescanOnStartup,
            fetchEpisodeNames: s.fetchEpisodeNames,
            fetchEpisodeThumbnails: s.fetchEpisodeThumbnails,
            appColorScheme: s.appColorScheme,
        };
    }

    if (options.includeOverrides) {
        payload.overrides = { ...state.libraryReducer.mediaOverrides };
    }

    if (options.includeMatches) {
        const library = state.libraryReducer.mediaLibrary;
        const movies = state.libraryReducer.movies;
        const shows: Record<string, ShowMatchExport> = {};

        for (const [showName, show] of Object.entries(library)) {
            if (!show.ids.tmdb && !show.ids.tvdb && !show.ids.imdb) continue;
            const seasons: ShowMatchExport['seasons'] = {};
            for (const [seasonKey, season] of Object.entries(show.seasons)) {
                const episodes: Record<string, { episodeTitle?: string }> = {};
                let hasEpData = false;
                for (const [epKey, ep] of Object.entries(season.episodes)) {
                    if (ep.tmdbTitle) {
                        episodes[epKey] = { episodeTitle: ep.tmdbTitle };
                        hasEpData = true;
                    }
                }
                if (hasEpData) seasons[seasonKey] = { episodes };
            }
            shows[showName] = {
                ids: { tmdb: show.ids.tmdb, tvdb: show.ids.tvdb, imdb: show.ids.imdb },
                title: show.title,
                year: show.year,
                seasons,
            };
        }

        const movieMatches: MovieMatchExport[] = movies
            .filter((m) => m.ids.tmdb || m.ids.tvdb || m.ids.imdb)
            .map((m) => ({
                parsedPath: m.parsedPath,
                ids: { tmdb: m.ids.tmdb, tvdb: m.ids.tvdb, imdb: m.ids.imdb },
                title: m.title,
            }));

        payload.matches = { shows, movies: movieMatches };
    }

    const dirResult = await StorageAccessFramework.requestDirectoryPermissionsAsync();
    if (!dirResult.granted) {
        throw new Error('Directory permission denied');
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const filename = `smb_export_${timestamp}.json`;
    await writeToSafDir(dirResult.directoryUri, filename, JSON.stringify(payload, null, 2), 'application/json');

    logger.log('ImportExport', `Exported JSON state to ${filename}`);
}

// ─── JSON import ─────────────────────────────────────────────────────────────

/**
 * Prompts the user to select an smb JSON export file and applies the contained
 * data to the Redux store.
 *
 * Returns the list of sections that were successfully applied.
 */
export async function importJson(): Promise<{ applied: string[] }> {
    const result = await DocumentPicker.getDocumentAsync({
        type: 'application/json',
        copyToCacheDirectory: true,
    });

    if (result.canceled || !result.assets?.[0]) {
        throw new Error('No file selected');
    }

    const jsonText = await new File(result.assets[0].uri).text();
    const data = JSON.parse(jsonText) as SmbExportJson;

    if (!data || typeof data !== 'object' || data.smbVersion !== 1) {
        throw new Error('Invalid or unsupported export file format');
    }

    const applied: string[] = [];

    if (data.settings) {
        const s = data.settings as Record<string, unknown>;
        if (typeof s.dataSource === 'string') store.dispatch(setDataSource(s.dataSource as dataSources));
        if (typeof s.viewType === 'string') store.dispatch(setMediaStructure(s.viewType as viewTypes));
        if (typeof s.viewScale === 'number') store.dispatch(setViewScale(s.viewScale));
        if (typeof s.viewOrientation === 'string') store.dispatch(setViewOrientation(s.viewOrientation as viewOrientations));
        if (s.tmdbApiKey === null || typeof s.tmdbApiKey === 'string') store.dispatch(setTmdbApiKey(s.tmdbApiKey as string | null));
        if (s.tvdbApiKey === null || typeof s.tvdbApiKey === 'string') store.dispatch(setTvdbApiKey(s.tvdbApiKey as string | null));
        if (s.tvdbPin === null || typeof s.tvdbPin === 'string') store.dispatch(setTvdbPin(s.tvdbPin as string | null));
        if (typeof s.defaultPage === 'string') store.dispatch(setDefaultPage(s.defaultPage as defaultPages));
        if (typeof s.enablePosterFetching === 'boolean') store.dispatch(setEnablePosterFetching(s.enablePosterFetching));
        if (typeof s.enableThumbnailGeneration === 'boolean') store.dispatch(setEnableThumbnailGeneration(s.enableThumbnailGeneration));
        if (typeof s.rescanOnStartup === 'boolean') store.dispatch(setRescanOnStartup(s.rescanOnStartup));
        if (typeof s.fetchEpisodeNames === 'boolean') store.dispatch(setFetchEpisodeNames(s.fetchEpisodeNames));
        if (typeof s.fetchEpisodeThumbnails === 'boolean') store.dispatch(setFetchEpisodeThumbnails(s.fetchEpisodeThumbnails));
        if (typeof s.appColorScheme === 'string') store.dispatch(setAppColorScheme(s.appColorScheme as appColorSchemes));
        applied.push('settings');
    }

    if (data.overrides && typeof data.overrides === 'object') {
        store.dispatch(clearAllOverrides());
        for (const [key, override] of Object.entries(data.overrides)) {
            if (override && typeof override === 'object') {
                store.dispatch(setMediaOverride({ key, override: override as IMediaOverride }));
            }
        }
        applied.push('overrides');
    }

    if (data.matches && typeof data.matches === 'object') {
        const { shows, movies } = data.matches;

        if (shows && typeof shows === 'object') {
            for (const [showName, match] of Object.entries(shows)) {
                if (!match || typeof match !== 'object') continue;
                if (match.ids?.tmdb) {
                    store.dispatch(updateShowMetadata({
                        showName,
                        providerId: match.ids.tmdb,
                        source: 'tmdb',
                        title: match.title,
                        year: match.year,
                    }));
                }
                if (match.ids?.tvdb) {
                    store.dispatch(updateShowMetadata({
                        showName,
                        providerId: match.ids.tvdb,
                        source: 'tvdb',
                    }));
                }
                for (const [seasonKey, season] of Object.entries(match.seasons ?? {})) {
                    if (!season?.episodes) continue;
                    const episodeUpdates: Record<string, { tmdbTitle?: string }> = {};
                    for (const [epKey, ep] of Object.entries(season.episodes)) {
                        if (ep?.episodeTitle) episodeUpdates[epKey] = { tmdbTitle: ep.episodeTitle };
                    }
                    if (Object.keys(episodeUpdates).length > 0) {
                        store.dispatch(updateSeasonEpisodeMetadata({ showName, seasonKey, episodeUpdates }));
                    }
                }
            }
        }

        if (Array.isArray(movies)) {
            const currentMovies = store.getState().libraryReducer.movies;
            const movieByParsedPath = new Map(currentMovies.map((m) => [m.parsedPath, m]));
            for (const match of movies) {
                if (!match?.parsedPath) continue;
                const movie = movieByParsedPath.get(match.parsedPath);
                if (!movie) continue;
                if (match.ids?.tmdb) {
                    store.dispatch(updateMovieMetadata({ path: movie.path, providerId: match.ids.tmdb, source: 'tmdb' }));
                }
                if (match.ids?.tvdb) {
                    store.dispatch(updateMovieMetadata({ path: movie.path, providerId: match.ids.tvdb, source: 'tvdb' }));
                }
            }
        }

        applied.push('matches');
    }

    logger.log('ImportExport', `Import complete. Applied: ${applied.join(', ')}`);
    return { applied };
}

// ─── Filesystem export ────────────────────────────────────────────────────────

export interface FilesystemExportResult {
    showsExported: number;
    moviesExported: number;
    failed: number;
    skipped: number;
}

/**
 * Writes smb.json metadata files, poster images and episode thumbnails
 * alongside the media files in the SAF-accessible library directories.
 *
 * smb.json is written to:
 *   <show folder>/smb.json         – contains show IDs, episode titles
 *   <movie folder>/smb.json        – contains movie IDs
 *
 * Poster images (poster.jpg) are written to the show/movie folder when the
 * app has a locally cached provider poster.
 *
 * Episode thumbnails are written to:
 *   <season folder>/smb_thumb_<seasonKey><episodeKey>.jpg
 *   e.g. Season 1/smb_thumb_s01e01.jpg
 *
 * Movies placed directly in the source root (no subfolder) are skipped since
 * there is no unambiguous folder to write the smb.json to.
 *
 * The written files are readable by FileScanner during the next library scan.
 */
export async function exportToFilesystem(mediaSources: IMediaSource[]): Promise<FilesystemExportResult> {
    const state = store.getState();
    const library = state.libraryReducer.mediaLibrary;
    const movies = state.libraryReducer.movies;
    const mediaOverrides = state.libraryReducer.mediaOverrides;

    let showsExported = 0;
    let moviesExported = 0;
    let failed = 0;
    let skipped = 0;

    // ── TV shows ──────────────────────────────────────────────────────────────
    for (const [showName, show] of Object.entries(library)) {
        try {
            const showFolderUri = getShowFolderUriFromShow(show, mediaSources);
            if (!showFolderUri) {
                skipped++;
                continue;
            }

            const smbShow: SmbJsonShowData = {
                smbVersion: 1,
                type: 'show',
                title: show.title || undefined,
                year: show.year || undefined,
                ids: { tmdb: show.ids.tmdb, tvdb: show.ids.tvdb, imdb: show.ids.imdb },
                metadataSource: show.metadataSource,
            };

            const override = mediaOverrides[`show:${showName}`];
            if (override) {
                smbShow.overrides = {
                    title: override.title,
                    sortTitle: override.sortTitle,
                    year: override.year,
                    hidden: override.hidden,
                };
            }

            // Build seasons block with episode titles and thumbnail file references
            const seasons: Required<SmbJsonShowData>['seasons'] = {};
            let hasSeasonData = false;
            for (const [seasonKey, season] of Object.entries(show.seasons)) {
                const episodes: Record<string, { title?: string; thumbnailFile?: string }> = {};
                let hasEpData = false;
                for (const [epKey, ep] of Object.entries(season.episodes)) {
                    const epTitle = ep.tmdbTitle;
                    const thumbName = ep.tmdbThumbnail ? smbThumbFilename(seasonKey, epKey) : undefined;
                    if (epTitle || thumbName) {
                        episodes[epKey] = {};
                        if (epTitle) episodes[epKey].title = epTitle;
                        if (thumbName) episodes[epKey].thumbnailFile = thumbName;
                        hasEpData = true;
                    }
                }
                if (hasEpData) {
                    seasons[seasonKey] = { episodes };
                    hasSeasonData = true;
                }
            }
            if (hasSeasonData) smbShow.seasons = seasons;

            // Skip shows with no useful data to export
            const hasIds = !!(smbShow.ids.tmdb || smbShow.ids.tvdb);
            if (!hasIds && !hasSeasonData && !override) {
                skipped++;
                continue;
            }

            await writeToSafDir(showFolderUri, 'smb.json', JSON.stringify(smbShow, null, 2), 'application/json');

            // Copy provider poster to show folder
            if (show.poster?.startsWith('file://')) {
                try {
                    const base64 = await new File(show.poster).base64();
                    await writeToSafDir(showFolderUri, 'poster.jpg', base64, 'image/jpeg', 'base64');
                } catch (e) {
                    logger.warn('ImportExport', `Could not copy poster for "${showName}"`, e);
                }
            }

            // Copy episode thumbnails to their season directories
            for (const [seasonKey, season] of Object.entries(show.seasons)) {
                for (const [epKey, ep] of Object.entries(season.episodes)) {
                    if (!ep.tmdbThumbnail?.startsWith('file://')) continue;
                    const seasonDirUri = getSafParentDirUri(ep.path);
                    if (!seasonDirUri) continue;
                    const thumbName = smbThumbFilename(seasonKey, epKey);
                    try {
                        const base64 = await new File(ep.tmdbThumbnail).base64();
                        await writeToSafDir(seasonDirUri, thumbName, base64, 'image/jpeg', 'base64');
                    } catch (e) {
                        logger.warn('ImportExport', `Could not copy thumbnail ${thumbName} for "${showName}"`, e);
                    }
                }
            }

            showsExported++;
        } catch (e) {
            logger.warn('ImportExport', `Failed to export show "${showName}"`, e);
            failed++;
        }
    }

    // ── Movies ────────────────────────────────────────────────────────────────
    for (const movie of movies) {
        try {
            // Skip movies directly in the source root (no subfolder to write smb.json to)
            if (getRelativeDepth(movie.path, mediaSources) === 1) {
                skipped++;
                continue;
            }

            const movieFolderUri = getSafParentDirUri(movie.path);
            if (!movieFolderUri) {
                skipped++;
                continue;
            }

            const smbMovie: SmbJsonMovieData = {
                smbVersion: 1,
                type: 'movie',
                title: movie.title || undefined,
                ids: { tmdb: movie.ids.tmdb, tvdb: movie.ids.tvdb, imdb: movie.ids.imdb },
            };

            const override = mediaOverrides[`movie:${movie.parsedPath}`];
            if (override) {
                smbMovie.overrides = {
                    title: override.title,
                    sortTitle: override.sortTitle,
                    year: override.year,
                    hidden: override.hidden,
                };
            }

            const hasIds = !!(smbMovie.ids.tmdb || smbMovie.ids.tvdb);
            if (!hasIds && !override) {
                skipped++;
                continue;
            }

            await writeToSafDir(movieFolderUri, 'smb.json', JSON.stringify(smbMovie, null, 2), 'application/json');

            // Copy provider poster to movie folder
            if (movie.poster?.startsWith('file://')) {
                try {
                    const base64 = await new File(movie.poster).base64();
                    await writeToSafDir(movieFolderUri, 'poster.jpg', base64, 'image/jpeg', 'base64');
                } catch (e) {
                    logger.warn('ImportExport', `Could not copy poster for movie "${movie.title}"`, e);
                }
            }

            moviesExported++;
        } catch (e) {
            logger.warn('ImportExport', `Failed to export movie "${movie.title}"`, e);
            failed++;
        }
    }

    logger.log('ImportExport', `Filesystem export complete: ${showsExported} shows, ${moviesExported} movies, ${failed} failed, ${skipped} skipped`);
    return { showsExported, moviesExported, failed, skipped };
}
