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

/** Earliest year accepted as a release year when stripping year suffixes from names. */
const MIN_PLAUSIBLE_YEAR = 1900;

/** Whether `year` is a believable release year (1900 to next calendar year, for announced titles). */
function isPlausibleYear(year: number): boolean {
    return year >= MIN_PLAUSIBLE_YEAR && year <= new Date().getFullYear() + 1;
}

/**
 * Splits a plausible trailing year off `raw`.  Returns `null` when there is no
 * year suffix to strip, or when stripping would leave nothing (the whole name
 * is a year, e.g. the show "1923").  Shared by {@link normalizeShowName} and
 * {@link buildTmdbSearchQuery} so both agree on what counts as a year.
 */
function splitTrailingYear(raw: string): { base: string; year: number } | null {
    const text = raw.trim();

    // Bracketed years are a strong signal: balanced "(YYYY)" / "[YYYY]", no separator needed.
    const bracketed = text.match(/^(.*?)\s*(?:\((\d{4})\)|\[(\d{4})\])$/);
    if (bracketed) {
        const year = parseInt(bracketed[2] ?? bracketed[3], 10);
        const base = bracketed[1].trim();
        return base && isPlausibleYear(year) ? { base, year } : null;
    }

    // Bare years are ambiguous ("Bluey 2018" vs "Blade Runner 2049" / "Space: 1999"), so the
    // year must be a whole word after whitespace/"."/"_" (never "Show12345"), be plausible, and
    // not follow a colon or dash (which marks it as part of a subtitle, "Space: 1999").
    const bare = text.match(/^(.*?[^\s.:_-])[\s._]+(\d{4})$/);
    if (bare) {
        const year = parseInt(bare[2], 10);
        return isPlausibleYear(year) ? { base: bare[1].trim(), year } : null;
    }
    return null;
}

/**
 * Strips a trailing year suffix from a raw show/folder name and returns the
 * canonical name together with the extracted year.
 *
 * Year rules:
 *   - Bracketed "(YYYY)" or "[YYYY]" at the end is always stripped, provided it is a
 *     plausible release year (1900 to current year + 1).  Brackets must be balanced.
 *   - A bare trailing "YYYY" is stripped only when it is a whole word after whitespace,
 *     "." or "_" (so "Show12345" is untouched), is plausible, and does not follow a colon or
 *     dash.  Titles ending in an implausible year ("Blade Runner 2049") or a colon-subtitle
 *     year ("Space: 1999") therefore keep the number.  Known limitation: a title whose
 *     number is a plausible year with no colon ("Wonder Woman 1984") is still read as a year.
 *   - A name that is only a year ("1923", "(2018)") is kept whole and reports year 0:
 *     the number is the title, not a release year.
 *
 * Examples:
 *   "Bluey (2018)"        →  name: "Bluey",              year: 2018
 *   "Bluey [2018]"        →  name: "Bluey",              year: 2018
 *   "Bluey 2018"          →  name: "Bluey",              year: 2018
 *   "Bluey"               →  name: "Bluey",              year: 0
 *   "Blade Runner 2049"   →  name: "Blade Runner 2049",  year: 0
 *   "Space: 1999"         →  name: "Space: 1999",        year: 0
 *   "Show12345"           →  name: "Show12345",          year: 0
 *   "1923"                →  name: "1923",               year: 0
 *
 * This allows folders named "Bluey" and "Bluey (2018)" to be merged under the
 * single canonical key "Bluey" in the Redux library, while the year is stored
 * separately so the TMDB enrichment pass can select the correct result.
 */
export function normalizeShowName(raw: string): { name: string; year: number } {
    const split = splitTrailingYear(raw);
    return split ? { name: split.base, year: split.year } : { name: raw.trim(), year: 0 };
}

/**
 * Produces a normalised key used to detect that two differently-named show
 * folders actually refer to the same series.
 *
 * The key is derived by:
 *   1. Stripping any trailing year suffix (delegates to normalizeShowName).
 *   2. Lower-casing the result.
 *   3. Replacing ampersands with "and" so "Tom & Jerry" ≡ "Tom and Jerry".
 *   4. Turning hyphens and en/em dashes into spaces, so "Spider-Man" ≡ "Spider Man"
 *      (but NOT "Spiderman").
 *   5. Removing apostrophes (straight, typographic ’ ‘ ʼ and backtick), double quotes
 *      (straight and curly), colons, semicolons, periods, commas, "!", "?" and "…" so
 *      "Grey's Anatomy" ≡ "Grey’s Anatomy" ≡ "Greys Anatomy".
 *   6. Collapsing runs of whitespace to a single space and trimming.
 *
 * Examples:
 *   "Grey's Anatomy"   → "greys anatomy"
 *   "Grey’s Anatomy"   → "greys anatomy"
 *   "Greys Anatomy"    → "greys anatomy"
 *   "Spider-Man"       → "spider man"
 *   "Tom & Jerry"      → "tom and jerry"
 *   "Tom and Jerry"    → "tom and jerry"
 *   "Bluey (2018)"     → "bluey"
 */
