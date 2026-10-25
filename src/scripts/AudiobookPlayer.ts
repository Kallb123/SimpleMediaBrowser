import { AppState } from 'react-native';
import { createAudioPlayer, setAudioModeAsync } from 'expo-audio';
import type { AudioPlayer, AudioStatus } from 'expo-audio';
import { librarySink } from '@/scripts/librarySink';
import { logger } from '@/scripts/Logger';
import { audioPartFiles } from '@/scripts/libraryUtils';
import { resolveStartPoint, rewindOnResume } from '@/scripts/audiobookProgress';
import { clearListenProgress, markWatched, setAudiobookLastOpened, setListenProgress } from '@/store/libraryReducer';
import type { IMediaAudiobook } from '@/store/libraryReducer';
import { setAudiobookPlaybackRate } from '@/store/settingsReducer';

const TAG = 'AudiobookPlayer';

/** While playing, progress is saved at most this often (each save notifies every store subscriber and triggers a library autosave). */
const SAVE_INTERVAL_MS = 10_000;

/** "Previous" restarts the current part when it is further in than this, instead of going back a part. */
const RESTART_THRESHOLD_SECONDS = 3;

const LOAD_ERROR_MESSAGE = 'This file could not be played.';

/** Length of the player screen's skip back / forward buttons. (The lock-screen ones are a fixed 10 s natively.) */
export const SKIP_INTERVAL_SECONDS = 30;

/** Selectable playback speeds. */
export const PLAYBACK_RATES: readonly number[] = [0.75, 1, 1.25, 1.5, 1.75, 2];

/** Selectable sleep-timer lengths, in minutes (the other option is "end of the current part"). */
export const SLEEP_TIMER_MINUTES: readonly number[] = [15, 30, 45, 60];

/** Stops playback after a while (`endsAt` is a `Date.now()` time) or when the current part ends. */
export type SleepTimer = { kind: 'duration'; endsAt: number } | { kind: 'endOfPart' };

/** What the in-app player has loaded; observable via `subscribe` / `getSnapshot`. */
export interface NowPlaying {
    folderKey: string;
    /** Index of the current part in `audioPartFiles(audiobook.files)`. */
    partIndex: number;
    audiobook: IMediaAudiobook;
    /** Display title (the `audiobook:<folderKey>` override, if any, wins over the scanned/provider title). */
    title: string;
    /** Cover URI ('' when none), override first. */
    poster: string;
    /** The last part has played to its end (progress was cleared; the book stays loaded). */
    finished: boolean;
    /** Set when the current part failed to load; cleared by the next load. */
    error: string | null;
    /** Active sleep timer, if any. Survives switching parts and books. */
    sleepTimer: SleepTimer | null;
}

/** A part that has been asked for but is not ready to play yet. */
interface PendingLoad {
    token: number;
    /** Where to seek once the part is loaded. */
    position: number;
    /** `player.replace` has been called, so player events now describe the new part rather than the old one. */
    replaced: boolean;
    /**
     * The player has reported buffering since `replace`. Android applies `replace` asynchronously and
     * emits a status from `setMediaSource` before `prepare`, which still says "idle" when the player
     * had no source (first play) or had failed, so "idle" only means failure after this.
     */
    started: boolean;
    /** Start playing once loaded; false after a sleep timer ended the previous part, so the next one waits for play. */
    autoplay: boolean;
}

/**
 * Plays audiobooks in the app, keeps the listening position and moves through the parts.
 *
 * A singleton owning ONE expo-audio player, so playback (and the lock-screen controls) outlives
 * any screen; the player screen just observes it. Reaches Redux only through `librarySink`:
 * resume points go to `listenProgress`, a part that plays to its end is marked watched.
 */
export class AudiobookPlayer {
    private static _instance: AudiobookPlayer | null = null;

    static getInstance(): AudiobookPlayer {
        if (!AudiobookPlayer._instance) {
            AudiobookPlayer._instance = new AudiobookPlayer();
        }
        return AudiobookPlayer._instance;
    }

