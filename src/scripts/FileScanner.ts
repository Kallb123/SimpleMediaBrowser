import { Directory, File, Paths } from "expo-file-system";
import { StorageAccessFramework } from "expo-file-system/legacy";
import { createVideoPlayer } from "expo-video";
import type { VideoThumbnail } from "expo-video";
import { ImageManipulator, SaveFormat } from "expo-image-manipulator";
import { store } from "@/store/store";
import { setScanList, setMediaLibrary, setMovies, setIsScanning, setScanProgress, mergeEpisodeBatch, appendMovieBatch, updateShowPoster, setMoviePoster } from "@/store/libraryReducer";
import type { IMediaLibrary, IMediaShow, IMediaSeason, MergeEpisodePayload, dataSources } from "@/store/libraryReducer";
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
    /**
     * Display title for the episode or movie.  For TV episodes this is the
     * scanned title derived from the local filename (see also `scannedTitle`).
     * Prefer `tmdbTitle` for display when it is available.
     */
    title: string;
    /**
     * The title as parsed from the local filename or folder structure during
     * scanning.  Stored separately so the TMDB-sourced title (`tmdbTitle`) can
     * be displayed without losing the original locally-derived value.
     */
    scannedTitle?: string;
    /**
     * Episode name fetched from TMDB (TV episodes only).
     * When present, the UI prefers this over the locally-scanned title.
     */
    tmdbTitle?: string;
    /**
     * Local file URI for the episode still image downloaded from TMDB.
     * TV episodes only.  Used as the episode "poster" in the grid/list UI.
     */
    tmdbThumbnail?: string;
    filename: string
    path: string
    parsedPath: string
    isDirectory: boolean
    poster: string;
    /**
     * Metadata provider configured on the source folder this item was scanned
     * from.  Set during collection so MetadataService can select the right
     * provider without needing a per-item override.  Absent means use the
     * global setting.
     */
    metadataSource?: dataSources;
}

// Re-export library types so other modules can import them from here
export type { IMediaLibrary, IMediaShow, IMediaSeason };

/**
 * Cross-session cache of thumbnail sources keyed by media file path.
 *
 * Values are either:
 * - A `string` local `file://` URI loaded from the persistent on-disk index at
 *   startup, or written there after a thumbnail is first generated.
 * - A `VideoThumbnail` SharedRef for thumbnails whose disk-persist step failed
 *   (in-session fallback only; they will be regenerated on the next restart).
 *
 * Because `VideoThumbnail` is non-serialisable it cannot be stored in Redux;
 * string URIs for thumbnails that were already persisted are used instead.
 */
export const thumbnailCache = new Map<string, VideoThumbnail | string>();

/** Persistent directory where generated thumbnail JPEG files are stored. */
const THUMBNAILS_DIR = new Directory(Paths.document, 'smb_thumbnails');

/** JSON index file that maps video-file paths to their thumbnail file URIs. */
const THUMBNAIL_INDEX_FILE = new File(THUMBNAILS_DIR, 'index.json');

/** Maps video-file path → local thumbnail file URI (persisted across restarts). */
type ThumbnailIndex = Record<string, string>;

/**
 * Returns a short, stable filename for the thumbnail corresponding to `videoPath`.
 *
 * Uses two independent DJB2-family hash passes over the full path to give a
 * 128-bit-equivalent name (two independent 32-bit values) so the probability
 * of any collision in even a very large library is negligible.  The sanitised
 * filename component is appended as a final disambiguator for human readability.
 */
function thumbnailFilename(videoPath: string): string {
    let h1 = 5381;
    let h2 = 0x811c9dc5;
    for (let i = 0; i < videoPath.length; i++) {
        const c = videoPath.charCodeAt(i);
        h1 = (((h1 << 5) + h1) ^ c) | 0;   // DJB2xor variant
        h2 = ((h2 ^ c) * 0x01000193) | 0;   // FNV-1a 32-bit variant
    }
    const segment = Math.abs(h1).toString(16).padStart(8, '0') +
                    Math.abs(h2).toString(16).padStart(8, '0');
    const filename = videoPath.substring(videoPath.lastIndexOf('/') + 1);
    const safe = filename.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 40);
    return `thumb_${segment}_${safe}.jpg`;
}

/**
 * Reads the on-disk thumbnail index and pre-populates {@link thumbnailCache}
 * with string URIs for files that already have a persisted thumbnail.
 * Returns the parsed index (or an empty object on any error).
 */
function loadThumbnailIndex(): ThumbnailIndex {
    try {
        if (!THUMBNAIL_INDEX_FILE.exists) return {};
        const json = THUMBNAIL_INDEX_FILE.textSync();
        const index: ThumbnailIndex = JSON.parse(json);
        let count = 0;
        for (const [videoPath, thumbUri] of Object.entries(index)) {
            thumbnailCache.set(videoPath, thumbUri);
            count++;
        }
        logger.log('FileScanner', `Loaded ${count} thumbnail(s) from disk cache`);
        return index;
    } catch (e) {
        logger.warn('FileScanner', 'Failed to load thumbnail index from disk', e);
        return {};
    }
}

/**
 * Persists the given thumbnail index to disk so it can be reloaded next session.
 * Safe to call with an empty object (clears the index file).
 */
