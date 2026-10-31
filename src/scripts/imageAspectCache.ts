import { Image } from 'expo-image';
import { logger } from '@/scripts/Logger';
import { createThrottledDispatcher } from '@/scripts/throttledDispatch';
import { aspectRatio } from '@/utils/posterFit';

/** Subscribers hear about a burst of new aspect ratios at most this often (with a trailing notification). */
const NOTIFY_INTERVAL_MS = 250;

/** Images are decoded no larger than this when measured; the aspect ratio survives the downscale. */
const MEASURE_MAX_SIZE = 128;

/** Reads an image's size (any scale; only the ratio is kept). */
export type ImageSizeLoader = (uri: string) => Promise<{ width: number; height: number }>;

/**
 * Session cache of image aspect ratios (width / height) keyed by image URI, so the browse grid
 * can size its cells to the art it shows (see `gridImageHeight`). Filled by `PosterBox` as
 * images load and by `measure` for images not on screen yet.
 *
 * Observable the same way as `thumbnailCache` (`subscribe` / `getVersion` for
 * `useSyncExternalStore`), with notifications rate-limited so measuring a large folder does
 * not re-render the grid once per image.
 */
export interface ImageAspectCache {
    get(uri: string): number | undefined;
    set(uri: string, aspect: number): void;
    /**
     * Measures `uri` unless its ratio is known or it was already tried this session; resolves
     * once done. A failed load is logged and not retried.
     */
    measure(uri: string): Promise<void>;
    /** Counter that increases each time subscribers are notified of changed contents. */
    getVersion(): number;
    /** Registers a change listener; returns the unsubscribe function. */
    subscribe(listener: () => void): () => void;
    /** Delivers a pending (rate-limited) notification now, if any. */
    flush(): void;
}

export function createImageAspectCache(
    loadSize: ImageSizeLoader,
    intervalMs: number = NOTIFY_INTERVAL_MS,
    now: () => number = Date.now,
): ImageAspectCache {
    const aspects = new Map<string, number>();
    /** URIs measured or being measured, so each is loaded at most once. */
    const attempted = new Set<string>();
    const listeners = new Set<() => void>();
    let version = 0;

    const notifier = createThrottledDispatcher<void>(() => {
        version++;
        // Copy so a listener unsubscribing during notification can't skip another one.
        for (const listener of [...listeners]) listener();
    }, intervalMs, now);

    const set = (uri: string, aspect: number) => {
        if (aspects.get(uri) === aspect) return;
        aspects.set(uri, aspect);
        notifier.throttled();
    };

    return {
        get: (uri) => aspects.get(uri),
        set,
        async measure(uri) {
            if (aspects.has(uri) || attempted.has(uri)) return;
            attempted.add(uri);
            try {
                const { width, height } = await loadSize(uri);
                const aspect = aspectRatio(width, height);
                // A real load (PosterBox) may have recorded the full-size ratio meanwhile; keep it.
                if (aspect !== undefined && !aspects.has(uri)) set(uri, aspect);
            } catch (e) {
                logger.warn('imageAspectCache', `Could not measure image ${uri}`, e);
            }
        },
        getVersion: () => version,
        subscribe(listener) {
            listeners.add(listener);
            return () => { listeners.delete(listener); };
        },
        flush: () => notifier.flush(),
    };
}

const loadImageSize: ImageSizeLoader = async (uri) => {
    const image = await Image.loadAsync(uri, { maxWidth: MEASURE_MAX_SIZE, maxHeight: MEASURE_MAX_SIZE });
    try {
        return { width: image.width, height: image.height };
    } finally {
        image.release();
    }
};

/** The app-wide image aspect cache; read by the browse grid, filled by `PosterBox` and `useGridImageHeight`. */
export const imageAspectCache = createImageAspectCache(loadImageSize);
