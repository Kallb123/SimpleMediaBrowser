import { FileInfo, getInfoAsync, StorageAccessFramework } from "expo-file-system";
import * as FileSystem from "expo-file-system";
import * as VideoThumbnails from "expo-video-thumbnails";
import { store } from "@/store/store";
import { setScanList, setMediaLibrary, setMovies, setIsScanning, setThumbnail } from "@/store/libraryReducer";
import type { IMediaLibrary, IMediaShow, IMediaSeason } from "@/store/libraryReducer";
import type { IMediaSource } from "@/store/settingsReducer";
import { logger } from "@/scripts/Logger";
import { MetadataService } from "@/scripts/MetadataService";

export interface IMediaObject {
    ids: {
        tvdb: string | null;
        imdb: string | null;
        tmdb: string | null;
    }
    episodeNumber: number;
    title: string;
    filename: string
    path: string
    parsedPath: string
    isDirectory: boolean
    poster: string;
}

// Re-export library types so other modules can import them from here
export type { IMediaLibrary, IMediaShow, IMediaSeason };

const VIDEO_EXTENSIONS = new Set([
    '.mkv', '.mp4', '.avi', '.mov', '.m4v', '.wmv', '.flv',
    '.ts', '.m2ts', '.webm', '.mpg', '.mpeg', '.3gp',
]);

/**
 * Extensions that are definitively non-directory file types.  Entries with
 * these extensions are skipped without attempting to recurse into them,
 * avoiding unnecessary readDirectoryAsync calls for subtitle/image/metadata
 * side-car files that live alongside video files.
 */
const NON_DIRECTORY_EXTENSIONS = new Set([
    '.srt', '.ass', '.ssa', '.vtt', '.sub', '.idx', // subtitles
    '.nfo', '.xml', '.json', '.txt', '.md',          // metadata / text
    '.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.tbn', // images
    '.mp3', '.aac', '.flac', '.ogg', '.wav', '.m4a', // audio-only
]);

/** Maximum folder depth to recurse into during a scan. Protects against infinite symlink loops. */
const MAX_SCAN_DEPTH = 8;

/** Local directory where poster images are persisted for offline use. */
const POSTERS_DIR = (FileSystem.Paths.document ?? '') + 'smb_posters/';

/**
 * Well-known filenames that represent a folder/series/movie poster image.
 * Checked case-insensitively during directory scanning.
 */
const POSTER_FILENAMES = new Set([
    'folder.jpg', 'folder.jpeg',
    'poster.jpg', 'poster.jpeg',
    'cover.jpg',  'cover.jpeg',
    'show.jpg',   'show.jpeg',
    'movie.jpg',  'movie.jpeg',
]);

/**
 * Copy a poster image (which may be a SAF content:// URI) into the app's
 * persistent smb_posters directory.  Returns the local file:// URI.
 * If the destination already exists it is returned immediately.
 */
async function copyLocalPoster(sourceUri: string, key: string): Promise<string> {
    const dirInfo = await FileSystem.getInfoAsync(POSTERS_DIR);
    if (!dirInfo.exists) {
        await FileSystem.makeDirectoryAsync(POSTERS_DIR, { intermediates: true });
    }
    const safeName = key.replace(/[^a-zA-Z0-9_-]/g, '_');
    const localPath = POSTERS_DIR + `${safeName}_local.jpg`;
    const existing = await FileSystem.getInfoAsync(localPath);
    if (existing.exists) {
        return localPath;
    }
    try {
        await FileSystem.copyAsync({ from: sourceUri, to: localPath });
    } catch {
        // copyAsync may not work with all SAF content:// URIs; fall back to base64 read/write.
        const base64 = await StorageAccessFramework.readAsStringAsync(sourceUri, {
            encoding: FileSystem.EncodingType.Base64,
        });
        await FileSystem.writeAsStringAsync(localPath, base64, {
            encoding: FileSystem.EncodingType.Base64,
        });
    }
    return localPath;
}

interface ParsedMetadata {
    showName: string;
    season: number;
    episode: number;
    title: string;
}

/** A file collected during recursive scanning, carrying its relative path parts. */
interface IScannedFile extends IMediaObject {
    /** Path segments relative to the root scan directory (does not include filename). */
    relativePathParts: string[];
}

export class FileScanner {
    static myInstance: FileScanner | null = null;

    _userID = "";

    /**
     * @returns {FileScanner}
     */
    static getInstance(): FileScanner {
        if (this.myInstance == null) {
            this.myInstance = new FileScanner();
        }

        return this.myInstance;
    }

