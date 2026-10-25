import { MIN_RESUME_SECONDS, WATCHED_FRACTION, isWatchedPosition, resumePosition } from '@/scripts/videoProgress';
import type { IWatchProgress } from '@/store/libraryReducer';

const progress = (position: number, duration = 1000): IWatchProgress => ({ position, duration, updatedAt: 1 });

describe('isWatchedPosition', () => {
  it('is true from the watched fraction of a known duration onwards', () => {
    expect(isWatchedPosition(1000 * WATCHED_FRACTION, 1000)).toBe(true);
    expect(isWatchedPosition(999, 1000)).toBe(true);
    expect(isWatchedPosition(1000, 1000)).toBe(true);
    expect(isWatchedPosition(1200, 1000)).toBe(true);
  });

  it('is false before the watched fraction', () => {
    expect(isWatchedPosition(0, 1000)).toBe(false);
    expect(isWatchedPosition(899, 1000)).toBe(false);
  });

  it('is false when the duration is unknown or invalid', () => {
    expect(isWatchedPosition(500, 0)).toBe(false);
    expect(isWatchedPosition(500, -10)).toBe(false);
    expect(isWatchedPosition(500, NaN)).toBe(false);
    expect(isWatchedPosition(500, Infinity)).toBe(false);
  });

  it('is false when the position is not finite', () => {
    expect(isWatchedPosition(NaN, 1000)).toBe(false);
    expect(isWatchedPosition(Infinity, 1000)).toBe(false);
  });
});

describe('resumePosition', () => {
  it('returns the saved position for a video part-way through', () => {
    expect(resumePosition(progress(300))).toBe(300);
    expect(resumePosition(progress(MIN_RESUME_SECONDS))).toBe(MIN_RESUME_SECONDS);
  });

  it('starts from the beginning without progress', () => {
    expect(resumePosition(undefined)).toBe(0);
  });

  it('ignores positions earlier than the minimum', () => {
    expect(resumePosition(progress(0))).toBe(0);
    expect(resumePosition(progress(MIN_RESUME_SECONDS - 0.5))).toBe(0);
  });

  it('ignores negative and non-finite positions', () => {
    expect(resumePosition(progress(-5))).toBe(0);
    expect(resumePosition(progress(NaN))).toBe(0);
    expect(resumePosition(progress(Infinity))).toBe(0);
  });

  it('ignores positions past the watched threshold or beyond the end', () => {
    expect(resumePosition(progress(900))).toBe(0);
    expect(resumePosition(progress(1000))).toBe(0);
    expect(resumePosition(progress(5000))).toBe(0);
  });

  it('resumes just before the watched threshold', () => {
    expect(resumePosition(progress(899))).toBe(899);
  });

  it('trusts the position when the duration is unknown', () => {
    expect(resumePosition(progress(5000, 0))).toBe(5000);
    expect(resumePosition(progress(300, 0))).toBe(300);
    expect(resumePosition(progress(5, 0))).toBe(0);
  });
});
