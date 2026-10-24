import type { VideoThumbnail } from 'expo-video';
import { createThrottledDispatcher } from '@/scripts/throttledDispatch';

/** A thumbnail the browse screens can render: a persisted `file://` URI, or an in-session `VideoThumbnail`. */
export type ThumbnailSource = VideoThumbnail | string;

/** Subscribers hear about a burst of thumbnail changes at most this often (with a trailing notification). */
const NOTIFY_INTERVAL_MS = 250;

/**
 * Cross-session cache of thumbnail sources keyed by media file path.
 *
 * Values are either:
 * - A `string` local `file://` URI loaded from the persistent on-disk index at
 *   startup, or written there after a thumbnail is first generated.
 * - A `VideoThumbnail` SharedRef for thumbnails whose disk-persist step failed
 *   (in-session fallback only; they will be regenerated on the next restart).
 *
 * Because `VideoThumbnail` is non-serialisable it cannot live in Redux, so this is a plain
 * Map made observable instead: it exposes `subscribe` / `getVersion` (the
 * `useSyncExternalStore` contract, see `hooks/useThumbnailVersion.ts`). The version only
 * moves when contents change, and change notifications are rate-limited so generating
 * thousands of thumbnails does not re-render subscribers once per thumbnail.
 *
 * Deliberately free of Redux/store imports, like the other services in `scripts/`.
 */
export interface ThumbnailCache {
    get(path: string): ThumbnailSource | undefined;
    has(path: string): boolean;
    set(path: string, source: ThumbnailSource): void;
    delete(path: string): void;
    clear(): void;
    /** Counter that increases each time subscribers are notified of changed contents. */
    getVersion(): number;
    /** Registers a change listener; returns the unsubscribe function. */
    subscribe(listener: () => void): () => void;
    /** Delivers a pending (rate-limited) notification now, if any. */
    flush(): void;
}

export function createThumbnailCache(
    intervalMs: number = NOTIFY_INTERVAL_MS,
    now: () => number = Date.now,
): ThumbnailCache {
    const entries = new Map<string, ThumbnailSource>();
    const listeners = new Set<() => void>();
    let version = 0;

    const notifier = createThrottledDispatcher<void>(() => {
        version++;
        // Copy so a listener unsubscribing during notification can't skip another one.
        for (const listener of [...listeners]) listener();
    }, intervalMs, now);

    return {
        get: (path) => entries.get(path),
        has: (path) => entries.has(path),
        set(path, source) {
            if (entries.get(path) === source) return;
            entries.set(path, source);
            notifier.throttled();
        },
        delete(path) {
            if (entries.delete(path)) notifier.throttled();
        },
        clear() {
            if (entries.size === 0) return;
            entries.clear();
            notifier.immediate();
        },
        getVersion: () => version,
        subscribe(listener) {
            listeners.add(listener);
            return () => { listeners.delete(listener); };
        },
        flush: () => notifier.flush(),
    };
}

/** The app-wide thumbnail cache; populated by `FileScanner`, read by the browse screens. */
export const thumbnailCache = createThumbnailCache();