    /** Scan all configured sources and update the Redux store with merged results. */
    async scanAllSources(sources: IMediaSource[]) {
        logger.log('FileScanner', `scanAllSources called with ${sources.length} source(s)`);
        sources.forEach((s, i) => logger.log('FileScanner', `  Source[${i}]: type=${s.contentType} uri=${s.uri}`));
        store.dispatch(setIsScanning(true));
        try {
        const tvSources = sources.filter((s) => s.contentType === 'tv');
        const movieSources = sources.filter((s) => s.contentType === 'movie');
        logger.log('FileScanner', `TV sources: ${tvSources.length}, Movie sources: ${movieSources.length}`);

        // Collect TV files from all TV sources and merge into one library
        const allTvFiles: IScannedFile[] = [];
        const tvPosterMap = new Map<string, string>();
        for (const src of tvSources) {
            logger.log('FileScanner', `Scanning TV source: ${src.uri}`);
            const { files, posterMap } = await this.collectAllMediaFiles(src.uri);
            logger.log('FileScanner', `  Found ${files.length} TV file(s) in source`);
            allTvFiles.push(...files);
            posterMap.forEach((uri, key) => { if (!tvPosterMap.has(key)) tvPosterMap.set(key, uri); });
        }
        const mergedLibrary = this.buildLibrary(allTvFiles, tvPosterMap);
        logger.log('FileScanner', `Built TV library with ${Object.keys(mergedLibrary).length} show(s) from ${allTvFiles.length} file(s)`);

        // Collect movie files from all movie sources
        const allMovieFiles: IScannedFile[] = [];
        const moviePosterMap = new Map<string, string>();
        for (const src of movieSources) {
            logger.log('FileScanner', `Scanning Movie source: ${src.uri}`);
            const { files, posterMap } = await this.collectAllMediaFiles(src.uri);
            logger.log('FileScanner', `  Found ${files.length} movie file(s) in source`);
            allMovieFiles.push(...files);
            posterMap.forEach((uri, key) => { if (!moviePosterMap.has(key)) moviePosterMap.set(key, uri); });
        }
        const movies = this.buildMovieList(allMovieFiles, moviePosterMap);
        logger.log('FileScanner', `Built movie list with ${movies.length} movie(s)`);

        // Build a combined scan list for diagnostic purposes
        const allScanUris: string[] = [
            ...allTvFiles.map((f) => f.path),
            ...allMovieFiles.map((f) => f.path),
        ];
        store.dispatch(setScanList(allScanUris));
        store.dispatch(setMediaLibrary(mergedLibrary));
        store.dispatch(setMovies(movies));
        logger.log('FileScanner', `Scan complete. Total media files dispatched: ${allScanUris.length}`);

        // Generate thumbnails for all scanned media files concurrently (skip already-cached paths)
        const existingThumbnails = store.getState().libraryReducer.thumbnails;
        const allMediaFiles: IMediaObject[] = [
            ...allTvFiles.map(({ relativePathParts, ...obj }) => obj),
            ...allMovieFiles.map(({ relativePathParts, ...obj }) => obj),
        ];
        const uncached = allMediaFiles.filter((m) => !existingThumbnails[m.path]);
        logger.log('FileScanner', `Generating thumbnails for ${uncached.length} uncached file(s) (${allMediaFiles.length - uncached.length} already cached)`);
        let thumbSuccess = 0;
        let thumbFail = 0;
        await Promise.allSettled(
            uncached.map(async (media) => {
                try {
                    const result = await VideoThumbnails.getThumbnailAsync(media.path, { time: 5000 });
                    store.dispatch(setThumbnail({ path: media.path, uri: result.uri }));
                    thumbSuccess++;
                } catch (e) {
                    thumbFail++;
                    logger.warn('FileScanner', `Thumbnail failed for ${media.filename}`, e);
                }
            }),
        );
        logger.log('FileScanner', `Thumbnail generation done: ${thumbSuccess} succeeded, ${thumbFail} failed`);

        // Enrich library with TMDB posters if an API key is configured
        const tmdbApiKey = store.getState().settingsReducer.tmdbApiKey;
        if (tmdbApiKey) {
            logger.log('FileScanner', 'TMDB API key found – starting metadata enrichment in background');
            const currentLibrary = store.getState().libraryReducer.mediaLibrary;
            const currentMovies = store.getState().libraryReducer.movies;
            MetadataService.getInstance().enrichAll(currentLibrary, currentMovies, tmdbApiKey).catch((e) => {
                logger.error('FileScanner', 'Metadata enrichment failed', e);
            });
        } else {
            logger.log('FileScanner', 'No TMDB API key configured – skipping metadata enrichment');
        }
        } catch (e) {
            logger.error('FileScanner', `scanAllSources threw an error`, e);
            throw e;
        } finally {
            store.dispatch(setIsScanning(false));
        }
    }

