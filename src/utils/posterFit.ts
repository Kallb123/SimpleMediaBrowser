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