    private player: AudioPlayer | null = null;
    private audioModeReady: Promise<void> | null = null;
    private audioModeSet = false;

    private snapshot: NowPlaying | null = null;
    private readonly listeners = new Set<() => void>();

    private pending: PendingLoad | null = null;
    private loadToken = 0;
    /** Length of the loaded part in seconds (0 until known). */
    private partDuration = 0;
    /** Whether the last status event said the player was playing (the player's own flag drops while buffering). */
    private lastPlaying = false;
    private lastSaveAt = 0;
    /** When playback last stopped (not at a part's end), for rewind on resume; null once consumed, or after a seek or load. */
    private pausedAt: number | null = null;

    private constructor() {}

    // ── Observable "now playing" (useSyncExternalStore contract) ──────────────

    subscribe = (listener: () => void): (() => void) => {
        this.listeners.add(listener);
        return () => { this.listeners.delete(listener); };
    };

    /** Referentially stable until something in it changes. */
    getSnapshot = (): NowPlaying | null => this.snapshot;

    /** The underlying player, for `useAudioPlayerStatus` (live position, duration, playing). */
    getPlayer(): AudioPlayer {
        return this.ensurePlayer();
    }

    // ── Transport ─────────────────────────────────────────────────────────────

    /**
     * Plays `audiobook`. The book already being loaded just resumes (no reload) unless a different
     * part is asked for. Otherwise playback starts where `resolveStartPoint` says: the saved spot,
     * or the requested part (from 0 unless it is the saved part).
     */
    async play(audiobook: IMediaAudiobook, partIndex?: number): Promise<void> {
        const parts = audioPartFiles(audiobook.files);
        if (parts.length === 0) {
            logger.warn(TAG, `Nothing to play in "${audiobook.title}" (${audiobook.folderKey}): no audio files`);
            return;
        }
        librarySink.dispatch(setAudiobookLastOpened({ folderKey: audiobook.folderKey, lastOpened: Date.now() }));

        const now = this.snapshot;
        const alreadyLoaded = now?.folderKey === audiobook.folderKey && !now.error && !now.finished;
        if (now && alreadyLoaded && (partIndex === undefined || partIndex === now.partIndex)) {
            if (!this.pending && !this.isPlaying()) this.resume();
            return;
        }

        // Leaving another book: keep its place before the player is reused.
        if (now && now.folderKey !== audiobook.folderKey) this.saveProgress();

        const progress = librarySink.getState().libraryReducer.listenProgress[audiobook.folderKey];
        const start = resolveStartPoint(audiobook, progress, partIndex);
        // A position above 0 can only come from the saved progress (any other part starts at 0), so
        // reopening the book after a while steps back like resuming after a pause does.
        const position = progress && start.position > 0
            ? rewindOnResume(start.position, this.rewindSeconds(), Date.now() - progress.updatedAt)
            : start.position;
        await this.startLoad(audiobook, start.partIndex, position);
    }

    togglePlayPause(): void {
        const now = this.snapshot;
        const player = this.player;
        if (!now || !player) return;
        if (now.finished || now.error) {
            // Start over after the last part, or retry after a failed load.
            void this.play(now.audiobook, now.error ? now.partIndex : undefined);
            return;
        }
        if (this.pending) return;
        if (this.isPlaying()) player.pause();
        else this.resume();
    }

    /**
     * Relative seek within the current part (negative = back). Forward never reaches the very end: ending
     * a paused part would auto-advance and start playing the next one.
     */
    skipBy(seconds: number): void {
        const player = this.player;
        const now = this.snapshot;
        if (!player || !now || now.error || this.pending || !Number.isFinite(seconds)) return;
        const from = player.currentTime;
        if (!Number.isFinite(from)) return;
        let target = Math.max(0, from + seconds);
        if (seconds > 0 && this.partDuration > 0) target = Math.min(target, Math.max(from, this.partDuration - 1));
        if (target === from) return;
        void this.seekTo(target);
    }