    async scanFolder(directory: string) {
        logger.log('FileScanner', `scanFolder: ${directory}`);
        const contents = await StorageAccessFramework.readDirectoryAsync(directory);
    
        const contentInfo = await Promise.all(contents.map(async (c) => {
            try {
              const info = await getInfoAsync(c);
              return info;
            } catch (e) {
    
            }
            const info: FileInfo = {uri: c, isDirectory: true, exists: true, size: 0, modificationTime: 0};
            return info;
        }));
    
        const allContents: IMediaObject[] = contentInfo.map((c) => {
          const uri = decodeURIComponent(c.uri);
          const filename = uri.substring(uri.lastIndexOf('/') + 1, uri.length)
          return {
            ids : {tvdb: null, imdb: null, tmdb: null},
            title: "",
            episodeNumber: 0,
            filename: filename,
            path: c.uri,
            parsedPath: uri,
            isDirectory: c.isDirectory,
            poster: '',
          }
        });
    
        const filtered = allContents.filter((c) => {
          if (c.filename.charAt(0) === '.') return null;
          return c;
        });

        store.dispatch(setScanList(filtered.map(f => f.path)));
        logger.log('FileScanner', `scanFolder filtered to ${filtered.length} item(s)`);

        // Recursively collect all media files and build the library
        const { files: allMediaFiles, posterMap } = await this.collectAllMediaFiles(directory);
        const library = this.buildLibrary(allMediaFiles, posterMap);
        store.dispatch(setMediaLibrary(library));

        return filtered;
    }

    // ─── Recursive collection ────────────────────────────────────────────────

    private async collectAllMediaFiles(
        rootDirectory: string,
    ): Promise<{ files: IScannedFile[]; posterMap: Map<string, string> }> {
        const result: IScannedFile[] = [];
        const posterMap = new Map<string, string>();
        await this.recursiveCollect(rootDirectory, [], result, posterMap, 0);
        return { files: result, posterMap };
    }

    private async recursiveCollect(
        directory: string,
        relativePathParts: string[],
        result: IScannedFile[],
        posterMap: Map<string, string>,
        depth: number,
    ): Promise<void> {
        if (depth > MAX_SCAN_DEPTH) {
            logger.warn('FileScanner', `Max scan depth (${MAX_SCAN_DEPTH}) reached at: ${directory}`);
            return;
        }

        let contents: string[];
        try {
            contents = await StorageAccessFramework.readDirectoryAsync(directory);
        } catch (e) {
            logger.warn('FileScanner', `Cannot read directory (depth=${depth}): ${directory}`, e);
            return; // Directory not accessible
        }
        logger.log('FileScanner', `Scanning dir (depth=${depth}, ${contents.length} entries): ${decodeURIComponent(directory).split('/').slice(-2).join('/')}`);

        // Resolve URIs in parallel. On Android SAF, getInfoAsync may return
        // { exists: false, isDirectory: undefined } for document URIs without
        // throwing, so we cannot rely on the isDirectory field to distinguish
        // files from directories. We use the file extension instead.
        const uriList = await Promise.all(
            contents.map(async (c) => {
                try {
                    const info = await getInfoAsync(c);
                    return info.uri; // may be a normalised URI (e.g. file://)
                } catch {
                    return c; // fall back to the original SAF document URI
                }
            }),
        );

        for (let i = 0; i < contents.length; i++) {
            const resolvedUri = uriList[i];
            const uri = decodeURIComponent(resolvedUri);
            const filename = uri.substring(uri.lastIndexOf('/') + 1);

            if (filename.charAt(0) === '.') continue; // Skip hidden entries

            if (this.isMediaFile(filename)) {
                result.push({
                    ids: { tvdb: null, imdb: null, tmdb: null },
                    title: '',
                    episodeNumber: 0,
                    filename,
                    path: resolvedUri,
                    parsedPath: uri,
                    isDirectory: false,
                    relativePathParts,
                    poster: '',
                });
            } else {
                const dotIdx = filename.lastIndexOf('.');
                const ext = dotIdx !== -1 ? filename.substring(dotIdx).toLowerCase() : '';

                // Detect well-known poster image filenames (folder.jpg, poster.jpg, etc.)
                // and copy them to persistent local storage so they survive without the
                // original storage permission.  Only record the first poster found per folder.
                if (relativePathParts.length >= 1 && POSTER_FILENAMES.has(filename.toLowerCase())) {
                    const folderKey = relativePathParts[0];
                    if (!posterMap.has(folderKey)) {
                        try {
                            const localUri = await copyLocalPoster(resolvedUri, folderKey);
                            posterMap.set(folderKey, localUri);
                            logger.log('FileScanner', `Local poster found for "${folderKey}": ${filename}`);
                        } catch (e) {
                            logger.warn('FileScanner', `Failed to copy local poster for "${folderKey}"`, e);
                        }
                    }
                    continue;
                }

                // Skip files with known non-directory extensions (subtitles,
                // images, metadata side-cars, etc.) to avoid the overhead of
                // an always-failing readDirectoryAsync call for each one.
                if (NON_DIRECTORY_EXTENSIONS.has(ext)) continue;

                // Treat anything else as a potential directory and recurse.
                // readDirectoryAsync will throw (and be caught) if the entry
                // is not actually a directory, so this is safe. This avoids
                // relying on getInfoAsync's isDirectory field, which is
                // unreliable for Android SAF document URIs.
                await this.recursiveCollect(resolvedUri, [...relativePathParts, filename], result, posterMap, depth + 1);
            }
        }
    }

