import { createThumbnailCache } from '../thumbnailCache';

const INTERVAL = 250;

describe('thumbnailCache', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  const make = () => createThumbnailCache(INTERVAL, () => Date.now());

  it('behaves like a map for get/has/set/delete/clear', () => {
    const c = make();
    expect(c.get('a')).toBeUndefined();
    c.set('a', 'file:///a.jpg');
    expect(c.has('a')).toBe(true);
    expect(c.get('a')).toBe('file:///a.jpg');
    c.delete('a');
    expect(c.has('a')).toBe(false);
    c.set('b', 'file:///b.jpg');
    c.clear();
    expect(c.has('b')).toBe(false);
  });

  it('notifies subscribers and bumps the version when contents change', () => {
    const c = make();
    const listener = jest.fn();
    c.subscribe(listener);
    expect(c.getVersion()).toBe(0);

    c.set('a', 'file:///a.jpg');

    expect(listener).toHaveBeenCalledTimes(1);
    expect(c.getVersion()).toBe(1);
  });

  it('rate-limits a burst of sets to a leading and a trailing notification', () => {
    const c = make();
    const listener = jest.fn();
    c.subscribe(listener);

    for (let i = 0; i < 100; i++) c.set(`p${i}`, `file:///${i}.jpg`);
    expect(listener).toHaveBeenCalledTimes(1);

    jest.advanceTimersByTime(INTERVAL);
    expect(listener).toHaveBeenCalledTimes(2);
    expect(c.getVersion()).toBe(2);
    // By the time the trailing notification lands every entry is readable.
    expect(c.get('p99')).toBe('file:///99.jpg');

    jest.advanceTimersByTime(INTERVAL * 4);
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it('flush() delivers the pending notification immediately', () => {
    const c = make();
    const listener = jest.fn();
    c.subscribe(listener);
    c.set('a', 'file:///a.jpg');
    c.set('b', 'file:///b.jpg');
    expect(listener).toHaveBeenCalledTimes(1);

    c.flush();
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it('does not notify for no-op changes', () => {
    const c = make();
    c.set('a', 'file:///a.jpg');
    c.flush();
    jest.advanceTimersByTime(INTERVAL * 2);
    const listener = jest.fn();
    c.subscribe(listener);

    c.set('a', 'file:///a.jpg'); // same value
    c.delete('missing');
    expect(listener).not.toHaveBeenCalled();
  });

  it('clear() notifies immediately, even inside the rate-limit window, and only when non-empty', () => {
    const c = make();
    c.set('a', 'file:///a.jpg');
    const listener = jest.fn();
    c.subscribe(listener);
    const before = c.getVersion();

    c.clear();
    expect(listener).toHaveBeenCalledTimes(1);
    expect(c.getVersion()).toBe(before + 1);

    c.clear(); // already empty
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('stops notifying after unsubscribe', () => {
    const c = make();
    const listener = jest.fn();
    const unsubscribe = c.subscribe(listener);
    unsubscribe();
    c.set('a', 'file:///a.jpg');
    expect(listener).not.toHaveBeenCalled();
  });
});