    /** Stores the playback speed (remembered across books and restarts) and applies it to the player. */
    setPlaybackRate(rate: number): void {
        librarySink.dispatch(setAudiobookPlaybackRate(rate));
        this.applyPlaybackRate();
    }

    /** Sets (`{ minutes }` / `'endOfPart'`) or clears (`null`) the sleep timer. It needs a loaded book to live in. */
    setSleepTimer(option: { minutes: number } | 'endOfPart' | null): void {
        const now = this.snapshot;
        if (!now) return;
        let timer: SleepTimer | null = null;
        if (option === 'endOfPart') {
            timer = { kind: 'endOfPart' };
        } else if (option) {
            if (!(option.minutes > 0)) return;
            timer = { kind: 'duration', endsAt: Date.now() + option.minutes * 60_000 };
        }
        logger.log(TAG, `Sleep timer: ${timer === null ? 'cleared' : timer.kind === 'endOfPart' ? 'end of part' : `${Math.round((timer.endsAt - Date.now()) / 60_000)} min`}`);
        this.setSnapshot({ ...now, sleepTimer: timer });
    }

    async seekTo(seconds: number): Promise<void> {
        const player = this.player;
        const before = this.snapshot;
        if (!player || !before || before.error || this.pending) return;
        const target = Math.max(0, this.partDuration > 0 ? Math.min(seconds, this.partDuration) : seconds);
        // The listener picked this spot on purpose, so resuming from it must not step back further.
        this.pausedAt = null;
        const token = this.loadToken;
        try {
            await player.seekTo(target);
        } catch (e) {
            logger.warn(TAG, 'Seek failed', e);
            return;
        }
        if (token !== this.loadToken || !this.snapshot) return;
        // Seeking in a finished book starts listening again, so progress is tracked once more.
        if (this.snapshot.finished) this.setSnapshot({ ...this.snapshot, finished: false });
        this.saveProgress(target);
    }

    /** Skips to the next part (from 0, and playing); does nothing on the last part. */
    nextPart(): void {
        const now = this.snapshot;
        if (!now) return;
        if (now.partIndex + 1 >= audioPartFiles(now.audiobook.files).length) return;
        void this.startLoad(now.audiobook, now.partIndex + 1, 0);
    }

    /** Restarts the current part when more than a few seconds in, otherwise goes back a part. */
    previousPart(): void {
        const now = this.snapshot;
        const player = this.player;
        if (!now || !player) return;
        const position = this.pending ? 0 : player.currentTime;
        if (now.partIndex === 0 || position > RESTART_THRESHOLD_SECONDS) {
            if (this.pending) return;
            void this.seekTo(0);
            return;
        }
        void this.startLoad(now.audiobook, now.partIndex - 1, 0);
    }

    // ── Loading ───────────────────────────────────────────────────────────────

    /**
     * Points the player at a part and, once it has loaded, seeks to `position` and plays (unless `autoplay` is false).
     * The snapshot is updated synchronously (before any await) so a screen opened right after
     * `play()` already sees the book.
     */
    private async startLoad(audiobook: IMediaAudiobook, partIndex: number, position: number, autoplay = true): Promise<void> {
        const parts = audioPartFiles(audiobook.files);
        const part = parts[partIndex];
        if (!part) return;

        const token = ++this.loadToken;
        const { title, poster } = this.displayFor(audiobook);
        this.pending = { token, position, replaced: false, started: false, autoplay };
        this.partDuration = 0;
        this.lastPlaying = false;
        this.pausedAt = null;
        this.setSnapshot({
            folderKey: audiobook.folderKey,
            partIndex,
            audiobook,
            title,
            poster,
            finished: false,
            error: null,
            sleepTimer: this.snapshot?.sleepTimer ?? null,
        });

        try {
            const player = this.ensurePlayer();
            if (!this.audioModeSet) {
                await this.ensureAudioMode();
                if (token !== this.loadToken) return; // superseded while the audio mode was being set
            }
            // Pause first: `replace` would otherwise carry on playing the new part from 0 before the seek.
            player.pause();
            player.replace(part.path);
            if (this.pending?.token === token) this.pending.replaced = true;
            this.activateLockScreen(player, audiobook, title, poster, partIndex, parts.length);
            logger.log(TAG, `Loading part ${partIndex + 1}/${parts.length} of "${title}" at ${Math.round(position)}s`);
        } catch (e) {
            this.fail(token, `Failed to load ${part.path}`, e);
        }
    }

