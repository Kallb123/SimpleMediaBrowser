import type { IWatchProgress } from '@/store/libraryReducer';

// Pure helpers for in-app video resume (see `VideoProgressTracker.ts`). Only type-only imports,
// so the browse UI and tests can use them without the player.

/** Past this fraction of its length a video counts as watched (end credits), and its resume point is dropped. */
export const WATCHED_FRACTION = 0.9;

/** Saved positions earlier than this aren't worth offering to resume. */
export const MIN_RESUME_SECONDS = 10;

/** True once `position` is at least WATCHED_FRACTION of a known `duration`. */
export function isWatchedPosition(position: number, duration: number): boolean {
    if (!Number.isFinite(position) || !(duration > 0)) return false;
    return position >= duration * WATCHED_FRACTION;
}

/**
 * Where a video with `progress` can be resumed from, in seconds, or 0 when it should start from the
 * beginning: no progress, a non-finite/negative position, earlier than MIN_RESUME_SECONDS, or already
 * past the watched threshold / at or beyond the end of a known duration.
 */
export function resumePosition(progress: IWatchProgress | undefined): number {
    if (!progress) return 0;
    const { position, duration } = progress;
    if (!Number.isFinite(position) || position < MIN_RESUME_SECONDS) return 0;
    if (isWatchedPosition(position, duration)) return 0;
    if (duration > 0 && position >= duration) return 0;
    return position;
}