    private isMediaFile(filename: string): boolean {
        const dotIndex = filename.lastIndexOf('.');
        if (dotIndex === -1) return false;
        const ext = filename.substring(dotIndex).toLowerCase();
        return VIDEO_EXTENSIONS.has(ext);
    }

    // ─── Movie list building ─────────────────────────────────────────────────

    buildMovieList(files: IScannedFile[], posterMap?: Map<string, string>): IMediaObject[] {
        return files.map((file) => {
            // Destructure out relativePathParts so it is not included in the stored IMediaObject
            const { relativePathParts, ...mediaObj } = file;
            const filenameTitle = file.filename.replace(/\.[^.]+$/, '').replace(/[\._-]+/g, ' ').trim();
            // When the movie file sits inside exactly one folder (common pattern:
            // "Movie Name (2023)/movie.mkv"), the folder name is typically the
            // canonical movie title, so prefer it over the filename.  For files
            // nested more than one level deep (e.g. extras/trailers inside a
            // movie folder) the filename is more specific and accurate.
            const title = relativePathParts.length === 1
                ? relativePathParts[0].replace(/[\._-]+/g, ' ').trim()
                : filenameTitle;
            // Apply folder poster if detected during scan.
            const poster = relativePathParts.length > 0
                ? (posterMap?.get(relativePathParts[0]) ?? '')
                : '';
            return { ...mediaObj, title, poster };
        });
    }

    // ─── Library building ────────────────────────────────────────────────────

    buildLibrary(files: IScannedFile[], posterMap?: Map<string, string>): IMediaLibrary {
        const library: IMediaLibrary = {};

        for (const file of files) {
            const metadata = this.parseMediaFile(file);
            if (!metadata) continue;

            const { showName, season, episode, title } = metadata;

            if (!library[showName]) {
                // Use the raw folder name (relativePathParts[0]) to look up any local
                // poster image found during the scan, since folder names may differ
                // from the parsed show name extracted from the episode filename.
                const folderKey = file.relativePathParts[0];
                const folderPoster = (folderKey && posterMap?.get(folderKey)) ?? '';
                library[showName] = {
                    ids: { tvdb: null, imdb: null, tmdb: null },
                    title: showName,
                    year: 0,
                    poster: folderPoster,
                    seasons: {},
                };
            }

            const seasonKey = `s${String(season).padStart(2, '0')}`;
            if (!library[showName].seasons[seasonKey]) {
                library[showName].seasons[seasonKey] = {
                    ids: { tvdb: null, imdb: null, tmdb: null },
                    seasonNumber: season,
                    episodes: {},
                };
            }

            const episodeKey = `e${String(episode).padStart(2, '0')}`;
            // Avoid overwriting an existing entry with the same key
            if (!library[showName].seasons[seasonKey].episodes[episodeKey]) {
                // Strip the internal relativePathParts field before storing
                const { relativePathParts, ...mediaObj } = file;
                library[showName].seasons[seasonKey].episodes[episodeKey] = {
                    ...mediaObj,
                    title: title || file.filename,
                    episodeNumber: episode,
                };
            }
        }

        return library;
    }