    /** Called with status events while a part is loading; starts playback when the part is ready. */
    private onLoadStatus(pending: PendingLoad, status: AudioStatus): void {
        const player = this.player;
        if (!player || !pending.replaced) return;
        // The live flag, not the event's: events queued before `replace` can still say "loaded".
        if (player.isLoaded) {
            this.pending = null;
            const duration = player.duration;
            this.partDuration = duration > 0 ? duration : 0;
            const position = this.partDuration > 0 && pending.position >= this.partDuration ? 0 : pending.position;
            if (position > 0) {
                player.seekTo(position).catch((e: unknown) => logger.warn(TAG, 'Seek to saved position failed', e));
            }
            // Applied per part: it is cheap, and not every native player keeps the rate across `replace`.
            this.applyPlaybackRate();
            // A duration timer that ran out while the part loaded (e.g. at a part boundary) stops here: the
            // first playing event after a load reads as a resume, which would drop the timer instead.
            const timer = this.snapshot?.sleepTimer;
            const timerEnded = timer?.kind === 'duration' && Date.now() >= timer.endsAt;
            if (timerEnded && this.snapshot) {
                logger.log(TAG, 'Sleep timer ended while a part loaded, not starting it');
                this.setSnapshot({ ...this.snapshot, sleepTimer: null });
            }
            if (pending.autoplay && !timerEnded) player.play();
            this.saveProgress(position);
        } else if (status.playbackState === 'buffering') {
            pending.started = true;
        } else if (status.playbackState === 'idle' && pending.started) {
            // Android reports no load error event; a part that falls back to idle instead of loading failed.
            const now = this.snapshot;
            this.fail(pending.token, `Part ${now ? now.partIndex + 1 : '?'} of ${now?.folderKey ?? '?'} did not load`);
        }
    }

    private fail(token: number, message: string, error?: unknown): void {
        if (token !== this.loadToken) return;
        this.pending = null;
        logger.error(TAG, message, error);
        if (this.snapshot) this.setSnapshot({ ...this.snapshot, error: LOAD_ERROR_MESSAGE });
    }

    // ── Player events ─────────────────────────────────────────────────────────

    private onStatus = (status: AudioStatus): void => {
        if (!this.snapshot) return;
        if (this.pending) {
            this.onLoadStatus(this.pending, status);
            return;
        }
        if (status.didJustFinish) {
            this.lastPlaying = false;
            this.handleFinished();
            return;
        }
        const wasPlaying = this.lastPlaying;
        this.lastPlaying = status.playing;
        if (this.enforceSleepTimer(wasPlaying, status)) return;
        if (status.playing) {
            if (this.snapshot.finished) this.setSnapshot({ ...this.snapshot, finished: false });
            if (!wasPlaying) this.rewindAfterOutsideResume(status.currentTime);
            if (Date.now() - this.lastSaveAt >= SAVE_INTERVAL_MS) this.saveProgress(status.currentTime);
        } else if (wasPlaying) {
            this.pausedAt = Date.now();
            this.saveProgress(status.currentTime);
        }
    };

