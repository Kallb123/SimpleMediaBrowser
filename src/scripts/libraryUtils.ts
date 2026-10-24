/**
 * Pure, dependency-free helpers and shared types for the media library.
 *
 * This module must stay free of runtime imports (no Redux store, no native
 * modules, no logger) so FileScanner, MetadataService, the metadata providers,
 * the reducers and the UI can all import from it without creating require
 * cycles, and so it can be unit-tested without mocking anything.
 */

/** Metadata provider ids supported for TV/movie lookups. */
export type dataSources = 'tmdb' | 'tvdb';

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
     * Prefer `resolvedTitle` for display when it is available.
     */
    title: string;
    /**
     * The title as parsed from the local filename or folder structure during
     * scanning.  Stored separately so the provider-sourced title (`resolvedTitle`) can
     * be displayed without losing the original locally-derived value.
     */
    scannedTitle?: string;
    /**
     * Episode name fetched from a metadata provider.
     * When present, the UI prefers this over the locally-scanned title.
     */
    resolvedTitle?: string;
    /**
     * Local file URI for the episode still image downloaded from a metadata provider.
     * Used as the episode "poster" in the grid/list UI.
     */
    resolvedThumbnail?: string;
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
    /**
     * Timestamp (`Date.now()`) of the last time this episode/movie was opened
     * in an external player.  Absent means never opened.  Not populated during
     * scanning; set via the `setEpisodeLastOpened`/`setMovieLastOpened`
     * reducers when the user opens the file.
     */
    lastOpened?: number;
    /**
     * Timestamp (`Date.now()`) of the first time this episode/movie was
     * discovered by a scan.  Set once when the item is first built and then
     * carried forward on every subsequent rescan (see the carry-over block
     * in `scanAllSources`), so it never changes once assigned.
     */
    firstDetected?: number;
    /**
     * The `IMediaSource.uri` of the source folder this item was scanned from.
     * Stamped during collection so a later scan can tell, if the item is
     * absent from a fresh build, whether it came from a source that failed
     * to enumerate this time (device disconnected) versus one that was read
     * successfully (item genuinely removed) — see `unavailable`.
     */
    sourceUri?: string;
    /**
     * Set when this item's originating source could not be read during the
     * most recent scan (e.g. the storage device is disconnected) and the
     * item was carried forward from the previous scan instead of being
     * dropped. The UI should hide items with this flag set rather than
     * deleting their metadata, so they reappear automatically once the
     * source is reachable again.
     */
    unavailable?: boolean;
}

export const VIDEO_EXTENSIONS = new Set([
    '.mkv', '.mp4', '.avi', '.mov', '.m4v', '.wmv', '.flv',
    '.ts', '.m2ts', '.webm', '.mpg', '.mpeg', '.3gp',
]);

/**
 * Audio file extensions recognised as audiobook content.  Used only when
 * scanning sources whose contentType is 'audiobook'; for TV/movie sources these
 * remain in {@link NON_DIRECTORY_EXTENSIONS} so they are skipped.
 */
export const AUDIO_EXTENSIONS = new Set([
    '.mp3', '.m4a', '.m4b', '.aac', '.flac', '.ogg', '.oga', '.opus', '.wav', '.wma',
]);

/**
 * Extensions that are definitively non-directory file types.  Entries with
 * these extensions are skipped without attempting to recurse into them,
 * avoiding unnecessary readDirectoryAsync calls for subtitle/image/metadata
 * side-car files that live alongside video files.
 */
export const NON_DIRECTORY_EXTENSIONS = new Set([
    '.srt', '.ass', '.ssa', '.vtt', '.sub', '.idx', // subtitles
    '.nfo', '.xml', '.json', '.txt', '.md',          // metadata / text
    '.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.tbn', // images
    '.mp3', '.aac', '.flac', '.ogg', '.wav', '.m4a', // audio-only
]);

export interface ParsedMetadata {
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
export function normalizeShowName(raw: string): { name: string; year: number } {
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

/**
 * Whether `filename` is a playable media file for the given source type, judged
 * purely by extension (SAF entry metadata is unreliable): audio extensions for
 * audiobook sources, video extensions otherwise.
 */
export function isMediaFile(filename: string, sourceType: 'tv' | 'movie' | 'audiobook' = 'tv'): boolean {
    const dotIndex = filename.lastIndexOf('.');
    if (dotIndex === -1) return false;
    const ext = filename.substring(dotIndex).toLowerCase();
    return sourceType === 'audiobook' ? AUDIO_EXTENSIONS.has(ext) : VIDEO_EXTENSIONS.has(ext);
}

/** Replace dots/underscores with spaces and trim the string. */
function cleanName(raw: string): string {
    return raw.replace(/[\._]+/g, ' ').trim();
}

/**
 * Parse common TV filename patterns:
 *   Show.Name.S01E05.Episode.Title.mkv   (SxxExx)
 *   Show.Name.1x05.Episode.Title.mkv     (NxNN)
 */
export function parseFilename(filename: string): ParsedMetadata | null {
    // Remove extension for easier matching
    const withoutExt = filename.replace(/\.[^.]+$/, '');

    // SxxExx pattern — requires a separator before [Ss] so numeric show names don't false-match.
    // Season: up to 2 digits (realistic max ~99); episode: up to 3 digits (e.g. anime ep 100+).
    const sxxMatch = withoutExt.match(
        /^(.*?)[\.\s_-]+\b[Ss](\d{1,2})[Ee](\d{1,3})\b(?:[\.\s_-]+(.*))?$/,
    );
    if (sxxMatch) {
        const rawShowName = cleanName(sxxMatch[1]);
        const { name: showName, year: showYear } = normalizeShowName(rawShowName);
        return {
            showName,
            rawShowName,
            showYear,
            season: parseInt(sxxMatch[2], 10),
            episode: parseInt(sxxMatch[3], 10),
            title: sxxMatch[4] ? cleanName(sxxMatch[4]) : '',
        };
    }

    // NxNN pattern — requires a separator before the season digit so numbers inside show names
    // don't false-match. Season: up to 2 digits; episode: up to 3 digits.
    const nxnnMatch = withoutExt.match(
        /^(.*?)[\.\s_-]+\b(\d{1,2})x(\d{1,3})\b(?:[\.\s_-]+(.*))?$/,
    );
    if (nxnnMatch) {
        const rawShowName = cleanName(nxnnMatch[1]);
        const { name: showName, year: showYear } = normalizeShowName(rawShowName);
        return {
            showName,
            rawShowName,
            showYear,
            season: parseInt(nxnnMatch[2], 10),
            episode: parseInt(nxnnMatch[3], 10),
            title: nxnnMatch[4] ? cleanName(nxnnMatch[4]) : '',
        };
    }

    return null;
}

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
export function parseFromPath(filename: string, relativePathParts: string[]): ParsedMetadata | null {
    const parts = relativePathParts;
    const baseTitle = filename.replace(/\.[^.]+$/, '').replace(/[\._-]+/g, ' ').trim();

    // Try to extract an episode number from the filename.
    // Word boundary (\b) prevents matching digits inside unrelated words.
    // [Ee][Pp]? optionally matches 'p/P', covering 'e5', 'E5', 'ep5', 'EP5', etc.
    const epMatch = filename.match(/\b[Ee][Pp]?(\d{1,3})\b/);
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
