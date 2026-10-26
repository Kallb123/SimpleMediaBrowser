import { episodeDisplayLabel, movieDisplayLabel, showDisplayLabel } from '@/scripts/mediaLabels';
// Type-only imports, so this module (and the tests that load it) never pulls in the store.
import type { IMediaObject } from '@/scripts/libraryUtils';
import type { IMediaOverride, IMediaSeason, LibraryState } from '@/store/libraryReducer';
import type { AudioTrack, SubtitleTrack, VideoTrack } from 'expo-video';

/** What the video player screen should play. */
export interface VideoRequest {
    /** The file's SAF `content://` URI. */
    path: string;
    /** The file's library key (`watched` / `watchProgress` are keyed by it). */
    parsedPath: string;
    filename: string;
    /** Display label of the item, as the browse screen shows it. */
    title: string;
    /** Where to start, in seconds (0 = from the beginning). */
    startAt: number;
}

/** The same label the 'flat' browse view builds for an episode ("Show S01E02 - Title"). */
function episodeTitle(showName: string, season: IMediaSeason, ep: IMediaObject, overrides: { [key: string]: IMediaOverride }): string {
    const prefix = ep.episodeNumber > 0
        ? `${showDisplayLabel(showName, overrides)} S${String(season.seasonNumber).padStart(2, '0')}E${String(ep.episodeNumber).padStart(2, '0')}`
        : '';
    return episodeDisplayLabel(ep, overrides, prefix);
}

/**
 * Rebuilds what the player screen should play from its route params. The params carry only the
 * file's library key (`parsedPath`) and the start time; the `content://` URI never goes through
 * the URL and is looked up here instead, so a screen restored from its params still has
 * something to play. Returns null when there is no key or the library has no such file.
 */
export function resolveVideoRequest(
    library: Pick<LibraryState, 'mediaLibrary' | 'movies' | 'mediaOverrides'>,
    parsedPath: string | undefined,
    startAt: string | undefined,
): VideoRequest | null {
    if (!parsedPath) return null;
    const { mediaLibrary, movies, mediaOverrides } = library;
    const start = Number(startAt);
    const request = (file: IMediaObject, title: string): VideoRequest => ({
        path: file.path,
        parsedPath,
        filename: file.filename,
        title,
        startAt: Number.isFinite(start) && start > 0 ? start : 0,
    });

    const movie = movies.find((m) => m.parsedPath === parsedPath);
    if (movie) return request(movie, movieDisplayLabel(movie, mediaOverrides));

    for (const [showName, show] of Object.entries(mediaLibrary)) {
        for (const season of Object.values(show.seasons)) {
            for (const ep of Object.values(season.episodes)) {
                if (ep.parsedPath !== parsedPath) continue;
                return request(ep, episodeTitle(showName, season, ep, mediaOverrides));
            }
        }
    }
    return null;
}

/** Natural (numeric-aware) ordering, as the browse screen sorts titles. */
const NATURAL_SORT_OPTS: Intl.CollatorOptions = { numeric: true, sensitivity: 'base' };

/**
 * Orders two episodes of a season as the browse screen does (`compareEpisodes` in
 * `MediaBrowserScreen.tsx`): by title when either has a `sortTitle` override, else by episode
 * number, then title. Duplicated rather than imported because that module is a UI screen.
 */
function compareEpisodes(a: IMediaObject, b: IMediaObject, overrides: { [key: string]: IMediaOverride }): number {
    const aO = overrides[`episode:${a.parsedPath}`];
    const bO = overrides[`episode:${b.parsedPath}`];
    if (aO?.sortTitle || bO?.sortTitle) {
        const aKey = aO?.sortTitle ?? aO?.title ?? a.resolvedTitle ?? a.title ?? a.filename;
        const bKey = bO?.sortTitle ?? bO?.title ?? b.resolvedTitle ?? b.title ?? b.filename;
        return aKey.localeCompare(bKey, undefined, NATURAL_SORT_OPTS);
    }
    if (a.episodeNumber !== b.episodeNumber) return a.episodeNumber - b.episodeNumber;
    return (a.resolvedTitle ?? a.title ?? a.filename).localeCompare(b.resolvedTitle ?? b.title ?? b.filename, undefined, NATURAL_SORT_OPTS);
}

/** The episode the player offers after the one that just played. */
export interface NextEpisode {
    /** The file's SAF `content://` URI (for `setEpisodeLastOpened`). */
    path: string;
    /** The file's library key; also what the player route takes. */
    parsedPath: string;
    /** Display label, as `resolveVideoRequest` gives it. */
    title: string;
}

