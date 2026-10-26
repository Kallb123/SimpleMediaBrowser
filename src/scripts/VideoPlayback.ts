import { episodeDisplayLabel, movieDisplayLabel, showDisplayLabel } from '@/scripts/mediaLabels';
// Type-only imports, so this module (and the tests that load it) never pulls in the store.
import type { IMediaObject } from '@/scripts/libraryUtils';
import type { LibraryState } from '@/store/libraryReducer';
import type { VideoTrack } from 'expo-video';

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
                // The same label the 'flat' browse view builds for the episode.
                const prefix = ep.episodeNumber > 0
                    ? `${showDisplayLabel(showName, mediaOverrides)} S${String(season.seasonNumber).padStart(2, '0')}E${String(ep.episodeNumber).padStart(2, '0')}`
                    : '';
                return request(ep, episodeDisplayLabel(ep, mediaOverrides, prefix));
            }
        }
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