    private parseMediaFile(file: IScannedFile): ParsedMetadata | null {
        // Filename-based parsing takes priority (e.g. ShowName.S01E05.mkv)
        const fromFilename = this.parseFilename(file.filename);
        if (fromFilename) return fromFilename;

        // Fall back to inferring from the directory structure
        return this.parseFromPath(file);
    }

    // ─── Filename parser ─────────────────────────────────────────────────────

    /**
     * Parse common TV filename patterns:
     *   Show.Name.S01E05.Episode.Title.mkv   (SxxExx)
     *   Show.Name.1x05.Episode.Title.mkv     (NxNN)
     */
    parseFilename(filename: string): ParsedMetadata | null {
        // Remove extension for easier matching
        const withoutExt = filename.replace(/\.[^.]+$/, '');

        // SxxExx pattern — requires a separator before [Ss] so numeric show names don't false-match.
        // Season: up to 2 digits (realistic max ~99); episode: up to 3 digits (e.g. anime ep 100+).
        const sxxMatch = withoutExt.match(
            /^(.*?)[\.\s_-]+\b[Ss](\d{1,2})[Ee](\d{1,3})\b(?:[\.\s_-]+(.*))?$/,
        );
        if (sxxMatch) {
            return {
                showName: this.cleanName(sxxMatch[1]),
                season: parseInt(sxxMatch[2], 10),
                episode: parseInt(sxxMatch[3], 10),
                title: sxxMatch[4] ? this.cleanName(sxxMatch[4]) : '',
            };
        }

        // NxNN pattern — requires a separator before the season digit so numbers inside show names
        // don't false-match. Season: up to 2 digits; episode: up to 3 digits.
        const nxnnMatch = withoutExt.match(
            /^(.*?)[\.\s_-]+\b(\d{1,2})x(\d{1,3})\b(?:[\.\s_-]+(.*))?$/,
        );
        if (nxnnMatch) {
            return {
                showName: this.cleanName(nxnnMatch[1]),
                season: parseInt(nxnnMatch[2], 10),
                episode: parseInt(nxnnMatch[3], 10),
                title: nxnnMatch[4] ? this.cleanName(nxnnMatch[4]) : '',
            };
        }

        return null;
    }

    // ─── Path-based parser ───────────────────────────────────────────────────

    /**
     * Infer show/season/episode from the directory hierarchy without relying on
     * any user-configured view/organisation mode.  The scanner always recurses
     * all directories; the display layer (viewType) decides how the resulting
     * library data is presented to the user.
     *
     * Heuristics applied in order of directory depth:
     *   2+ parts – parts[0] = show name, parts[1] = season folder
     *   1 part   – parts[0] = show name, season defaults to 1
     *   0 parts  – file sits directly in the root; no folder context, skip
     */
    private parseFromPath(file: IScannedFile): ParsedMetadata | null {
        const parts = file.relativePathParts;
        const baseTitle = file.filename.replace(/\.[^.]+$/, '').replace(/[\._-]+/g, ' ').trim();

        // Try to extract an episode number from the filename.
        // Word boundary (\b) prevents matching digits inside unrelated words.
        // [Ee][Pp]? optionally matches 'p/P', covering 'e5', 'E5', 'ep5', 'EP5', etc.
        const epMatch = file.filename.match(/\b[Ee][Pp]?(\d{1,3})\b/);
        const episode = epMatch ? parseInt(epMatch[1], 10) : 0;

        if (parts.length >= 2) {
            // rootDir/ShowName/SeasonFolder/episode.mkv  (or deeper)
            const showName = parts[0];
            const seasonFolder = parts[1];
            // Prefer an explicit 'Season N' word; otherwise take the first digit run.
            const namedSeasonMatch = seasonFolder.match(/[Ss]eason\s*(\d+)/i);
            const rawNumberMatch = seasonFolder.match(/(\d+)/);
            const seasonStr = namedSeasonMatch
                ? namedSeasonMatch[1]
                : rawNumberMatch?.[1] ?? '1';
            const season = parseInt(seasonStr, 10);
            return { showName, season, episode, title: baseTitle };
        }

        if (parts.length === 1) {
            // rootDir/ShowName/episode.mkv
            return { showName: parts[0], season: 1, episode, title: baseTitle };
        }

        // File is directly in the root scan directory with no enclosing folder;
        // there is no structural context from which to derive a show name.
        return null;
    }

    // ─── Utilities ───────────────────────────────────────────────────────────

    /** Replace dots/underscores with spaces and trim the string. */
    private cleanName(raw: string): string {
        return raw.replace(/[\._]+/g, ' ').trim();
    }

    getUserID() {
        return this._userID;
    }

    setUserID(id: string) {
        this._userID = id;
    }
}
