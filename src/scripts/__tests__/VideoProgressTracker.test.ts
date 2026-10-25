import { AppState } from 'react-native';
import { configureStore } from '@reduxjs/toolkit';
import libraryReducer, { clearWatchProgress, markWatched, setWatchProgress } from '@/store/libraryReducer';
import scanReducer from '@/store/scanReducer';
import settingsReducer from '@/store/settingsReducer';
import { setLibrarySink } from '@/scripts/librarySink';
import type { LibrarySink } from '@/scripts/librarySink';
import { VideoProgressTracker } from '@/scripts/VideoProgressTracker';

// ── Mocks ────────────────────────────────────────────────────────────────────

jest.mock('@/scripts/Logger', () => ({
  logger: { log: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

type Listener = (payload?: any) => void;

/** Stands in for an expo-video `VideoPlayer`: tests move the clock and fire its events by hand. */
class FakePlayer {
  currentTime = 0;
  duration = 0;
  private listeners: Record<string, Set<Listener>> = {};

  addListener = jest.fn((event: string, listener: Listener) => {
    (this.listeners[event] ??= new Set()).add(listener);
    return { remove: () => { this.listeners[event].delete(listener); } };
  });

  listenerCount() {
    return Object.values(this.listeners).reduce((n, set) => n + set.size, 0);
  }

  emit(event: string, payload?: unknown) {
    for (const listener of [...(this.listeners[event] ?? [])]) listener(payload);
  }

  /** Normal playback tick: moves the clock and reports it. */
  tick(currentTime: number) {
    this.currentTime = currentTime;
    this.emit('timeUpdate', { currentTime });
  }

  pauseAt(currentTime: number) {
    this.currentTime = currentTime;
    this.emit('playingChange', { isPlaying: false });
  }
}

// ── Fixtures ─────────────────────────────────────────────────────────────────

const KEY = 'movies/film.mkv';
const DURATION = 1000;

const makeStore = () => configureStore({
  reducer: { libraryReducer, settingsReducer, scanReducer },
  middleware: (getDefault) => getDefault({ serializableCheck: false, immutableCheck: false }),
});

describe('VideoProgressTracker', () => {
  let store: ReturnType<typeof makeStore>;
  let player: FakePlayer;
  let now: number;
  let appStateHandler: (state: string) => void;
  let appStateRemove: jest.Mock;
  let dispatched: { type: string; payload: any }[];

  const lib = () => store.getState().libraryReducer;
  const progress = () => lib().watchProgress[KEY];
  const count = (action: { match: (a: any) => boolean }) => dispatched.filter((a) => action.match(a)).length;

  const track = () => new VideoProgressTracker(player, KEY);
  /** Lets the throttle window pass. */
  const advance = (ms: number) => { now += ms; };

  beforeEach(() => {
    now = 1_700_000_000_000;
    jest.spyOn(Date, 'now').mockImplementation(() => now);
    appStateRemove = jest.fn();
    jest.spyOn(AppState, 'addEventListener').mockImplementation(((_type: string, handler: (s: string) => void) => {
      appStateHandler = handler;
      return { remove: appStateRemove };
    }) as unknown as typeof AppState.addEventListener);

    player = new FakePlayer();
    player.duration = DURATION;
    store = makeStore();
    dispatched = [];
    const realDispatch = store.dispatch;
    jest.spyOn(store, 'dispatch').mockImplementation(((action: any) => {
      dispatched.push(action);
      return realDispatch(action);
    }) as typeof store.dispatch);
    setLibrarySink(store as unknown as LibrarySink);
  });

  afterEach(() => {
    setLibrarySink(null);
    jest.restoreAllMocks();
  });

  describe('progress saving', () => {
    it('saves at most every 10 seconds while playing', () => {
      track();
      player.tick(1);
      expect(count(setWatchProgress)).toBe(0);

      advance(10_000);
      player.tick(11);
      expect(count(setWatchProgress)).toBe(1);
      expect(progress()).toEqual({ position: 11, duration: DURATION, updatedAt: now });

      // The rest of the interval: one tick a second, nothing more is written.
      for (let s = 1; s <= 9; s++) {
        advance(1000);
        player.tick(11 + s);
      }
      expect(count(setWatchProgress)).toBe(1);

      advance(1000);
      player.tick(21);
      expect(count(setWatchProgress)).toBe(2);
      expect(progress().position).toBe(21);
    });

    it('does not let an early tick overwrite a resume point before the first interval has passed', () => {
      store.dispatch(setWatchProgress({ key: KEY, progress: { position: 500, duration: DURATION, updatedAt: 1 } }));
      track();
      player.tick(0);
      expect(progress().position).toBe(500);
    });

    it('saves immediately when playback pauses, even inside the throttle window', () => {
      track();
      advance(10_000);
      player.tick(30);
      advance(1000);
      player.pauseAt(31);
      expect(count(setWatchProgress)).toBe(2);
      expect(progress().position).toBe(31);
    });

    it('does not save when playback starts', () => {
      track();
      player.emit('playingChange', { isPlaying: true });
      expect(count(setWatchProgress)).toBe(0);
    });

    it('saves immediately when the app leaves the foreground', () => {
      track();
      player.currentTime = 42;
      appStateHandler('background');
      expect(progress().position).toBe(42);
    });

    it('does not save when the app comes back to the foreground', () => {
      track();
      player.currentTime = 42;
      appStateHandler('active');
      expect(count(setWatchProgress)).toBe(0);
    });

    it('saves the final position on dispose', () => {
      const tracker = track();
      player.currentTime = 77;
      tracker.dispose();
      expect(progress().position).toBe(77);
      expect(progress().duration).toBe(DURATION);
    });

    it('saves nothing when there is no position yet', () => {
      player.duration = 0;
      const tracker = track();
      appStateHandler('background');
      player.pauseAt(0);
      tracker.dispose();
      expect(count(setWatchProgress)).toBe(0);
    });

    it('keeps a position when the duration is not known', () => {
      player.duration = 0;
      const tracker = track();
      player.currentTime = 25;
      tracker.dispose();
      expect(progress()).toEqual({ position: 25, duration: 0, updatedAt: now });
    });

    it.each([NaN, Infinity, -Infinity])('ignores a position of %s', (bad) => {
      const tracker = track();
      advance(10_000);
      player.tick(bad);
      player.pauseAt(bad);
      appStateHandler('background');
      tracker.dispose();
      expect(count(setWatchProgress)).toBe(0);
      expect(count(markWatched)).toBe(0);
    });

    it('treats a non-finite duration as unknown', () => {
      player.duration = NaN;
      const tracker = track();
      player.currentTime = 25;
      tracker.dispose();
      expect(progress()).toEqual({ position: 25, duration: 0, updatedAt: now });
    });

    it('clamps a negative position to 0', () => {
      const tracker = track();
      player.currentTime = -5;
      tracker.dispose();
      expect(progress().position).toBe(0);
    });

    it('does not throw when the player can no longer be read', () => {
      const tracker = track();
      Object.defineProperty(player, 'currentTime', { get() { throw new Error('released'); } });
      expect(() => tracker.dispose()).not.toThrow();
      expect(count(setWatchProgress)).toBe(0);
    });
  });

  describe('watched', () => {
    it('marks the file watched and drops its resume point once 90% is reached, exactly once', () => {
      store.dispatch(setWatchProgress({ key: KEY, progress: { position: 100, duration: DURATION, updatedAt: 1 } }));
      track();
      player.tick(899);
      expect(count(markWatched)).toBe(0);

      // Not waiting for a timed save: the very tick that crosses the threshold counts.
      player.tick(900);
      expect(lib().watched[KEY]).toBe(now);
      expect(progress()).toBeUndefined();

      for (let s = 901; s < 960; s += 10) {
        advance(10_000);
        player.tick(s);
      }
      player.pauseAt(960);
      appStateHandler('background');
      expect(count(markWatched)).toBe(1);
      expect(count(clearWatchProgress)).toBe(1);
      expect(progress()).toBeUndefined();
    });

    it('does not save progress in the watched zone, including on pause and dispose', () => {
      const tracker = track();
      player.tick(950);
      player.pauseAt(951);
      tracker.dispose();
      expect(count(setWatchProgress)).toBe(0);
      expect(count(markWatched)).toBe(1);
    });

    it('marks the file watched when the video plays to its end', () => {
      track();
      player.tick(400);
      player.emit('playToEnd');
      expect(lib().watched[KEY]).toBe(now);
      expect(progress()).toBeUndefined();
    });

    it('marks the file watched at the end even when the duration is unknown', () => {
      player.duration = 0;
      track();
      player.emit('playToEnd');
      expect(count(markWatched)).toBe(1);
    });

    it('ignores the position the player reports after the end (it may have rewound)', () => {
      const tracker = track();
      player.tick(999);
      player.emit('playToEnd');
      player.pauseAt(0);
      tracker.dispose();
      expect(count(setWatchProgress)).toBe(0);
      expect(count(markWatched)).toBe(1);
    });

    it('saves progress again when played back from the start after the end', () => {
      track();
      player.emit('playToEnd');
      player.tick(2);
      advance(10_000);
      player.tick(12);
      expect(progress().position).toBe(12);
      expect(count(markWatched)).toBe(1);
    });

    it('resumes saving after a seek back below 90%, keeping the watched mark', () => {
      track();
      player.tick(920);
      expect(lib().watched[KEY]).toBeDefined();

      advance(10_000);
      player.tick(300);
      expect(progress().position).toBe(300);
      expect(lib().watched[KEY]).toBeDefined();
      expect(count(markWatched)).toBe(1);
    });

    it('drops a resume point saved after seeking back when 90% is reached again, without marking twice', () => {
      track();
      player.tick(920);
      advance(10_000);
      player.tick(300);
      expect(progress()).toBeDefined();

      player.tick(930);
      expect(progress()).toBeUndefined();
      expect(count(markWatched)).toBe(1);
      expect(count(clearWatchProgress)).toBe(2);
    });

    it('does not count a position when the duration is unknown', () => {
      player.duration = 0;
      track();
      player.tick(5000);
      expect(count(markWatched)).toBe(0);
    });
  });

  describe('dispose', () => {
    it('removes every listener, including the app state one', () => {
      const tracker = track();
      expect(player.listenerCount()).toBe(3);
      tracker.dispose();
      expect(player.listenerCount()).toBe(0);
      expect(appStateRemove).toHaveBeenCalledTimes(1);
    });

    it('does not save after being disposed', () => {
      const tracker = track();
      tracker.dispose();
      dispatched.length = 0;

      advance(10_000);
      player.tick(50);
      player.pauseAt(60);
      player.emit('playToEnd');
      appStateHandler('background');
      tracker.dispose();
      expect(dispatched).toEqual([]);
    });

    it('saves the final position only once when called twice', () => {
      const tracker = track();
      player.currentTime = 20;
      tracker.dispose();
      tracker.dispose();
      expect(count(setWatchProgress)).toBe(1);
      expect(appStateRemove).toHaveBeenCalledTimes(1);
    });
  });
});
