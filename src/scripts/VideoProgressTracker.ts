import { AppState } from 'react-native';
import type { VideoPlayerEvents } from 'expo-video';
import { librarySink } from '@/scripts/librarySink';
import { logger } from '@/scripts/Logger';
import { isWatchedPosition } from '@/scripts/videoProgress';
import { clearWatchProgress, markWatched, setWatchProgress } from '@/store/libraryReducer';

const TAG = 'VideoProgressTracker';

/** While playing, progress is saved at most this often (each save notifies every store subscriber and triggers a library autosave). */
const SAVE_INTERVAL_MS = 10_000;

type TrackedEvents = Pick<VideoPlayerEvents, 'timeUpdate' | 'playingChange' | 'playToEnd'>;

/** The part of expo-video's `VideoPlayer` the tracker uses, so tests can pass a fake. */
export interface TrackedVideoPlayer {
    readonly currentTime: number;
    readonly duration: number;
    addListener<E extends keyof TrackedEvents>(event: E, listener: TrackedEvents[E]): { remove(): void };
}

/**
 * Keeps the watch progress of one video while it plays: a resume point in `watchProgress`, and the
 * file marked watched (resume point dropped) once it gets past WATCHED_FRACTION or plays to its end.
 * Reaches Redux only through `librarySink`.
 *
 * Create it once the player exists and `dispose()` it when the screen goes away, before the player
 * is released: the final position is read from the player then.
 */
export class VideoProgressTracker {
    private readonly subscriptions: { remove(): void }[];
    private disposed = false;
    /**
     * Starts at construction rather than 0, so the first timed save waits a full interval: the screen
     * seeks to the resume point once the video is ready, and a tick before that must not overwrite it.
     */
    private lastSaveAt = Date.now();
    /** The file has been marked watched during this session; it is marked only once. */
    private markedWatched = false;
    /** A resume point may exist in the store (from an earlier session, or saved since the last clear). */
    private progressMayExist = true;
    /** The video played to its end and has not been moved back since: its position no longer means anything. */
    private ended = false;

    constructor(
        private readonly player: TrackedVideoPlayer,
        private readonly parsedPath: string,
    ) {
        this.subscriptions = [
            player.addListener('timeUpdate', ({ currentTime }) => this.onTimeUpdate(currentTime)),
            player.addListener('playingChange', ({ isPlaying }) => {
                if (!isPlaying) this.save();
            }),
            player.addListener('playToEnd', () => this.onPlayToEnd()),
            AppState.addEventListener('change', this.onAppState),
        ];
    }

    /** Saves the final position and stops listening. Safe to call more than once. */
    dispose(): void {
        if (this.disposed) return;
        this.save();
        this.disposed = true;
        for (const subscription of this.subscriptions) subscription.remove();
        this.subscriptions.length = 0;
    }

    private onTimeUpdate(position: number): void {
        if (this.disposed || !Number.isFinite(position)) return;
        // Playing again from before the end (replay, or a seek back) means progress counts once more.
        const watchedPosition = isWatchedPosition(position, this.duration());
        if (this.ended && !watchedPosition) this.ended = false;
        // Checked on every tick: crossing the threshold must not wait for the next timed save.
        if (watchedPosition) this.reachWatched();
        else if (Date.now() - this.lastSaveAt >= SAVE_INTERVAL_MS) this.save(position);
    }

    private onPlayToEnd(): void {
        if (this.disposed) return;
        this.ended = true;
        this.reachWatched();
    }

    /** The app left the foreground: it may be killed, so keep the place. */
    private onAppState = (state: string): void => {
        if (state !== 'active') this.save();
    };

    /** Saves `position` (or the player's own). Past the watched threshold it marks the file watched instead. */
    private save(position?: number): void {
        if (this.disposed || this.ended) return;
        const at = position ?? this.readPosition();
        if (!Number.isFinite(at)) return;
        const duration = this.duration();
        // Nothing has loaded yet (or the file failed to): there is no place to keep.
        if (duration === 0 && at <= 0) return;
        if (isWatchedPosition(at, duration)) {
            this.reachWatched();
            return;
        }
        this.lastSaveAt = Date.now();
        this.progressMayExist = true;
        librarySink.dispatch(setWatchProgress({
            key: this.parsedPath,
            progress: { position: Math.max(0, at), duration, updatedAt: this.lastSaveAt },
        }));
    }

    /** Past the threshold: tick the file once, and drop the resume point (again, if one was saved after seeking back). */
    private reachWatched(): void {
        if (!this.markedWatched) {
            this.markedWatched = true;
            logger.log(TAG, `Watched: ${this.parsedPath}`);
            librarySink.dispatch(markWatched({ keys: [this.parsedPath], watchedAt: Date.now() }));
        }
        if (this.progressMayExist) {
            this.progressMayExist = false;
            librarySink.dispatch(clearWatchProgress(this.parsedPath));
        }
    }

    private duration(): number {
        const duration = this.safeRead(() => this.player.duration);
        return Number.isFinite(duration) && duration > 0 ? duration : 0;
    }

    private readPosition(): number {
        return this.safeRead(() => this.player.currentTime);
    }

    /** A player that has already been released can throw on access; that reads as "unknown". */
    private safeRead(read: () => number): number {
        try {
            return read();
        } catch (e) {
            logger.warn(TAG, 'Could not read the player', e);
            return NaN;
        }
    }
}
