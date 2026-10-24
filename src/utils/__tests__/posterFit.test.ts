import { aspectRatio, needsBackdrop } from '@/utils/posterFit';

const BOX = 2 / 3;

describe('aspectRatio', () => {
  it('returns width / height', () => {
    expect(aspectRatio(500, 750)).toBeCloseTo(2 / 3);
  });
  it('returns undefined for missing or non-positive dimensions', () => {
    expect(aspectRatio(undefined, 100)).toBeUndefined();
    expect(aspectRatio(100, 0)).toBeUndefined();
    expect(aspectRatio(-1, 100)).toBeUndefined();
  });
});

describe('needsBackdrop', () => {
  it('skips the backdrop for poster-shaped images', () => {
    expect(needsBackdrop(500 / 750, BOX, true)).toBe(false);
    // TVDB posters are 680x1000 (~2% off 2:3) — still within tolerance.
    expect(needsBackdrop(680 / 1000, BOX, true)).toBe(false);
  });
  it('keeps the backdrop for landscape and square art', () => {
    expect(needsBackdrop(16 / 9, BOX, true)).toBe(true);
    expect(needsBackdrop(1, BOX, true)).toBe(true);
  });
  it('keeps the backdrop for very tall images too', () => {
    expect(needsBackdrop(0.3, BOX, true)).toBe(true);
  });
  it('falls back to the assumption while the size is unknown', () => {
    expect(needsBackdrop(undefined, BOX, true)).toBe(false);
    expect(needsBackdrop(undefined, BOX, false)).toBe(true);
  });
});
