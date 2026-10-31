import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { imageAspectCache } from '@/scripts/imageAspectCache';
import type { ThumbnailSource } from '@/scripts/thumbnailCache';
import { aspectRatio, gridImageHeight, isPosterTall } from '@/utils/posterFit';

/** Images measured at once while sizing a grid. */
const MEASURE_CONCURRENCY = 4;

/** Aspect ratio of a cell's image if known: a URI's from the cache, a VideoThumbnail's from its size. */
function aspectOf(image: ThumbnailSource | undefined): number | undefined {
  if (image === undefined) return undefined;
  return typeof image === 'string' ? imageAspectCache.get(image) : aspectRatio(image.width, image.height);
}

/**
 * Height of the poster grid's image boxes (see `gridImageHeight`) for the image each cell
 * shows (`undefined` for a cell with none). `images` should keep its identity between renders.
 *
 * Images whose ratio isn't known yet are measured in the background, a few at a time, which
 * stops early once a poster-tall image is found (the box can't get taller). The height starts
 * from what is known and settles as measurements arrive.
 */
export function useGridImageHeight(cardWidth: number, images: readonly (ThumbnailSource | undefined)[]): number {
  const aspectVersion = useSyncExternalStore(imageAspectCache.subscribe, imageAspectCache.getVersion);

  useEffect(() => {
    let done = images.some((image) => isPosterTall(aspectOf(image)));
    if (done) return;
    const queue = [...new Set(images.filter((image): image is string => typeof image === 'string' && imageAspectCache.get(image) === undefined))];
    const work = async () => {
      for (let uri = queue.shift(); uri !== undefined && !done; uri = queue.shift()) {
        await imageAspectCache.measure(uri);
        if (isPosterTall(imageAspectCache.get(uri))) done = true;
      }
    };
    for (let i = 0; i < MEASURE_CONCURRENCY; i++) void work();
    return () => { done = true; };
  }, [images]);

  return useMemo(
    () => gridImageHeight(cardWidth, images.map(aspectOf)),
    // aspectVersion changes (rate-limited) when the aspect cache learns new ratios.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [cardWidth, images, aspectVersion],
  );
}
