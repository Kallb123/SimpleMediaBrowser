import { aspectRatio, gridImageHeight, isPosterTall, needsBackdrop } from '@/utils/posterFit';

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

describe('isPosterTall', () => {
  it('is true for 2:3 posters (within tolerance) and anything taller', () => {
    expect(isPosterTall(500 / 750)).toBe(true);
    expect(isPosterTall(680 / 1000)).toBe(true);
    expect(isPosterTall(1 / 2)).toBe(true);
  });
  it('is false for square, landscape or unknown images', () => {
    expect(isPosterTall(1)).toBe(false);
    expect(isPosterTall(16 / 9)).toBe(false);
    expect(isPosterTall(undefined)).toBe(false);
  });
});

describe('gridImageHeight', () => {
  const WIDTH = 120;

  it('keeps the 2:3 poster box when nothing is known yet', () => {
    expect(gridImageHeight(WIDTH, [])).toBe(180);
    expect(gridImageHeight(WIDTH, [undefined, undefined])).toBe(180);
  });

  it('fits a grid of only landscape images', () => {
    expect(gridImageHeight(WIDTH, [16 / 9, 16 / 9])).toBe(68);
    expect(gridImageHeight(WIDTH, [16 / 9, 4 / 3])).toBe(90); // the tallest wins
  });

  it('fits square covers', () => {
    expect(gridImageHeight(WIDTH, [1, 1, 16 / 9])).toBe(120);
  });

  it('stays poster-shaped once any image is poster-tall', () => {
    expect(gridImageHeight(WIDTH, [16 / 9, 2 / 3, 1])).toBe(180);
    expect(gridImageHeight(WIDTH, [680 / 1000, 16 / 9])).toBe(180);
    expect(gridImageHeight(WIDTH, [1 / 2])).toBe(180);
  });

  it('never goes wider than 16:9', () => {
    expect(gridImageHeight(WIDTH, [3])).toBe(68);
  });

  it('skips images whose size is unknown', () => {
    expect(gridImageHeight(WIDTH, [undefined, 16 / 9, undefined])).toBe(68);
  });
});