    /**
     * Enforces an expired duration timer from the status events (a JS timer would not fire reliably with
     * the app in the background, but these keep arriving while playing). Returns true when it paused playback.
     */
    private enforceSleepTimer(wasPlaying: boolean, status: AudioStatus): boolean {
        const now = this.snapshot;
        const timer = now?.sleepTimer;
        if (!now || timer?.kind !== 'duration' || Date.now() < timer.endsAt) return false;
        this.setSnapshot({ ...now, sleepTimer: null });
        // Expired while paused, or this event is the resume itself: drop it quietly so play does not pause again.
        if (!wasPlaying || !status.playing || !this.player) return false;
        logger.log(TAG, 'Sleep timer ended, pausing');
        this.player.pause();
        this.lastPlaying = false;
        this.pausedAt = Date.now();
        this.saveProgress(status.currentTime);
        return true;
    }

    /** Resumed from outside the app (lock screen, headset, audio focus back): step back like the in-app resume does. */
    private rewindAfterOutsideResume(currentTime: number): void {
        const pausedAt = this.pausedAt;
        this.pausedAt = null;
        const player = this.player;
        if (pausedAt === null || !player) return;
        const target = rewindOnResume(currentTime, this.rewindSeconds(), Date.now() - pausedAt);
        if (target === currentTime) return;
        player.seekTo(target).catch((e: unknown) => logger.warn(TAG, 'Rewind on resume failed', e));
        this.saveProgress(target);
    }

    /** Resumes the loaded part from the app, stepping back if it has been paused for a while. */
    private resume(): void {
        const player = this.player;
        const now = this.snapshot;
        if (!player || !now) return;
        // An expired timer must not pause the playback this starts.
        if (now.sleepTimer?.kind === 'duration' && Date.now() >= now.sleepTimer.endsAt) {
            this.setSnapshot({ ...now, sleepTimer: null });
        }
        // Consumed before `play()`, so the status event that reports the resume does not rewind again.
        const pausedAt = this.pausedAt;
        this.pausedAt = null;
        if (pausedAt !== null) {
            const from = player.currentTime;
            const target = rewindOnResume(from, this.rewindSeconds(), Date.now() - pausedAt);
            if (target !== from) {
                player.seekTo(target).catch((e: unknown) => logger.warn(TAG, 'Rewind on resume failed', e));
                this.saveProgress(target);
            }
        }
        player.play();
    }

    /** The app left the foreground: it may be killed, so keep the place of anything still playing. */
    private onAppState = (state: string): void => {
        if (state !== 'active' && this.isPlaying()) this.saveProgress();
    };

    /** A part played to its end: tick it, then go on to the next part or, after the last, finish the book. */
    private handleFinished(): void {
        const now = this.snapshot;
        if (!now) return;
        const parts = audioPartFiles(now.audiobook.files);
        const part = parts[now.partIndex];
        if (part) librarySink.dispatch(markWatched({ keys: [part.parsedPath], watchedAt: Date.now() }));

        // An "end of part" sleep timer is used up here: the next part is loaded but left waiting for play.
        const sleeping = now.sleepTimer?.kind === 'endOfPart';
        if (sleeping) {
            logger.log(TAG, 'Sleep timer ended at the end of the part');
            this.setSnapshot({ ...now, sleepTimer: null });
        }

        const next = parts[now.partIndex + 1];
        if (next) {
            logger.log(TAG, `Part ${now.partIndex + 1} of "${now.title}" finished, ${sleeping ? 'waiting on the next part' : 'advancing'}`);
            // Persist the move now, so a restart before the next part has loaded resumes at its start.
            this.dispatchProgress(now.folderKey, next.parsedPath, 0, 0);
            void this.startLoad(now.audiobook, now.partIndex + 1, 0, !sleeping);
        } else {
            logger.log(TAG, `"${now.title}" finished`);
            librarySink.dispatch(clearListenProgress(now.folderKey));
            // The book is over, so any timer (even a duration one) has nothing left to stop.
            this.setSnapshot({ ...now, finished: true, sleepTimer: null });
        }
    }

    // ── Progress ──────────────────────────────────────────────────────────────

