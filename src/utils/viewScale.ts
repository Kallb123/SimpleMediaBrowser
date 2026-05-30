export const PORTRAIT_MIN_COLUMNS = 2;
export const PORTRAIT_MAX_COLUMNS = 5;
export const LANDSCAPE_MIN_COLUMNS = 4;
export const LANDSCAPE_MAX_COLUMNS = 10;

export const VIEW_SCALE_MIN = 1;
export const VIEW_SCALE_MAX = 10;

export function mapScaleToColumns(
  viewScale: number,
  minColumns: number,
  maxColumns: number,
): number {
  const clampedScale = Math.max(VIEW_SCALE_MIN, Math.min(VIEW_SCALE_MAX, viewScale));
  const t = (clampedScale - VIEW_SCALE_MIN) / (VIEW_SCALE_MAX - VIEW_SCALE_MIN);
  return Math.round(minColumns + t * (maxColumns - minColumns));
}
