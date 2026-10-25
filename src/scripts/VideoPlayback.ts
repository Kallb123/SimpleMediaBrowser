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

let current: VideoRequest | null = null;

/**
 * Hands the next video to the player screen. A module variable rather than route params, so a
 * `content://` URI never has to survive URL encoding. It does not outlive the process: a screen
 * restored without a request has nothing to play.
 */
export function setVideoRequest(request: VideoRequest): void {
    current = request;
}

export function getVideoRequest(): VideoRequest | null {
    return current;
}
