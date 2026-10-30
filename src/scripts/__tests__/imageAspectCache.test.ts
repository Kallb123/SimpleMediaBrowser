import { createImageAspectCache } from '../imageAspectCache';
import { logger } from '@/scripts/Logger';

jest.mock('expo-image', () => ({ Image: { loadAsync: jest.fn() } }));
jest.mock('@/scripts/Logger', () => ({
  logger: { log: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

const INTERVAL = 250;

describe('imageAspectCache', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  const make = (loadSize = jest.fn(async () => ({ width: 128, height: 72 }))) =>
    ({ cache: createImageAspectCache(loadSize, INTERVAL, () => Date.now()), loadSize });

  it('stores ratios set directly and rate-limits the notifications', () => {
    const { cache } = make();
    const listener = jest.fn();
    cache.subscribe(listener);

    cache.set('a', 1);
    cache.set('b', 16 / 9);
    cache.set('c', 4 / 3);
    // The first change notifies at once; the rest of the burst coalesces into one trailing call.
    expect(listener).toHaveBeenCalledTimes(1);
    jest.advanceTimersByTime(INTERVAL);

    expect(cache.get('a')).toBe(1);
    expect(cache.get('b')).toBe(16 / 9);
    expect(listener).toHaveBeenCalledTimes(2);
    expect(cache.getVersion()).toBe(2);
  });

  it('does not notify when a ratio is set to the value it already has', () => {
    const { cache } = make();
    cache.set('a', 1);
    cache.flush();
    const listener = jest.fn();
    cache.subscribe(listener);

    cache.set('a', 1);
    cache.flush();

    expect(listener).not.toHaveBeenCalled();
  });

  it('measures an unknown image once and records its ratio', async () => {
    const { cache, loadSize } = make();

    await cache.measure('file:///still.jpg');
    await cache.measure('file:///still.jpg');

    expect(loadSize).toHaveBeenCalledTimes(1);
    expect(cache.get('file:///still.jpg')).toBeCloseTo(16 / 9);
  });

  it('skips measuring an image whose ratio is already known', async () => {
    const { cache, loadSize } = make();
    cache.set('file:///poster.jpg', 2 / 3);

    await cache.measure('file:///poster.jpg');

    expect(loadSize).not.toHaveBeenCalled();
  });

  it('keeps a ratio recorded by a real load while the measurement was in flight', async () => {
    let resolve!: (size: { width: number; height: number }) => void;
    const { cache } = make(jest.fn(() => new Promise<{ width: number; height: number }>((r) => { resolve = r; })));

    const measuring = cache.measure('file:///a.jpg');
    cache.set('file:///a.jpg', 0.68);
    resolve({ width: 85, height: 128 });
    await measuring;

    expect(cache.get('file:///a.jpg')).toBe(0.68);
  });

  it('logs a failed load and does not retry it', async () => {
    const { cache, loadSize } = make(jest.fn(async () => { throw new Error('missing'); }));

    await cache.measure('file:///gone.jpg');
    await cache.measure('file:///gone.jpg');

    expect(cache.get('file:///gone.jpg')).toBeUndefined();
    expect(loadSize).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalledTimes(1);
  });
});
