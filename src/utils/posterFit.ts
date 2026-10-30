/**
 * Pure helpers for deciding whether a poster cell needs its blurred backdrop.
 * Kept free of runtime imports so it is trivially unit-testable.
 */

/** Max relative difference between image and box aspect ratios still treated as "fits". */
const ASPECT_TOLERANCE = 0.03;

/** Width / height, or undefined when either dimension is missing or non-positive. */
export function aspectRatio(width: number | undefined, height: number | undefined): number | undefined {
  if (!width || !height || width <= 0 || height <= 0) return undefined;
  return width / height;
}

/**
 * Whether the blurred backdrop is needed behind a `contain`-scaled image. A backdrop only
 * shows in the letterbox bars, so an image whose aspect ratio matches the box (a portrait
 * poster in a poster-shaped box) hides it completely and we can skip decoding it.
 *
 * `imageAspect` is undefined until the real size is known; `assumeBoxShaped` then picks the
 * default (true for posters, which are almost always the box's shape; false for stills and
 * thumbnails, which are almost never — so those never show bare bars before they load).
 */
export function needsBackdrop(
  imageAspect: number | undefined,
  boxAspect: number,
  assumeBoxShaped: boolean,
): boolean {
  if (imageAspect === undefined) return !assumeBoxShaped;
  return Math.abs(imageAspect - boxAspect) / boxAspect > ASPECT_TOLERANCE;
}

/** Width / height of the classic 2:3 portrait poster: the tallest box a grid cell gets. */
export const POSTER_ASPECT = 2 / 3;

/** Widest box a grid cell shrinks to; wider art (banners) letterboxes inside it instead. */
const WIDEST_BOX_ASPECT = 16 / 9;

/**
 * Whether an image is as tall as a portrait poster (within tolerance, so 680x1000 TVDB posters
 * and downscaled measurements count). Once a grid shows one, its cells are as tall as they get.
 */
export function isPosterTall(imageAspect: number | undefined): boolean {
  return imageAspect !== undefined && imageAspect <= POSTER_ASPECT * (1 + ASPECT_TOLERANCE);
}

/**
 * Height of the image box shared by every cell of a poster grid: tall enough to show the
 * tallest of the grid's images at `cardWidth` without letterboxing, so a grid of only
 * landscape stills or square covers gets matching short cells instead of portrait ones.
 * Bounded by the 2:3 poster shape and 16:9; images whose size isn't known yet (undefined)
 * are skipped, and with none known the box stays poster-shaped.
 */
export function gridImageHeight(cardWidth: number, imageAspects: Iterable<number | undefined>): number {
  let narrowest: number | undefined;
  for (const aspect of imageAspects) {
    if (aspect !== undefined && (narrowest === undefined || aspect < narrowest)) narrowest = aspect;
  }
  const boxAspect = narrowest === undefined || isPosterTall(narrowest)
    ? POSTER_ASPECT
    : Math.min(narrowest, WIDEST_BOX_ASPECT);
  return Math.round(cardWidth / boxAspect);
}