/**
 * The episode that follows `parsedPath` in browse order: the next one in its season, else the
 * first of the next season (by season number). Hidden episodes are skipped, so a season that is
 * hidden episode by episode is passed over. Null for a movie, a key the library does not have,
 * or the last episode of the show.
 */
export function nextEpisode(
    library: Pick<LibraryState, 'mediaLibrary' | 'mediaOverrides'>,
    parsedPath: string | undefined,
): NextEpisode | null {
    if (!parsedPath) return null;
    const { mediaLibrary, mediaOverrides } = library;
    for (const [showName, show] of Object.entries(mediaLibrary)) {
        const seasons = Object.values(show.seasons).sort((a, b) => a.seasonNumber - b.seasonNumber);
        // Every episode of the show in play order; the current one is found in it even if hidden.
        const ordered = seasons.flatMap((season) =>
            Object.values(season.episodes)
                .sort((a, b) => compareEpisodes(a, b, mediaOverrides))
                .map((ep) => ({ season, ep })),
        );
        const index = ordered.findIndex(({ ep }) => ep.parsedPath === parsedPath);
        if (index < 0) continue;
        const next = ordered.slice(index + 1).find(({ ep }) => !mediaOverrides[`episode:${ep.parsedPath}`]?.hidden);
        if (!next) return null;
        return { path: next.ep.path, parsedPath: next.ep.parsedPath, title: episodeTitle(showName, next.season, next.ep, mediaOverrides) };
    }
    return null;
}

/**
 * Whether the device can show none of a loaded video's pictures. ExoPlayer then skips the video
 * track without raising an error, so the file plays as sound over a black screen. Returns the
 * first track's mime type ('unknown' when it has none), or null when there is no problem.
 * `isSupported` is Android-only, so only an explicit `false` counts, and an empty list (nothing
 * known yet, or an audio-only file) is not a problem.
 */
export function unsupportedVideoTrack(tracks: readonly Pick<VideoTrack, 'isSupported' | 'mimeType'>[]): string | null {
    if (tracks.length === 0 || !tracks.every((t) => t.isSupported === false)) return null;
    return tracks[0].mimeType ?? 'unknown';
}

/** The fields of an audio or subtitle track that the picker reads. */
type LanguageTrack = Pick<AudioTrack | SubtitleTrack, 'id' | 'language' | 'label' | 'name'>;

/** The language's primary subtag, lowercased: 'en-GB' and 'en_US' both give 'en'. */
const primaryLanguage = (language: string) => language.toLowerCase().split(/[-_]/)[0];

/**
 * The track to use for a remembered language: the first with exactly that code, else the first
 * sharing its primary subtag ('en' finds 'en-GB'), compared case-insensitively. Codes are not
 * translated between 2- and 3-letter forms; the remembered code comes from a track's own
 * `language`, so the same file family reports it the same way. Null when nothing matches.
 */
export function preferredTrack<T extends Pick<LanguageTrack, 'language'>>(tracks: readonly T[], language: string): T | null {
    const wanted = language.trim().toLowerCase();
    if (!wanted) return null;
    return tracks.find((t) => t.language?.toLowerCase() === wanted)
        ?? tracks.find((t) => t.language && primaryLanguage(t.language) === primaryLanguage(wanted))
        ?? null;
}

/** Whether two tracks (possibly distinct objects from different reads) are the same one. */
export function sameTrack(a: LanguageTrack | null | undefined, b: LanguageTrack | null | undefined): boolean {
    if (!a || !b) return false;
    if (a.id !== undefined && b.id !== undefined) return a.id === b.id;
    return a.language === b.language && a.label === b.label && a.name === b.name;
}

/** A readable name for one track: its label, else its name, else its language, else 'Unknown'. */
export function trackLabel(track: Pick<LanguageTrack, 'label' | 'name' | 'language'>): string {
    return track.label?.trim() || track.name?.trim() || track.language?.trim() || 'Unknown';
}

/**
 * Labels for a list of tracks, one per track in order. Tracks that would read the same (two
 * English audio tracks) get their `name` appended when it tells them apart, then a running number.
 */
export function trackLabels(tracks: readonly LanguageTrack[]): string[] {
    const base = tracks.map(trackLabel);
    const named = tracks.map((t, i) => {
        const name = t.name?.trim();
        const duplicated = base.filter((b) => b === base[i]).length > 1;
        return duplicated && name && name !== base[i] ? `${base[i]} - ${name}` : base[i];
    });
    const seen = new Map<string, number>();
    return named.map((label) => {
        if (named.filter((n) => n === label).length < 2) return label;
        const n = (seen.get(label) ?? 0) + 1;
        seen.set(label, n);
        return `${label} ${n}`;
    });
}