    /** Saves where the current part is (`position`, or the player's own). No-op unless a part is loaded and in progress. */
    private saveProgress(position?: number): void {
        const now = this.snapshot;
        const player = this.player;
        if (!now || !player || this.pending || now.finished || now.error) return;
        const part = audioPartFiles(now.audiobook.files)[now.partIndex];
        if (!part) return;
        const at = position ?? player.currentTime;
        if (!Number.isFinite(at)) return;
        this.dispatchProgress(now.folderKey, part.parsedPath, Math.max(0, at), this.partDuration > 0 ? this.partDuration : player.duration);
    }

    private dispatchProgress(folderKey: string, partPath: string, position: number, duration: number): void {
        this.lastSaveAt = Date.now();
        librarySink.dispatch(setListenProgress({
            folderKey,
            progress: { partPath, position, duration: duration > 0 ? duration : 0, updatedAt: this.lastSaveAt },
        }));
    }

    // ── Setup ─────────────────────────────────────────────────────────────────

    private ensurePlayer(): AudioPlayer {
        if (!this.player) {
            this.player = createAudioPlayer(null);
            this.player.addListener('playbackStatusUpdate', this.onStatus);
            AppState.addEventListener('change', this.onAppState);
        }
        return this.player;
    }

    /** Configures the audio session once: background playback with exclusive focus (lock-screen controls need `doNotMix`). */
    private ensureAudioMode(): Promise<void> {
        this.audioModeReady ??= setAudioModeAsync({
            playsInSilentMode: true,
            shouldPlayInBackground: true,
            interruptionMode: 'doNotMix',
        }).catch((e: unknown) => {
            logger.warn(TAG, 'Failed to configure the audio mode', e);
        }).finally(() => {
            this.audioModeSet = true;
        });
        return this.audioModeReady;
    }

    private activateLockScreen(
        player: AudioPlayer,
        audiobook: IMediaAudiobook,
        title: string,
        poster: string,
        partIndex: number,
        partCount: number,
    ): void {
        try {
            player.setActiveForLockScreen(
                true,
                {
                    title,
                    artist: audiobook.author,
                    albumTitle: partCount > 1 ? `Part ${partIndex + 1} of ${partCount}` : undefined,
                    // The native side opens the cover with java.net.URL, which only knows file:/http(s):
                    // (a content:// URI would make the whole call fail), and covers are local files.
                    artworkUrl: /^(file|https?):\/\//i.test(poster) ? poster : undefined,
                },
                { showSeekBackward: true, showSeekForward: true },
            );
        } catch (e) {
            logger.warn(TAG, 'Failed to activate lock-screen controls', e);
        }
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    private rewindSeconds(): number {
        return librarySink.getState().settingsReducer.audiobookRewindSeconds ?? 10;
    }

    private applyPlaybackRate(): void {
        const player = this.player;
        if (!player) return;
        const rate = librarySink.getState().settingsReducer.audiobookPlaybackRate ?? 1;
        try {
            player.setPlaybackRate(rate);
        } catch (e) {
            logger.warn(TAG, `Failed to set the playback rate to ${rate}`, e);
        }
    }

    private isPlaying(): boolean {
        return this.lastPlaying || (this.player?.playing ?? false);
    }

    /** Title and cover as the browse screen shows them: the `audiobook:<folderKey>` override first. */
    private displayFor(audiobook: IMediaAudiobook): { title: string; poster: string } {
        const override = librarySink.getState().libraryReducer.mediaOverrides[`audiobook:${audiobook.folderKey}`];
        return {
            title: override?.title ?? audiobook.title,
            poster: override?.poster || audiobook.poster || '',
        };
    }

    private setSnapshot(next: NowPlaying): void {
        const prev = this.snapshot;
        if (
            prev
            && prev.folderKey === next.folderKey
            && prev.partIndex === next.partIndex
            && prev.audiobook === next.audiobook
            && prev.title === next.title
            && prev.poster === next.poster
            && prev.finished === next.finished
            && prev.error === next.error
            && prev.sleepTimer === next.sleepTimer
        ) return;
        this.snapshot = next;
        // Copy so a listener unsubscribing during notification can't skip another one.
        for (const listener of [...this.listeners]) listener();
    }
}
