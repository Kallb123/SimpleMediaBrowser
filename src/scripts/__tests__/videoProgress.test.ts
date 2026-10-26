import {
  MIN_RESUME_SECONDS,
  WATCHED_FRACTION,
  isWatchedPosition,
  latestWatchProgressFraction,
  resumePosition,
  watchProgressFraction,
} from '@/scripts/videoProgress';
import type { IWatchProgress } from '@/store/libraryReducer';

const progress = (position: number, duration = 1000, updatedAt = 1): IWatchProgress => ({ position, duration, updatedAt });

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

describe('watchProgressFraction', () => {
  it('is position over duration for a video part-way through', () => {
    expect(watchProgressFraction(progress(250))).toBe(0.25);
    expect(watchProgressFraction(progress(899))).toBeCloseTo(0.899);
  });

  it('is 0 without progress', () => {
    expect(watchProgressFraction(undefined)).toBe(0);
  });

  it('is 0 below the minimum resume position', () => {
    expect(watchProgressFraction(progress(0))).toBe(0);
    expect(watchProgressFraction(progress(MIN_RESUME_SECONDS - 0.5))).toBe(0);
  });

  it('is 0 once past the watched threshold or beyond the end', () => {
    expect(watchProgressFraction(progress(900))).toBe(0);
    expect(watchProgressFraction(progress(1000))).toBe(0);
    expect(watchProgressFraction(progress(5000))).toBe(0);
  });

  it('is 0 when the duration is unknown, even though the video would resume', () => {
    expect(watchProgressFraction(progress(300, 0))).toBe(0);
    expect(watchProgressFraction(progress(300, NaN))).toBe(0);
  });

  it('is 0 for invalid positions', () => {
    expect(watchProgressFraction(progress(-5))).toBe(0);
    expect(watchProgressFraction(progress(NaN))).toBe(0);
  });
});

describe('latestWatchProgressFraction', () => {
  it('uses the most recently updated episode that is in progress', () => {
    const map = {
      a: progress(100, 1000, 10),
      b: progress(500, 1000, 30),
      c: progress(200, 1000, 20),
    };
    expect(latestWatchProgressFraction(map, ['a', 'b', 'c'])).toBe(0.5);
    expect(latestWatchProgressFraction(map, ['c', 'b', 'a'])).toBe(0.5);
  });

  it('skips finished, unstarted and invalid entries even when they are newer', () => {
    const map = {
      done: progress(950, 1000, 100),
      early: progress(3, 1000, 90),
      unknown: progress(300, 0, 80),
      bad: progress(NaN, 1000, 70),
      mid: progress(400, 1000, 5),
    };
    expect(latestWatchProgressFraction(map, ['done', 'early', 'unknown', 'bad', 'mid'])).toBe(0.4);
  });

  it('ignores entries outside the keys', () => {
    const map = { a: progress(100, 1000, 10), other: progress(700, 1000, 99) };
    expect(latestWatchProgressFraction(map, ['a'])).toBe(0.1);
  });

  it('is 0 when no key has progress', () => {
    expect(latestWatchProgressFraction({ a: progress(100) }, ['missing'])).toBe(0);
    expect(latestWatchProgressFraction({ a: progress(100) }, [])).toBe(0);
    expect(latestWatchProgressFraction({}, ['a'])).toBe(0);
    expect(latestWatchProgressFraction({ a: progress(990) }, ['a'])).toBe(0);
  });
});