function saveThumbnailIndex(index: ThumbnailIndex): void {
    try {
        if (!THUMBNAILS_DIR.exists) {
            THUMBNAILS_DIR.create({ intermediates: true, idempotent: true });
        }
        THUMBNAIL_INDEX_FILE.write(JSON.stringify(index));
    } catch (e) {
        logger.warn('FileScanner', 'Failed to save thumbnail index to disk', e);
    }
}

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
const POSTERS_DIR = new Directory(Paths.document, 'smb_posters');

// ─── Concurrency helpers ─────────────────────────────────────────────────────

/**
 * Maximum number of SAF readDirectoryAsync calls that may be in-flight
 * simultaneously.  Limiting this prevents overwhelming slower storage
 * (e.g. USB OTG drives) while still providing meaningful parallelism.
 */
const MAX_CONCURRENT_DIR_READS = 8;

/**
 * Maximum number of thumbnail generation tasks that run concurrently.
 * Thumbnail decoding is CPU-intensive; capping it keeps weaker devices
 * responsive during a scan.
 */
const MAX_CONCURRENT_THUMBNAILS = 3;

/**
 * Dispatch a scan-progress update to Redux after this many media files have
 * been discovered, to avoid flooding the Redux store with single-file events.
 */
const PROGRESS_DISPATCH_INTERVAL = 10;

/** Lightweight promise-based semaphore used to cap concurrency. */
class Semaphore {
    private available: number;
    private readonly queue: Array<() => void> = [];

    constructor(limit: number) {
        this.available = limit;
    }

    acquire(): Promise<void> {
        if (this.available > 0) {
            this.available--;
            return Promise.resolve();
        }
        return new Promise<void>((resolve) => this.queue.push(resolve));
    }

    release(): void {
        const next = this.queue.shift();
        if (next) {
            next();
        } else {
            this.available++;
        }
    }
}

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
    if (!POSTERS_DIR.exists) {
        POSTERS_DIR.create({ intermediates: true, idempotent: true });
    }
    const safeName = key.replace(/[^a-zA-Z0-9_-]/g, '_');
    const localFile = new File(POSTERS_DIR, `${safeName}_local.jpg`);
    if (localFile.exists) {
        return localFile.uri;
    }
    try {
        const sourceFile = new File(sourceUri);
        sourceFile.copy(localFile);
    } catch {
        // copyAsync may not work with all SAF content:// URIs; fall back to base64 read/write.
        const base64 = await StorageAccessFramework.readAsStringAsync(sourceUri, {
            encoding: 'base64',
        });
        localFile.write(base64, { encoding: 'base64' });
    }
    return localFile.uri;
}

interface ParsedMetadata {
    /** Canonical (normalized) show name, used as the Redux library key. */
    showName: string;
    /**
     * Raw name before year-suffix stripping (equals showName when no suffix was
     * removed).  Stored on the library entry for debugging and provenance.
     */
    rawShowName: string;
    /** Year extracted from the raw show name/folder suffix (0 if not present). */
    showYear: number;
    season: number;
    episode: number;
    title: string;
}

/** A file collected during recursive scanning, carrying its relative path parts. */
interface IScannedFile extends IMediaObject {
    /** Path segments relative to the root scan directory (does not include filename). */
    relativePathParts: string[];
}

/**
 * Mutable state shared across all concurrent `recursiveCollect` calls for a
 * single `collectAllMediaFiles` invocation.  Holds the stream batch buffers and
 * auxiliary tracking maps needed to dispatch progressive Redux updates.
 */
interface StreamState {
    /** Whether this source scans TV shows or movies. */
    sourceType: 'tv' | 'movie';
    /** Buffered TV episode payloads waiting to be dispatched as a batch. */
    episodeBatch: MergeEpisodePayload[];
    /** Buffered movie objects (with their folder key) waiting to be dispatched. */
    movieBatch: Array<{ movie: IMediaObject; folderKey: string }>;
    /**
     * Tracks which movie paths have already been flushed to Redux, keyed by
     * folder key.  Used to dispatch `setMoviePoster` updates when a poster
     * image is discovered after its movie files have already been dispatched.
     */
    moviePathsByFolder: Map<string, string[]>;
    /**
     * Metadata provider configured on the source folder being scanned.
     * Stamped on new show entries so MetadataService can pick the correct provider.
     */
    metadataSource?: dataSources;
}

/**
 * Strips a trailing year suffix from a raw show/folder name and returns the
 * canonical name together with the extracted year.
 *
 * Patterns recognised (at end of string):
 *   "Bluey (2018)"  →  name: "Bluey",  year: 2018
 *   "Bluey [2018]"  →  name: "Bluey",  year: 2018
 *   "Bluey 2018"    →  name: "Bluey",  year: 2018
 *   "Bluey"         →  name: "Bluey",  year: 0
 *
 * This allows folders named "Bluey" and "Bluey (2018)" to be merged under the
 * single canonical key "Bluey" in the Redux library, while the year is stored
 * separately so the TMDB enrichment pass can select the correct result.
 */
function normalizeShowName(raw: string): { name: string; year: number } {
    // Require balanced brackets: (YYYY), [YYYY], or bare YYYY at end of string.
    const yearMatch = raw.match(/\s*(?:\((\d{4})\)|\[(\d{4})\]|(\d{4}))\s*$/);
    const year = yearMatch ? parseInt(yearMatch[1] ?? yearMatch[2] ?? yearMatch[3], 10) : 0;
    // Strip the matched suffix; fall back to the original if stripping leaves an empty string.
    const name = yearMatch ? (raw.slice(0, yearMatch.index).trim() || raw.trim()) : raw.trim();
    return { name, year };
}