export function fuzzyKey(name: string): string {
    const { name: stripped } = normalizeShowName(name);
    return stripped
        .toLowerCase()
        .replace(/&/g, 'and')
        .replace(/[-–—]/g, ' ')
        .replace(/['‘’ʼ`"“”:;.,!?…]/g, '')
        .replace(/\s+/g, ' ')
        .trim();
}

/**
 * Builds a sanitised query string suitable for the TMDB search API from a raw
 * show or movie title.
 *
 * Steps applied (order matters):
 *   1. Strip a trailing year suffix using the same rules as {@link normalizeShowName} –
 *      "Breaking Bad (2008)" → "Breaking Bad", but "Blade Runner 2049" and a title
 *      that is only a year ("1923") are left intact.
 *   2. Replace "&" with "and" – TMDB handles "and" better than bare "&".
 *   3. Strip apostrophes (straight, typographic and backtick), curly double quotes, colons,
 *      periods, commas and hyphens that can confuse TMDB's tokeniser.
 *   4. Collapse whitespace and trim.
 *
 * Because step 1 never empties the title, a non-blank input never yields an empty query.
 * The original title is never mutated; only the TMDB query is affected.
 */
export function buildTmdbSearchQuery(title: string): string {
    return normalizeShowName(title).name
        .replace(/&/g, 'and')
        .replace(/[':.,\-‘’ʼ`“”]/g, '')
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
 * Dots, spaces, hyphens and underscores are all accepted as separators
 * ("Show_Name_S01E05_Episode_Title.mkv"); underscores in the show name and title
 * are turned into spaces.  A show name is required, so a bare "S01E05.mkv" returns
 * null (the scanner then falls back to {@link parseFromPath}).
 */
export function parseFilename(filename: string): ParsedMetadata | null {
    // Remove extension for easier matching
    const withoutExt = filename.replace(/\.[^.]+$/, '');

    // SxxExx pattern — requires a separator before [Ss] so numeric show names don't false-match.
    // "_" is a regex word character, so explicit lookaheads are used instead of \b: the token
    // must not run on into more letters/digits ("S1E5x", "S01E1000").
    // Season: up to 2 digits (realistic max ~99); episode: up to 3 digits (e.g. anime ep 100+).
    const sxxMatch = withoutExt.match(
        /^(.*?)[\.\s_-]+[Ss](\d{1,2})[Ee](\d{1,3})(?![A-Za-z0-9])(?:[\.\s_-]+(.*))?$/,
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
        /^(.*?)[\.\s_-]+(\d{1,2})x(\d{1,3})(?![A-Za-z0-9])(?:[\.\s_-]+(.*))?$/,
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
 * Season number for a season-folder name, or `null` when the folder does not
 * look like a season folder.  Rules, first match wins:
 *   - "Specials" / "Special" (optionally with a "(year)" suffix) → 0, the Plex/Kodi convention.
 *   - "Season N" / "Series N" (any case, optional space: "Season1") → N.
 *   - "SNN" ("S01", "s5", "Show S02") → N.
 *   - Otherwise the first standalone run of 1–3 digits ("Staffel 2", "Book 7", "01", "Disc 2").
 *     Runs of 4+ digits are never seasons, so "Show 2018 Extras" and "2019" give `null`.
 */
function parseSeasonFolder(folder: string): number | null {
    if (/^special(s)?$/i.test(folder.replace(/\([^)]*\)|\[[^\]]*\]/g, '').trim())) return 0;
    const named = folder.match(/(?:season|series)[\s._-]*(\d{1,3})(?!\d)/i);
    if (named) return parseInt(named[1], 10);
    const short = folder.match(/(?:^|[^A-Za-z0-9])s(\d{1,2})(?![A-Za-z0-9])/i);
    if (short) return parseInt(short[1], 10);
    const digits = folder.match(/(?:^|\D)(\d{1,3})(?!\d)/);
    return digits ? parseInt(digits[1], 10) : null;
}

/**
 * Pulls an episode number (and, for SxxExx / NxNN tokens, a season) out of a bare
 * filename that {@link parseFilename} could not parse.  Rules, first match wins,
 * all on the name without its extension and always on token boundaries:
 *   1. "S01E05" / "S01.E05" / "S1_E5" → season + episode.
 *   2. "1x05" → season + episode.
 *   3. "Episode 5", "Episode05", "Ep 5", "Ep.05", "ep7" (optional separator) or "E05"/"e5"
 *      (digits must follow directly) → episode.  1–3 digits; "E1000" is not an episode.
 *   4. A LEADING 1–3 digit number that is the whole name or followed by a separator:
 *      "01.mkv", "01 - Title.mkv", "5. Title.mkv" → episode.  Never a 4-digit number
 *      ("2019.mkv"), never a number buried mid-title ("Room 101.mkv"), and skipped when the
 *      name starts with the show's own name, so "2 Broke Girls - Pilot.mkv" in the
 *      "2 Broke Girls" folder is not episode 2.  Caveat: a title that merely starts with a
 *      number ("12 Angry Men.mkv") is read as that episode.
 * No match gives episode 0.
 */
function extractEpisode(filename: string, showName: string): { episode: number; season?: number } {
    const base = filename.replace(/\.[^.]+$/, '');
    const start = '(?:^|[^A-Za-z0-9])';
    const end = '(?![A-Za-z0-9])';

    const sxe = base.match(new RegExp(`${start}s(\\d{1,2})[\\s._-]?e(\\d{1,3})${end}`, 'i'));
    if (sxe) return { season: parseInt(sxe[1], 10), episode: parseInt(sxe[2], 10) };

    const nxn = base.match(new RegExp(`${start}(\\d{1,2})x(\\d{1,3})${end}`, 'i'));
    if (nxn) return { season: parseInt(nxn[1], 10), episode: parseInt(nxn[2], 10) };

    const ep = base.match(new RegExp(`${start}(?:(?:episode|ep)[\\s._-]?|e)(\\d{1,3})${end}`, 'i'));
    if (ep) return { episode: parseInt(ep[1], 10) };

    const leading = base.match(/^\s*(\d{1,3})(?:$|[\s._-])/);
    if (leading) {
        const startsWithShow = showName !== '' && base.toLowerCase().startsWith(showName.toLowerCase());
        if (!startsWithShow) return { episode: parseInt(leading[1], 10) };
    }

    return { episode: 0 };
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
 *
 * Season: a season given by the filename itself ("S02E05", "2x05") wins, matching
 * {@link parseFilename}.  Otherwise it comes from the season folder ("Season 2", "S02",
 * "Series 2", a lone number; "Specials" → 0; a 4-digit year is ignored), and otherwise
 * defaults to 1.
 *
 * Episode: see {@link extractEpisode} (S01E05, 1x05, E05, Ep 5, Episode 5, a leading
 * "01 - Title"); 0 when nothing is recognised.
 */
export function parseFromPath(filename: string, relativePathParts: string[]): ParsedMetadata | null {
    const parts = relativePathParts;
    if (parts.length === 0) {
        // File is directly in the root scan directory with no enclosing folder;
        // there is no structural context from which to derive a show name.
        return null;
    }

    const baseTitle = filename.replace(/\.[^.]+$/, '').replace(/[\._-]+/g, ' ').trim();
    // rootDir/ShowName/[SeasonFolder/...]/episode.mkv
    const rawShowName = parts[0];
    const { name: showName, year: showYear } = normalizeShowName(rawShowName);
    const { episode, season: fileSeason } = extractEpisode(filename, showName);
    const folderSeason = parts.length >= 2 ? parseSeasonFolder(parts[1]) : null;
    const season = fileSeason ?? folderSeason ?? 1;
    return { showName, rawShowName, showYear, season, episode, title: baseTitle };
}

/**
 * Key under which an episode is stored in its season's `episodes` map: "e" + the number
 * zero-padded to two digits ("e00", "e05", "e105").  smb.json episode titles and
 * `smb_thumb_sNNeNN.jpg` files are matched against this key.
 */
export function episodeKeyFor(episode: number): string {
    return `e${String(episode).padStart(2, '0')}`;
}

/**
 * Fallback key for an episode-0 file whose "e00" slot is already taken by a different file.
 * Episode 0 usually means "no episode number could be determined", so a season can hold
 * several such files; without this the library would keep only the first.  The key is
 * "e00-" + a short hash of the filename, so a given file gets the same key on every rescan.
 */
export function unnumberedEpisodeKey(filename: string): string {
    // 32-bit FNV-1a: tiny, deterministic and safe for any script (unlike a slug of the name).
    let hash = 0x811c9dc5;
    for (let i = 0; i < filename.length; i++) {
        hash = Math.imul(hash ^ filename.charCodeAt(i), 0x01000193);
    }
    return `e00-${(hash >>> 0).toString(36)}`;
}
