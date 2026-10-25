import { audioPartFiles } from '@/scripts/libraryUtils';
import type { IListenProgress, IMediaAudiobook } from '@/store/libraryReducer';

// Pure helpers for in-app audiobook resume (see `AudiobookPlayer.ts`). Only type-only imports
// besides `audioPartFiles`, so the browse UI and tests can use them without the player.

/** The `audioPartFiles` index of the part `progress` points at, or -1 (no progress / part gone after a rescan). */
function savedPartIndex(audiobook: IMediaAudiobook, progress: IListenProgress | undefined): number {
    if (!progress) return -1;
    return audioPartFiles(audiobook.files).findIndex((file) => file.parsedPath === progress.partPath);
}

/** A saved position that is usable for seeking: finite, non-negative, and not at/after the end of a part of known length. */
function usablePosition(progress: IListenProgress): number {
    const { position, duration } = progress;
    if (!Number.isFinite(position) || position < 0) return 0;
    if (duration > 0 && position >= duration) return 0;
    return position;
}

/**
 * Where playback of `audiobook` should begin.
 *
 * - No part requested: resume the saved part at its saved position, or start the book if there is
 *   no progress or the saved part no longer exists (e.g. after a rescan).
 * - A part requested (its index in `audioPartFiles`): resume it if it is the saved part,
 *   otherwise start that part from 0.
 */
export function resolveStartPoint(
    audiobook: IMediaAudiobook,
    progress: IListenProgress | undefined,
    requestedPartIndex?: number,
): { partIndex: number; position: number } {
    const partCount = audioPartFiles(audiobook.files).length;
    const savedIndex = savedPartIndex(audiobook, progress);
    const saved = progress && savedIndex >= 0 ? { index: savedIndex, position: usablePosition(progress) } : undefined;

    if (requestedPartIndex !== undefined && requestedPartIndex >= 0 && requestedPartIndex < partCount) {
        return {
            partIndex: requestedPartIndex,
            position: saved?.index === requestedPartIndex ? saved.position : 0,
        };
    }
    return saved ? { partIndex: saved.index, position: saved.position } : { partIndex: 0, position: 0 };
}

/** Fraction (0..1) of the part `progress` is in that has been played; 0 when its length is unknown. */
function partFraction(progress: IListenProgress): number {
    if (!(progress.duration > 0) || !Number.isFinite(progress.position)) return 0;
    return Math.min(1, Math.max(0, progress.position / progress.duration));
}

/**
 * How far through the whole book the saved progress is, as 0..1: parts before the saved one count
 * as complete, plus the saved part's own fraction (0 when its length is unknown). Undefined when
 * there is no progress, or its part is not among the book's current parts.
 */
export function audiobookProgressFraction(
    audiobook: IMediaAudiobook,
    progress: IListenProgress | undefined,
): number | undefined {
    const partCount = audioPartFiles(audiobook.files).length;
    const index = savedPartIndex(audiobook, progress);
    if (!progress || partCount === 0 || index < 0) return undefined;
    return Math.min(1, Math.max(0, (index + partFraction(progress)) / partCount));
}

/**
 * Progress of a single part row: its own fraction when it is the saved part, otherwise undefined
 * (other parts show nothing, whether played or not).
 */
export function partProgressFraction(progress: IListenProgress | undefined, partPath: string): number | undefined {
    if (!progress || progress.partPath !== partPath) return undefined;
    return partFraction(progress);
}