/**
 * Produces a normalised key used to detect that two differently-named show
 * folders actually refer to the same series.
 *
 * The key is derived by:
 *   1. Stripping any trailing year suffix (delegates to normalizeShowName).
 *   2. Lower-casing the result.
 *   3. Replacing ampersands with "and" so "Tom & Jerry" ≡ "Tom and Jerry".
 *   4. Removing apostrophes, hyphens, colons, periods, commas and exclamation
 *      marks so "Grey's Anatomy" ≡ "Greys Anatomy".
 *   5. Collapsing runs of whitespace to a single space and trimming.
 *
 * Examples:
 *   "Grey's Anatomy"   → "greys anatomy"
 *   "Greys Anatomy"    → "greys anatomy"
 *   "Tom & Jerry"      → "tom and jerry"
 *   "Tom and Jerry"    → "tom and jerry"
 *   "Bluey (2018)"     → "bluey"
 */
export function fuzzyKey(name: string): string {
    const { name: stripped } = normalizeShowName(name);
    return stripped
        .toLowerCase()
        .replace(/&/g, 'and')
        .replace(/[':.,!-]/g, '')
        .replace(/\s+/g, ' ')
        .trim();
}

/**
 * Builds a sanitised query string suitable for the TMDB search API from a raw
 * show or movie title.
 *
 * Steps applied (order matters):
 *   1. Strip a trailing year suffix – "Breaking Bad (2008)" → "Breaking Bad".
 *   2. Replace "&" with "and" – TMDB handles "and" better than bare "&".
 *   3. Strip apostrophes, colons and commas that can confuse TMDB's tokeniser.
 *   4. Collapse whitespace and trim.
 *
 * The original title is never mutated; only the TMDB query is affected.
 */
export function buildTmdbSearchQuery(title: string): string {
    return title
        .replace(/\s*[\[(]?\d{4}[\])]?\s*$/, '')
        .replace(/&/g, 'and')
        .replace(/[':.,\-]/g, '')
        .replace(/\s+/g, ' ')
        .trim();
}

export class FileScanner {

    static myInstance: FileScanner | null = null;

    _userID = "";

    /** Set to true by {@link cancelScan} to request an early abort of the active scan. */
    private _cancelRequested = false;

    /**
     * @returns {FileScanner}
     */
    static getInstance(): FileScanner {
        if (this.myInstance == null) {
            this.myInstance = new FileScanner();
        }

        return this.myInstance;
    }

    /**
     * Requests cancellation of the currently-running scan.
     * The scan will stop at the next cancellation checkpoint; the Redux store
     * will be left in whatever partial state has been written so far and
     * `isScanning` will be reset to `false`.
     */
    cancelScan(): void {
        logger.log('FileScanner', 'cancelScan() called – requesting scan abort');
        this._cancelRequested = true;
    }

    /** Scan all configured sources and update the Redux store with merged results. */
    async scanAllSources(sources: IMediaSource[]) {
        logger.log('FileScanner', `scanAllSources called with ${sources.length} source(s)`);
        sources.forEach((s, i) => logger.log('FileScanner', `  Source[${i}]: type=${s.contentType} uri=${s.uri}`));
        this._cancelRequested = false;
        store.dispatch(setIsScanning(true));
        store.dispatch(setScanProgress({ phase: 'collecting', filesFound: 0, thumbnailsDone: 0, thumbnailsTotal: 0, metadataDone: 0, metadataTotal: 0 }));
        try {
        const tvSources = sources.filter((s) => s.contentType === 'tv');
        const movieSources = sources.filter((s) => s.contentType === 'movie');
        logger.log('FileScanner', `TV sources: ${tvSources.length}, Movie sources: ${movieSources.length}`);

        // Create per-scan semaphores so that two overlapping scans (e.g. triggered
        // by a settings change while a previous scan is still running) each have
        // their own independent concurrency budget rather than sharing a single
        // module-level pool.
        const dirSemaphore = new Semaphore(MAX_CONCURRENT_DIR_READS);
        const thumbSemaphore = new Semaphore(MAX_CONCURRENT_THUMBNAILS);
        // Shared progress counter threaded through all collectAllMediaFiles calls
        // so that TV and movie sources contribute to the same running total.
        // currentSourceIndex (1-based) and sourcesTotal are also tracked here so
        // the throttled dispatches inside recursiveCollect can include them.
        const sourceIndexByUri = new Map(sources.map((s, i) => [s.uri, i + 1]));
        const collectProgress = {
            filesFound: 0,
            currentSourceIndex: 1,
            sourcesTotal: sources.length,
        };

        // Collect TV files from all TV sources and merge into one library
        const allTvFiles: IScannedFile[] = [];
        const tvPosterMap = new Map<string, string>();
        for (const src of tvSources) {
            if (this._cancelRequested) {
                logger.log('FileScanner', 'Scan cancelled before TV source');
                return;
            }
            collectProgress.currentSourceIndex = sourceIndexByUri.get(src.uri) ?? 1;
            logger.log('FileScanner', `Scanning TV source (${collectProgress.currentSourceIndex}/${collectProgress.sourcesTotal}): ${src.uri}`);
            const { files, posterMap } = await this.collectAllMediaFiles(src.uri, dirSemaphore, collectProgress, 'tv', src.metadataSource);
            logger.log('FileScanner', `  Found ${files.length} TV file(s) in source`);
            allTvFiles.push(...files);
            posterMap.forEach((uri, key) => { if (!tvPosterMap.has(key)) tvPosterMap.set(key, uri); });
        }

        if (this._cancelRequested) {
            logger.log('FileScanner', 'Scan cancelled after TV collection');
            return;
        }

        const mergedLibrary = this.buildLibrary(allTvFiles, tvPosterMap);
        logger.log('FileScanner', `Built TV library with ${Object.keys(mergedLibrary).length} show(s) from ${allTvFiles.length} file(s)`);

        // Collect movie files from all movie sources
        const allMovieFiles: IScannedFile[] = [];
        const moviePosterMap = new Map<string, string>();
        for (const src of movieSources) {
            if (this._cancelRequested) {
                logger.log('FileScanner', 'Scan cancelled before movie source');
                return;
            }
            collectProgress.currentSourceIndex = sourceIndexByUri.get(src.uri) ?? 1;
            logger.log('FileScanner', `Scanning Movie source (${collectProgress.currentSourceIndex}/${collectProgress.sourcesTotal}): ${src.uri}`);
            const { files, posterMap } = await this.collectAllMediaFiles(src.uri, dirSemaphore, collectProgress, 'movie', src.metadataSource);
            logger.log('FileScanner', `  Found ${files.length} movie file(s) in source`);
            allMovieFiles.push(...files);
            posterMap.forEach((uri, key) => { if (!moviePosterMap.has(key)) moviePosterMap.set(key, uri); });
        }

        if (this._cancelRequested) {
            logger.log('FileScanner', 'Scan cancelled after movie collection');
            return;
        }

        const movies = this.buildMovieList(allMovieFiles, moviePosterMap);
        logger.log('FileScanner', `Built movie list with ${movies.length} movie(s)`);

        // Build a combined scan list for diagnostic purposes
        const allScanUris: string[] = [
            ...allTvFiles.map((f) => f.path),
            ...allMovieFiles.map((f) => f.path),
        ];

        // Carry over previously-fetched provider poster URIs and IDs into the freshly-built
        // library so that posters remain visible during the upcoming enrichment phase.
        // Without this, dispatching setMediaLibrary with a new library (which has no provider
        // data) causes all posters to vanish from the UI until enrichment re-downloads them.
        const prevLibrary = store.getState().libraryReducer.mediaLibrary;
        for (const [showName, show] of Object.entries(mergedLibrary)) {
            const prev = prevLibrary[showName];
            if (!prev) continue;
            try {
                if (prev.ids.tmdb) {
                    // Always restore the TMDB ID so deduplication and the edit screen
                    // continue to work correctly without requiring a full re-enrichment.
                    show.ids.tmdb = prev.ids.tmdb;
                }
                if (prev.ids.tvdb) {
                    // Restore the TVDB ID symmetrically so TVDB episode enrichment works
                    // on subsequent scans without re-fetching the show search result.
                    show.ids.tvdb = prev.ids.tvdb;
                }
                if (prev.poster) {
                    try {
                        if (new File(prev.poster).exists) {
                            // Only restore the poster when the new scan did not find a
                            // local folder image (folder.jpg / poster.jpg etc.) for this show.
                            if (!show.poster) {
                                show.poster = prev.poster;
                            }
                        }
                    } catch {
                        // Ignore file-existence errors; the poster will be re-fetched during enrichment.
                    }
                }
                // Carry over episode-level TMDB metadata (names + stills) so they
                // survive rescans without requiring a full re-enrichment from the API.
                for (const [seasonKey, season] of Object.entries(show.seasons)) {
                    const prevSeason = prev.seasons[seasonKey];
                    if (!prevSeason) continue;
                    for (const [epKey, ep] of Object.entries(season.episodes)) {
                        const prevEp = prevSeason.episodes[epKey];
                        if (!prevEp) continue;
                        if (prevEp.tmdbTitle) ep.tmdbTitle = prevEp.tmdbTitle;
                        if (prevEp.tmdbThumbnail) {
                            try {
                                if (new File(prevEp.tmdbThumbnail).exists) {
                                    ep.tmdbThumbnail = prevEp.tmdbThumbnail;
                                }
                            } catch {
                                // ignore; thumbnail will be re-fetched during enrichment
                            }
                        }
                    }
                }
            } catch {
                // Ignore errors; metadata will be re-fetched during enrichment.
            }
        }
        const prevMovies = store.getState().libraryReducer.movies;
        const prevMovieByPath = new Map(prevMovies.map((m) => [m.path, m]));
        for (const movie of movies) {
            const prev = prevMovieByPath.get(movie.path);
            if (!prev) continue;
            try {
                // Always carry over provider IDs so enrichment can skip re-searching
                // and episode enrichment continues to work on subsequent scans.
                if (prev.ids.tmdb) movie.ids.tmdb = prev.ids.tmdb;
                if (prev.ids.tvdb) movie.ids.tvdb = prev.ids.tvdb;
                // Only restore the poster URI when the cached file still exists on disk.
                const posterPath = prev.poster;
                if (posterPath && !movie.poster) {
                    if (new File(posterPath).exists) {
                        movie.poster = posterPath;
                    }
                }
            } catch {
                // Ignore file-existence errors; the poster will be re-fetched during enrichment.
            }
        }

        // Dispatch a final "collecting done" progress update with the exact total before
        // dispatching the library data, so the UI can show the correct file count.
        store.dispatch(setScanProgress({ phase: 'collecting', filesFound: allScanUris.length, thumbnailsDone: 0, thumbnailsTotal: 0, metadataDone: 0, metadataTotal: 0 }));
        store.dispatch(setScanList(allScanUris));
        store.dispatch(setMediaLibrary(mergedLibrary));
        store.dispatch(setMovies(movies));
        logger.log('FileScanner', `Scan complete. Total media files dispatched: ${allScanUris.length}`);

        // Enrich library with metadata posters if any provider key is configured.
        // Awaited so that isScanning stays true (and progress is visible) for the
        // full duration of enrichment; setIsScanning(false) fires in the finally block.
        const settings = store.getState().settingsReducer;
        const enablePosterFetching = settings.enablePosterFetching ?? true;
        const hasAnyProviderKey = !!(settings.tmdbApiKey || settings.tvdbApiKey);
        if (!this._cancelRequested && enablePosterFetching && hasAnyProviderKey) {
            logger.log('FileScanner', 'Provider API key found – starting metadata enrichment');
            const currentLibrary = store.getState().libraryReducer.mediaLibrary;
            const currentMovies = store.getState().libraryReducer.movies;
            try {
                await MetadataService.getInstance().enrichAll(currentLibrary, currentMovies, () => this._cancelRequested);
            } catch (e) {
                logger.error('FileScanner', 'Metadata enrichment failed', e);
            }
        } else if (this._cancelRequested) {
            logger.log('FileScanner', 'Scan cancelled before metadata enrichment');
        } else if (!enablePosterFetching) {
            logger.log('FileScanner', 'Poster fetching disabled in settings – skipping metadata enrichment');
        } else {
            logger.log('FileScanner', 'No provider API key configured – skipping metadata enrichment');
        }

        // Generate thumbnails for all scanned media files concurrently (skip already-cached paths).
        // This now runs after the poster/metadata stage so poster updates are applied first.
        const allMediaFiles: IMediaObject[] = [
            ...allTvFiles.map(({ relativePathParts, ...obj }) => obj),
            ...allMovieFiles.map(({ relativePathParts, ...obj }) => obj),
        ];
        const enableThumbnailGeneration = store.getState().settingsReducer.enableThumbnailGeneration ?? false;
        if (!this._cancelRequested && enableThumbnailGeneration) {
            // Load the on-disk thumbnail index and pre-populate the cache with persistent URIs.
            // This must run before filtering uncached files so already-persisted thumbnails
            // are treated as cached and skipped.
            const diskIndex = loadThumbnailIndex();
            const uncached = allMediaFiles.filter((m) => !thumbnailCache.has(m.path));
            logger.log('FileScanner', `Generating thumbnails for ${uncached.length} uncached file(s) (${allMediaFiles.length - uncached.length} already cached)`);
            if (uncached.length > 0) {
                let thumbSuccess = 0;
                let thumbFail = 0;
                let thumbCompleted = 0;
                const thumbTotal = uncached.length;
                // Announce the thumbnail phase so the UI can show a progress bar.
                // Only entered when there is at least one thumbnail to generate,
                // so thumbnailsTotal is always > 0 here.
                store.dispatch(setScanProgress({ phase: 'thumbnails', filesFound: allMediaFiles.length, thumbnailsDone: 0, thumbnailsTotal: thumbTotal, metadataDone: 0, metadataTotal: 0 }));
                await Promise.allSettled(
                    uncached.map(async (media) => {
                        // Skip cancelled items before acquiring the semaphore so we
                        // don't needlessly hold a concurrency slot.
                        if (this._cancelRequested) return;
                        // Throttle concurrency so weaker devices are not overwhelmed.
                        await thumbSemaphore.acquire();
                        try {
                            if (this._cancelRequested) {
                                return;
                            }
                            const thumbnail = await this.generateThumbnail(media.path);
                            if (!thumbnail) {
                                throw new Error('No thumbnail returned by expo-video');
                            }
                            // Attempt to persist the thumbnail to disk so it survives restarts.
                            const diskUri = await this.persistThumbnail(media.path, thumbnail);
                            if (diskUri) {
                                thumbnailCache.set(media.path, diskUri);
                                diskIndex[media.path] = diskUri;
                            } else {
                                // Disk-persist failed; keep the VideoThumbnail for this session only.
                                thumbnailCache.set(media.path, thumbnail);
                            }
                            thumbSuccess++;
                        } catch (e) {
                            thumbFail++;
                            logger.warn('FileScanner', `Thumbnail failed for ${media.filename}`, e);
                        } finally {
                            thumbSemaphore.release();
                            thumbCompleted++;
                            store.dispatch(setScanProgress({
                                phase: 'thumbnails',
                                filesFound: allMediaFiles.length,
                                thumbnailsDone: thumbCompleted,
                                thumbnailsTotal: thumbTotal,
                                metadataDone: 0,
                                metadataTotal: 0,
                            }));
                        }
                    }),
                );
                logger.log('FileScanner', `Thumbnail generation done: ${thumbSuccess} succeeded, ${thumbFail} failed`);
                // Persist the updated index (existing entries + any newly generated ones).
                saveThumbnailIndex(diskIndex);
            } else {
                logger.log('FileScanner', 'All thumbnails already cached – skipping thumbnail generation');
            }
        } else {
            logger.log('FileScanner', 'Thumbnail generation disabled in settings – skipping thumbnail generation step');
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

                const allContents: IMediaObject[] = contents.map((entryUri: string) => {
                        const uri = decodeURIComponent(entryUri);
                        const filename = uri.substring(uri.lastIndexOf('/') + 1);
                        const dotIdx = filename.lastIndexOf('.');
                        const ext = dotIdx !== -1 ? filename.substring(dotIdx).toLowerCase() : '';

                        // SAF entry metadata is unreliable; infer obvious file types by extension.
                        const isDirectory = !this.isMediaFile(filename) && !NON_DIRECTORY_EXTENSIONS.has(ext);

                        return {
                                ids: { tvdb: null, imdb: null, tmdb: null },
                                title: '',
                                episodeNumber: 0,
                                filename,
                                path: entryUri,
                                parsedPath: uri,
                                isDirectory,
                                poster: '',
                        };
                });
    
        const filtered = allContents.filter((c) => {
          if (c.filename.charAt(0) === '.') return null;
          return c;
        });

        store.dispatch(setScanList(filtered.map(f => f.path)));
        logger.log('FileScanner', `scanFolder filtered to ${filtered.length} item(s)`);

        // Recursively collect all media files and build the library
        const { files: allMediaFiles, posterMap } = await this.collectAllMediaFiles(
            directory,
            new Semaphore(MAX_CONCURRENT_DIR_READS),
            { filesFound: 0, currentSourceIndex: 1, sourcesTotal: 1 },
            'tv',
            undefined,
        );
        const library = this.buildLibrary(allMediaFiles, posterMap);
        store.dispatch(setMediaLibrary(library));

        return filtered;
    }

    // ─── Recursive collection ────────────────────────────────────────────────

    private async collectAllMediaFiles(
        rootDirectory: string,
        dirSemaphore: Semaphore,
        progress: { filesFound: number; currentSourceIndex: number; sourcesTotal: number },
        sourceType: 'tv' | 'movie' = 'tv',
        metadataSource?: dataSources,
    ): Promise<{ files: IScannedFile[]; posterMap: Map<string, string> }> {
        const result: IScannedFile[] = [];
        const posterMap = new Map<string, string>();
        const streamState: StreamState = {
            sourceType,
            episodeBatch: [],
            movieBatch: [],
            moviePathsByFolder: new Map(),
            metadataSource,
        };
        await this.recursiveCollect(rootDirectory, [], result, posterMap, 0, dirSemaphore, progress, streamState);
        // Stamp the source-level metadata provider on every collected file so
        // buildLibrary and buildMovieList can propagate it to show/movie entries.
        if (metadataSource) {
            for (const f of result) f.metadataSource = metadataSource;
        }
        // Flush any remaining buffered items that did not reach the batch threshold
        this.flushStreamBatch(streamState, posterMap);
        return { files: result, posterMap };
    }

    private async recursiveCollect(
        directory: string,
        relativePathParts: string[],
        result: IScannedFile[],
        posterMap: Map<string, string>,
        depth: number,
        dirSemaphore: Semaphore,
        progress: { filesFound: number; currentSourceIndex: number; sourcesTotal: number },
        streamState: StreamState,
    ): Promise<void> {
        if (depth > MAX_SCAN_DEPTH) {
            logger.warn('FileScanner', `Max scan depth (${MAX_SCAN_DEPTH}) reached at: ${directory}`);
            return;
        }

        if (this._cancelRequested) {
            return;
        }

        let contents: string[];
        await dirSemaphore.acquire();
        try {
            contents = await StorageAccessFramework.readDirectoryAsync(directory);
        } catch (e) {
            logger.warn('FileScanner', `Cannot read directory (depth=${depth}): ${directory}`, e);
            return; // Directory not accessible
        } finally {
            dirSemaphore.release();
        }
        logger.log('FileScanner', `Scanning dir (depth=${depth}, ${contents.length} entries): ${decodeURIComponent(directory).split('/').slice(-2).join('/')}`);

        // Subdirectories to recurse into, collected during the synchronous pass
        // over this directory's entries so that we can fan them out in parallel
        // after processing all files at the current level.
        const subdirs: Array<{ uri: string; pathParts: string[] }> = [];

        for (let i = 0; i < contents.length; i++) {
            const resolvedUri = contents[i];
            const uri = decodeURIComponent(resolvedUri);
            const filename = uri.substring(uri.lastIndexOf('/') + 1);

            if (filename.charAt(0) === '.') continue; // Skip hidden entries

            if (this.isMediaFile(filename)) {
                const file: IScannedFile = {
                    ids: { tvdb: null, imdb: null, tmdb: null },
                    title: '',
                    episodeNumber: 0,
                    filename,
                    path: resolvedUri,
                    parsedPath: uri,
                    isDirectory: false,
                    relativePathParts,
                    poster: '',
                };
                result.push(file);
                // Add to the streaming batch so the UI can show this item
                // before the full collection pass completes.
                this.addToStreamBatch(file, posterMap, streamState);
                // Dispatch throttled progress update so the UI reflects files discovered
                // so far.  Updates are batched every PROGRESS_DISPATCH_INTERVAL files to
                // avoid excessive Redux churn; the final precise total is dispatched in
                // scanAllSources once all sources have been collected.
                progress.filesFound++;
                if (progress.filesFound % PROGRESS_DISPATCH_INTERVAL === 0) {
                    store.dispatch(setScanProgress({
                        phase: 'collecting',
                        filesFound: progress.filesFound,
                        thumbnailsDone: 0,
                        thumbnailsTotal: 0,
                        metadataDone: 0,
                        metadataTotal: 0,
                        currentSourceIndex: progress.sourcesTotal > 1 ? progress.currentSourceIndex : undefined,
                        sourcesTotal: progress.sourcesTotal > 1 ? progress.sourcesTotal : undefined,
                    }));
                    // Flush the stream batch so the UI shows newly discovered items.
                    this.flushStreamBatch(streamState, posterMap);
                }
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
                            // Immediately update already-dispatched Redux entries with the poster.
                            if (streamState.sourceType === 'tv') {
                                // The library key uses the normalized show name, not the raw folder name.
                                const normalizedKey = normalizeShowName(folderKey).name;
                                store.dispatch(updateShowPoster({ showName: normalizedKey, poster: localUri }));
                            } else {
                                // Update any movies already flushed to Redux for this folder.
                                for (const path of streamState.moviePathsByFolder.get(folderKey) ?? []) {
                                    store.dispatch(setMoviePoster({ path, poster: localUri }));
                                }
                                // Back-fill the poster for buffered movies not yet dispatched.
                                for (let i = 0; i < streamState.movieBatch.length; i++) {
                                    if (streamState.movieBatch[i].folderKey === folderKey) {
                                        streamState.movieBatch[i] = {
                                            ...streamState.movieBatch[i],
                                            movie: { ...streamState.movieBatch[i].movie, poster: localUri },
                                        };
                                    }
                                }
                            }
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

                // Collect as a potential subdirectory to recurse into in parallel.
                subdirs.push({ uri: resolvedUri, pathParts: [...relativePathParts, filename] });
            }
        }

        // Fan out all subdirectory reads in parallel.  This is the primary
        // performance optimisation: instead of recursing serially (O(dirs) sequential
        // awaits) we recurse into all siblings simultaneously, bounded by
        // dirSemaphore so we never overwhelm slower storage.
        await Promise.allSettled(
            subdirs.map(({ uri, pathParts }) =>
                this.recursiveCollect(uri, pathParts, result, posterMap, depth + 1, dirSemaphore, progress, streamState),
            ),
        );
    }

    private isMediaFile(filename: string): boolean {
        const dotIndex = filename.lastIndexOf('.');
        if (dotIndex === -1) return false;
        const ext = filename.substring(dotIndex).toLowerCase();
        return VIDEO_EXTENSIONS.has(ext);
    }

    /**
     * Parses a scanned file and adds it to the appropriate streaming batch
     * (episode or movie) based on the current source type.
     */
    private addToStreamBatch(file: IScannedFile, posterMap: Map<string, string>, streamState: StreamState): void {
        const { relativePathParts } = file;
        const folderKey = relativePathParts[0] ?? '';

        if (streamState.sourceType === 'tv') {
            const metadata = this.parseMediaFile(file);
            if (!metadata) return;
            const { showName, rawShowName, showYear, season, episode, title } = metadata;
            const folderPoster = folderKey ? (posterMap.get(folderKey) ?? '') : '';
            const seasonKey = `s${String(season).padStart(2, '0')}`;
            const episodeKey = `e${String(episode).padStart(2, '0')}`;
            const { relativePathParts: _, ...mediaObj } = file;
            streamState.episodeBatch.push({
                showName,
                rawShowName,
                folderYear: showYear,
                folderPoster,
                seasonKey,
                seasonNumber: season,
                episodeKey,
                episode: { ...mediaObj, title: title || file.filename, scannedTitle: title || file.filename, episodeNumber: episode },
                metadataSource: streamState.metadataSource,
            });
        } else {
            // Movie: derive title the same way buildMovieList does
            const filenameTitle = file.filename.replace(/\.[^.]+$/, '').replace(/[\._-]+/g, ' ').trim();
            const title = relativePathParts.length === 1
                ? relativePathParts[0].replace(/[\._-]+/g, ' ').trim()
                : filenameTitle;
            const folderPoster = folderKey ? (posterMap.get(folderKey) ?? '') : '';
            const { relativePathParts: _, ...mediaObj } = file;
            streamState.movieBatch.push({
                movie: { ...mediaObj, title, poster: folderPoster },
                folderKey,
            });
        }
    }

    /**
     * Dispatches all buffered episodes and movies to Redux, then clears the
     * batch arrays.  Also updates `moviePathsByFolder` with newly dispatched
     * movie paths so future poster updates can find them.
     *
     * Uses the latest `posterMap` when building movie objects so that a poster
     * discovered in the same directory but listed after the movie file is
     * included in the dispatched payload.
     */
    private flushStreamBatch(streamState: StreamState, posterMap: Map<string, string>): void {
        if (streamState.episodeBatch.length > 0) {
            store.dispatch(mergeEpisodeBatch([...streamState.episodeBatch]));
            streamState.episodeBatch.length = 0;
        }
        if (streamState.movieBatch.length > 0) {
            // Apply latest poster from posterMap in case the poster file was
            // discovered in the same for-loop pass but after the movie file.
            const movies = streamState.movieBatch.map(({ movie, folderKey }) => {
                const latestPoster = posterMap.get(folderKey);
                return latestPoster ? { ...movie, poster: latestPoster } : movie;
            });
            store.dispatch(appendMovieBatch(movies));
            // Register these paths so future poster-copy events can update them.
            for (const { movie, folderKey } of streamState.movieBatch) {
                const paths = streamState.moviePathsByFolder.get(folderKey);
                if (paths) {
                    paths.push(movie.path);
                } else {
                    streamState.moviePathsByFolder.set(folderKey, [movie.path]);
                }
            }
            streamState.movieBatch.length = 0;
        }
    }

    private async generateThumbnail(videoUri: string): Promise<VideoThumbnail | null> {
        const player = createVideoPlayer(videoUri);
        try {
            const thumbnails = await player.generateThumbnailsAsync(11, { maxWidth: 640 });
            return thumbnails[0] ?? null;
        } finally {
            const releasable = player as unknown as {
                release?: () => void;
                destroy?: () => void;
            };
            releasable.release?.();
            releasable.destroy?.();
        }
    }

    /**
     * Saves a generated `VideoThumbnail` to the persistent `smb_thumbnails/`
     * directory as a JPEG file.
     *
     * @returns The local `file://` URI of the saved thumbnail, or `null` if
     *          saving failed (the caller should fall back to the in-memory
     *          `VideoThumbnail` for the current session only).
     */
    private async persistThumbnail(videoPath: string, thumbnail: VideoThumbnail): Promise<string | null> {
        try {
            if (!THUMBNAILS_DIR.exists) {
                THUMBNAILS_DIR.create({ intermediates: true, idempotent: true });
            }
            const destFile = new File(THUMBNAILS_DIR, thumbnailFilename(videoPath));
            if (destFile.exists) {
                // Already on disk (e.g. written by a previous in-session call).
                return destFile.uri;
            }
            // Render the native image to a temporary JPEG in the system cache dir.
            const context = ImageManipulator.manipulate(thumbnail);
            const imageRef = await context.renderAsync();
            const result = await imageRef.saveAsync({ format: SaveFormat.JPEG, compress: 0.85 });
            // Copy from the (evictable) cache dir to our persistent document dir.
            const tempFile = new File(result.uri);
            tempFile.copy(destFile);
            // Clean up the temporary file now that it has been copied.
            try { tempFile.delete(); } catch { /* ignore – the OS will evict it eventually */ }
            return destFile.uri;
        } catch (e) {
            logger.warn('FileScanner', `Failed to persist thumbnail to disk for ${videoPath}`, e);
            return null;
        }
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

            const { showName, rawShowName, showYear, season, episode, title } = metadata;

            if (!library[showName]) {
                // Use the raw folder name (relativePathParts[0]) to look up any local
                // poster image found during the scan, since folder names may differ
                // from the parsed show name extracted from the episode filename.
                const folderKey = file.relativePathParts[0];
                const folderPoster = (folderKey && posterMap?.get(folderKey)) ?? '';
                library[showName] = {
                    ids: { tvdb: null, imdb: null, tmdb: null },
                    title: showName,
                    year: showYear,
                    poster: folderPoster,
                    seasons: {},
                    rawNames: rawShowName !== showName ? [rawShowName] : [],
                    metadataSource: file.metadataSource,
                };
            } else {
                // Back-fill year if not yet recorded for this canonical show
                if (showYear > 0 && !library[showName].year) {
                    library[showName].year = showYear;
                }
                // Track raw folder/filename names that were merged under this key
                if (rawShowName !== showName) {
                    if (!library[showName].rawNames) library[showName].rawNames = [];
                    if (!library[showName].rawNames!.includes(rawShowName)) {
                        library[showName].rawNames!.push(rawShowName);
                    }
                }
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
                const resolvedTitle = title || file.filename;
                library[showName].seasons[seasonKey].episodes[episodeKey] = {
                    ...mediaObj,
                    title: resolvedTitle,
                    scannedTitle: resolvedTitle,
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
            const rawShowName = this.cleanName(sxxMatch[1]);
            const { name: showName, year: showYear } = normalizeShowName(rawShowName);
            return {
                showName,
                rawShowName,
                showYear,
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
            const rawShowName = this.cleanName(nxnnMatch[1]);
            const { name: showName, year: showYear } = normalizeShowName(rawShowName);
            return {
                showName,
                rawShowName,
                showYear,
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
            const rawShowName = parts[0];
            const { name: showName, year: showYear } = normalizeShowName(rawShowName);
            const seasonFolder = parts[1];
            // Prefer an explicit 'Season N' word; otherwise take the first digit run.
            const namedSeasonMatch = seasonFolder.match(/[Ss]eason\s*(\d+)/i);
            const rawNumberMatch = seasonFolder.match(/(\d+)/);
            const seasonStr = namedSeasonMatch
                ? namedSeasonMatch[1]
                : rawNumberMatch?.[1] ?? '1';
            const season = parseInt(seasonStr, 10);
            return { showName, rawShowName, showYear, season, episode, title: baseTitle };
        }

        if (parts.length === 1) {
            // rootDir/ShowName/episode.mkv
            const rawShowName = parts[0];
            const { name: showName, year: showYear } = normalizeShowName(rawShowName);
            return { showName, rawShowName, showYear, season: 1, episode, title: baseTitle };
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
