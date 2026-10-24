import { useSyncExternalStore } from 'react';
import { thumbnailCache } from '@/scripts/thumbnailCache';

/**
 * Re-renders the calling component when the thumbnail cache changes, returning a counter to
 * use as a memo dependency for anything derived from `thumbnailCache.get(...)`.
 */
export function useThumbnailVersion(): number {
    return useSyncExternalStore(thumbnailCache.subscribe, thumbnailCache.getVersion);
}
