import { AppState } from 'react-native';
import { configureStore } from '@reduxjs/toolkit';
import libraryReducer, {
  setAudiobooks,
  setListenProgress,
  setMediaOverride,
} from '@/store/libraryReducer';
import type { IListenProgress, IMediaAudiobook } from '@/store/libraryReducer';
import scanReducer from '@/store/scanReducer';
import settingsReducer from '@/store/settingsReducer';
import { setLibrarySink } from '@/scripts/librarySink';
import type { LibrarySink } from '@/scripts/librarySink';
import { logger } from '@/scripts/Logger';
import { AudiobookPlayer } from '@/scripts/AudiobookPlayer';

// ── Mocks ────────────────────────────────────────────────────────────────────

jest.mock('@/scripts/Logger', () => ({
  logger: { log: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

type StatusListener = (status: Record<string, unknown>) => void;

/** Stands in for an expo-audio `AudioPlayer`: tests drive its status events and load completion by hand. */
class FakePlayer {
  playing = false;
  isLoaded = false;
  currentTime = 0;
  duration = 0;
  source: string | null = null;
  private listeners = new Set<StatusListener>();

  play = jest.fn(() => { this.playing = true; });
  pause = jest.fn(() => { this.playing = false; });
  replace = jest.fn((source: string) => {
    this.source = source;
    this.isLoaded = false;
    this.currentTime = 0;
  });
  seekTo = jest.fn(async (seconds: number) => { this.currentTime = seconds; });
  setActiveForLockScreen = jest.fn();
  addListener = jest.fn((_event: string, listener: StatusListener) => {
    this.listeners.add(listener);
    return { remove: () => this.listeners.delete(listener) };
  });

  emit(status: Record<string, unknown>) {
    const full = {
      playing: this.playing,
      currentTime: this.currentTime,
      duration: this.duration,
      isLoaded: this.isLoaded,
      playbackState: 'ready',
      didJustFinish: false,
      ...status,
    };
    for (const listener of [...this.listeners]) listener(full);
  }

  /** The source finished loading, as the native player reports it. */
  finishLoading(duration: number) {
    this.isLoaded = true;
    this.duration = duration;
    this.emit({});
  }

  /** The source played to its end. */
  finishPlaying() {
    this.playing = false;
    this.emit({ didJustFinish: true, playing: false });
  }

  /** Normal playback tick: moves the clock and reports it. */
  tick(currentTime: number) {
    this.currentTime = currentTime;
    this.emit({});
  }
}

let mockPlayer: FakePlayer;
const mockSetAudioMode = jest.fn(() => Promise.resolve());
jest.mock('expo-audio', () => ({
  createAudioPlayer: jest.fn(() => mockPlayer),
  setAudioModeAsync: (...a: unknown[]) => (mockSetAudioMode as (...x: unknown[]) => unknown)(...a),
}));

// ── Fixtures ─────────────────────────────────────────────────────────────────

const makeBook = (extra: Partial<IMediaAudiobook> = {}, parts = 3): IMediaAudiobook => ({
  ids: { itunes: null },
  title: 'The Book',
  author: 'An Author',
  folderKey: 'the-book',
  path: 'content://a/the-book/1.mp3',
  files: Array.from({ length: parts }, (_, i) => ({
    path: `content://a/the-book/${i + 1}.mp3`,
    parsedPath: `a/the-book/${i + 1}.mp3`,
    filename: `${i + 1}.mp3`,
  })),
  poster: '',
  ...extra,
});

const partPath = (n: number) => `a/the-book/${n}.mp3`;
const partUri = (n: number) => `content://a/the-book/${n}.mp3`;

const makeStore = () => configureStore({
  reducer: { libraryReducer, settingsReducer, scanReducer },
  middleware: (getDefault) => getDefault({ serializableCheck: false, immutableCheck: false }),
});

describe('AudiobookPlayer', () => {
  let store: ReturnType<typeof makeStore>;
  let service: AudiobookPlayer;
  let book: IMediaAudiobook;
  let now: number;
  let appStateHandler: (state: string) => void;
  let progressDispatches: IListenProgress[];

  const lib = () => store.getState().libraryReducer;
  const progress = () => lib().listenProgress[book.folderKey];

  /** Starts playing and completes the load of the part the player was pointed at. */
  const playAndLoad = async (duration: number, partIndex?: number) => {
    await service.play(book, partIndex);
    mockPlayer.finishLoading(duration);
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockPlayer = new FakePlayer();
    now = 1_700_000_000_000;
    jest.spyOn(Date, 'now').mockImplementation(() => now);
    jest.spyOn(AppState, 'addEventListener').mockImplementation(((_type: string, handler: (s: string) => void) => {
      appStateHandler = handler;
      return { remove: jest.fn() };
    }) as unknown as typeof AppState.addEventListener);

    store = makeStore();
    book = makeBook();
    store.dispatch(setAudiobooks([book]));
    // Count the progress writes (they notify every store subscriber, so their rate matters).
    progressDispatches = [];
    const realDispatch = store.dispatch;
    jest.spyOn(store, 'dispatch').mockImplementation(((action: any) => {
      if (setListenProgress.match(action)) progressDispatches.push(action.payload.progress);
      return realDispatch(action);
    }) as typeof store.dispatch);
    setLibrarySink(store as unknown as LibrarySink);

    (AudiobookPlayer as any)._instance = null;
    service = AudiobookPlayer.getInstance();
  });

  afterEach(() => {
    setLibrarySink(null);
    jest.restoreAllMocks();
  });

  it('is a singleton that can be reset between tests', () => {
    expect(AudiobookPlayer.getInstance()).toBe(service);
    (AudiobookPlayer as any)._instance = null;
    expect(AudiobookPlayer.getInstance()).not.toBe(service);
  });

  // ── Starting playback ──────────────────────────────────────────────────────

  describe('play', () => {
    it('starts an unplayed book at the first part and begins once it has loaded', async () => {
      await service.play(book);

      expect(mockPlayer.replace).toHaveBeenCalledWith(partUri(1));
      // Nothing plays (or seeks) until the source is ready.
      expect(mockPlayer.play).not.toHaveBeenCalled();

      mockPlayer.finishLoading(600);
      expect(mockPlayer.seekTo).not.toHaveBeenCalled();
      expect(mockPlayer.play).toHaveBeenCalledTimes(1);
      expect(progress()).toMatchObject({ partPath: partPath(1), position: 0, duration: 600 });
    });

    it('resumes the book at the saved part and position', async () => {
      store.dispatch(setListenProgress({
        folderKey: book.folderKey,
        progress: { partPath: partPath(2), position: 120, duration: 600, updatedAt: 1 },
      }));

      await service.play(book);
      expect(mockPlayer.replace).toHaveBeenCalledWith(partUri(2));
      expect(mockPlayer.seekTo).not.toHaveBeenCalled(); // not before the part is loaded

      mockPlayer.finishLoading(600);
      expect(mockPlayer.seekTo).toHaveBeenCalledWith(120);
      expect(mockPlayer.play).toHaveBeenCalledTimes(1);
      expect(mockPlayer.seekTo.mock.invocationCallOrder[0]).toBeLessThan(mockPlayer.play.mock.invocationCallOrder[0]);
      expect(progress()).toMatchObject({ partPath: partPath(2), position: 120, duration: 600 });
    });

    it('starts an explicitly chosen different part from 0, even with progress saved elsewhere', async () => {
      store.dispatch(setListenProgress({
        folderKey: book.folderKey,
        progress: { partPath: partPath(2), position: 120, duration: 600, updatedAt: 1 },
      }));

      await playAndLoad(300, 0);

      expect(mockPlayer.replace).toHaveBeenCalledWith(partUri(1));
      expect(mockPlayer.seekTo).not.toHaveBeenCalled();
      expect(mockPlayer.play).toHaveBeenCalled();
      expect(progress()).toMatchObject({ partPath: partPath(1), position: 0, duration: 300 });
    });

    it('resumes an explicitly chosen part when it is the saved part', async () => {
      store.dispatch(setListenProgress({
        folderKey: book.folderKey,
        progress: { partPath: partPath(2), position: 45, duration: 600, updatedAt: 1 },
      }));

      await playAndLoad(600, 1);
      expect(mockPlayer.replace).toHaveBeenCalledWith(partUri(2));
      expect(mockPlayer.seekTo).toHaveBeenCalledWith(45);
    });

    it('starts the book when the saved part no longer exists (after a rescan)', async () => {
      store.dispatch(setListenProgress({
        folderKey: book.folderKey,
        progress: { partPath: 'a/the-book/gone.mp3', position: 120, duration: 600, updatedAt: 1 },
      }));

      await playAndLoad(600);
      expect(mockPlayer.replace).toHaveBeenCalledWith(partUri(1));
      expect(mockPlayer.seekTo).not.toHaveBeenCalled();
    });

    it('only resumes (no reload) when the same book is already loaded and no other part is asked for', async () => {
      await playAndLoad(600);
      mockPlayer.tick(30);
      mockPlayer.pause();
      mockPlayer.emit({ playing: false });
      mockPlayer.replace.mockClear();
      mockPlayer.play.mockClear();

      await service.play(book);
      expect(mockPlayer.replace).not.toHaveBeenCalled();
      expect(mockPlayer.play).toHaveBeenCalledTimes(1);

      // Already playing: nothing to do.
      mockPlayer.emit({ playing: true });
      await service.play(book, 0);
      expect(mockPlayer.replace).not.toHaveBeenCalled();
      expect(mockPlayer.play).toHaveBeenCalledTimes(1);
    });

    it('reloads when a different part of the loaded book is asked for', async () => {
      await playAndLoad(600);
      await service.play(book, 2);
      expect(mockPlayer.replace).toHaveBeenLastCalledWith(partUri(3));
      expect(service.getSnapshot()?.partIndex).toBe(2);
    });

    it('keeps the place of the book it leaves when another book starts', async () => {
      await playAndLoad(600);
      mockPlayer.tick(77);

      const other = makeBook({ folderKey: 'other', title: 'Other' }, 1);
      store.dispatch(setAudiobooks([book, other]));
      await service.play(other);

      expect(lib().listenProgress[book.folderKey]).toMatchObject({ partPath: partPath(1), position: 77 });
      expect(mockPlayer.replace).toHaveBeenLastCalledWith('content://a/the-book/1.mp3');
      expect(service.getSnapshot()?.folderKey).toBe('other');
    });

    it('records the book as last opened', async () => {
      await service.play(book);
      expect(lib().audiobooks[0].lastOpened).toBe(now);
    });

    it('ignores a book with no audio files', async () => {
      await service.play(makeBook({ files: [] }, 0));
      expect(mockPlayer.replace).not.toHaveBeenCalled();
      expect(service.getSnapshot()).toBeNull();
      expect(logger.warn).toHaveBeenCalled();
    });

    it('configures the audio session once, for background playback with lock-screen controls', async () => {
      await service.play(book);
      await service.play(book, 1);
      expect(mockSetAudioMode).toHaveBeenCalledTimes(1);
      expect(mockSetAudioMode).toHaveBeenCalledWith({
        playsInSilentMode: true,
        shouldPlayInBackground: true,
        interruptionMode: 'doNotMix',
      });
    });

    it('pauses before replacing the source so the new part does not blip from 0', async () => {
      await playAndLoad(600);
      mockPlayer.pause.mockClear();
      await service.play(book, 1);
      expect(mockPlayer.pause).toHaveBeenCalled();
      expect(mockPlayer.pause.mock.invocationCallOrder[0]).toBeLessThan(mockPlayer.replace.mock.invocationCallOrder.at(-1)!);
    });

    it('ignores "loaded" events that arrive before the new source has actually loaded', async () => {
      await playAndLoad(600);
      mockPlayer.play.mockClear();
      await service.play(book, 1);
      // A queued event from the previous part: its flag says loaded, but the player now is not.
      mockPlayer.emit({ isLoaded: true });
      expect(mockPlayer.play).not.toHaveBeenCalled();
      mockPlayer.finishLoading(400);
      expect(mockPlayer.play).toHaveBeenCalledTimes(1);
    });
  });

  // ── Now-playing snapshot ───────────────────────────────────────────────────

  describe('snapshot', () => {
    it('is null until something plays, and referentially stable between changes', async () => {
      expect(service.getSnapshot()).toBeNull();
      await playAndLoad(600);
      const first = service.getSnapshot();
      expect(first).toMatchObject({ folderKey: 'the-book', partIndex: 0, title: 'The Book', finished: false, error: null });
      mockPlayer.tick(10);
      mockPlayer.tick(20);
      expect(service.getSnapshot()).toBe(first);
    });

    it('notifies subscribers when it changes, and stops after unsubscribe', async () => {
      const listener = jest.fn();
      const unsubscribe = service.subscribe(listener);
      await playAndLoad(600);
      expect(listener).toHaveBeenCalledTimes(1);

      service.nextPart();
      expect(listener).toHaveBeenCalledTimes(2);

      unsubscribe();
      await service.play(book, 0);
      expect(listener).toHaveBeenCalledTimes(2);
    });

    it('prefers the override title and cover over the scanned ones', async () => {
      book = makeBook({ poster: 'file:///posters/scanned.jpg' });
      store.dispatch(setAudiobooks([book]));
      store.dispatch(setMediaOverride({
        key: `audiobook:${book.folderKey}`,
        override: { title: 'Better Title', poster: 'file:///posters/mine.jpg' },
      }));

      await service.play(book);
      expect(service.getSnapshot()).toMatchObject({ title: 'Better Title', poster: 'file:///posters/mine.jpg' });
    });

    it('falls back to the scanned title and cover without an override', async () => {
      book = makeBook({ poster: 'file:///posters/scanned.jpg' });
      await service.play(book);
      expect(service.getSnapshot()).toMatchObject({ title: 'The Book', poster: 'file:///posters/scanned.jpg' });
    });

    it('is available synchronously, before the part has loaded', () => {
      void service.play(book);
      expect(service.getSnapshot()).toMatchObject({ folderKey: 'the-book', partIndex: 0 });
    });

    it('exposes the single underlying player', () => {
      expect(service.getPlayer()).toBe(mockPlayer);
      expect(service.getPlayer()).toBe(service.getPlayer());
    });
  });

  // ── Lock screen ────────────────────────────────────────────────────────────

  describe('lock-screen controls', () => {
    it('activates them with title, author, part and a file:// cover', async () => {
      book = makeBook({ poster: 'file:///posters/scanned.jpg' });
      await service.play(book, 1);
      expect(mockPlayer.setActiveForLockScreen).toHaveBeenCalledWith(
        true,
        { title: 'The Book', artist: 'An Author', albumTitle: 'Part 2 of 3', artworkUrl: 'file:///posters/scanned.jpg' },
        { showSeekBackward: false, showSeekForward: false },
      );
    });

    it('omits a cover the native side could not open and the part label of a single file', async () => {
      book = makeBook({ poster: 'content://x/cover.jpg' }, 1);
      await service.play(book);
      const metadata = mockPlayer.setActiveForLockScreen.mock.calls[0][1];
      expect(metadata.artworkUrl).toBeUndefined();
      expect(metadata.albumTitle).toBeUndefined();
    });

    it('does not break playback if activating them throws', async () => {
      mockPlayer.setActiveForLockScreen.mockImplementation(() => { throw new Error('no service'); });
      await playAndLoad(600);
      expect(mockPlayer.play).toHaveBeenCalled();
      expect(logger.warn).toHaveBeenCalled();
    });
  });

  // ── Finishing and advancing ────────────────────────────────────────────────

  describe('when a part finishes', () => {
    it('marks it listened and carries on with the next part from 0', async () => {
      await playAndLoad(600);
      mockPlayer.play.mockClear();

      mockPlayer.finishPlaying();

      expect(lib().watched[partPath(1)]).toBe(now);
      expect(lib().watched[partPath(2)]).toBeUndefined();
      expect(mockPlayer.replace).toHaveBeenLastCalledWith(partUri(2));
      expect(service.getSnapshot()?.partIndex).toBe(1);
      // Progress already points at the start of the next part, before it has loaded.
      expect(progress()).toMatchObject({ partPath: partPath(2), position: 0 });

      mockPlayer.finishLoading(500);
      expect(mockPlayer.seekTo).not.toHaveBeenCalled();
      expect(mockPlayer.play).toHaveBeenCalledTimes(1);
      expect(progress()).toMatchObject({ partPath: partPath(2), position: 0, duration: 500 });
    });

    it('does not mark a part listened just because it was started or skipped', async () => {
      await playAndLoad(600);
      service.nextPart();
      mockPlayer.finishLoading(600);
      expect(lib().watched).toEqual({});
    });

    it('after the last part: marks it, clears progress, stops and leaves the book loaded as finished', async () => {
      await playAndLoad(600, 2);
      mockPlayer.replace.mockClear();
      expect(progress()).toBeDefined();

      mockPlayer.finishPlaying();

      expect(lib().watched[partPath(3)]).toBe(now);
      expect(progress()).toBeUndefined();
      expect(mockPlayer.replace).not.toHaveBeenCalled();
      expect(service.getSnapshot()).toMatchObject({ folderKey: 'the-book', partIndex: 2, finished: true });
    });

    it('does not re-create progress after the book finished (e.g. on the pause event that follows)', async () => {
      await playAndLoad(600, 2);
      mockPlayer.finishPlaying();
      progressDispatches.length = 0;

      mockPlayer.emit({ playing: false });
      appStateHandler('background');
      expect(progressDispatches).toEqual([]);
      expect(progress()).toBeUndefined();
    });

    it('starts the book over when play is pressed on a finished book', async () => {
      await playAndLoad(600, 2);
      mockPlayer.finishPlaying();
      mockPlayer.replace.mockClear();

      service.togglePlayPause();
      await Promise.resolve();
      await Promise.resolve();

      expect(mockPlayer.replace).toHaveBeenCalledWith(partUri(1));
      expect(service.getSnapshot()).toMatchObject({ partIndex: 0, finished: false });
    });

    it('treats a single-file book finishing as the end of the book', async () => {
      book = makeBook({}, 1);
      store.dispatch(setAudiobooks([book]));
      await playAndLoad(600);
      mockPlayer.finishPlaying();
      expect(lib().watched[partPath(1)]).toBeDefined();
      expect(progress()).toBeUndefined();
      expect(service.getSnapshot()?.finished).toBe(true);
    });
  });

  // ── Progress saving ────────────────────────────────────────────────────────

  describe('progress saving', () => {
    it('saves at most every 10 seconds while playing', async () => {
      await playAndLoad(600); // 1 save on load
      mockPlayer.emit({ playing: true });
      progressDispatches.length = 0;

      for (let t = 1; t <= 9; t++) {
        now += 1000;
        mockPlayer.tick(t);
      }
      expect(progressDispatches).toHaveLength(0);

      now += 1000; // 10 s since the load save
      mockPlayer.tick(10);
      expect(progressDispatches).toHaveLength(1);
      expect(progressDispatches[0]).toMatchObject({ partPath: partPath(1), position: 10, duration: 600, updatedAt: now });

      for (let t = 11; t <= 19; t++) {
        now += 1000;
        mockPlayer.tick(t);
      }
      expect(progressDispatches).toHaveLength(1);

      now += 1000;
      mockPlayer.tick(20);
      expect(progressDispatches).toHaveLength(2);
      expect(progress()).toMatchObject({ position: 20 });
    });

    it('saves immediately when playback pauses, even inside the throttle window', async () => {
      await playAndLoad(600);
      mockPlayer.emit({ playing: true });
      now += 2000;
      mockPlayer.tick(2);
      progressDispatches.length = 0;

      now += 1000;
      mockPlayer.currentTime = 3;
      mockPlayer.emit({ playing: false });

      expect(progressDispatches).toHaveLength(1);
      expect(progress()).toMatchObject({ position: 3, duration: 600 });
    });

    it('saves immediately on a seek', async () => {
      await playAndLoad(600);
      progressDispatches.length = 0;

      await service.seekTo(250);

      expect(mockPlayer.seekTo).toHaveBeenCalledWith(250);
      expect(progressDispatches).toHaveLength(1);
      expect(progress()).toMatchObject({ partPath: partPath(1), position: 250, duration: 600 });
    });

    it('clamps a seek into the part', async () => {
      await playAndLoad(600);
      await service.seekTo(9999);
      expect(mockPlayer.seekTo).toHaveBeenLastCalledWith(600);
      await service.seekTo(-5);
      expect(mockPlayer.seekTo).toHaveBeenLastCalledWith(0);
    });

    it('saves immediately when the app goes to the background while playing', async () => {
      await playAndLoad(600);
      mockPlayer.emit({ playing: true });
      now += 1000;
      mockPlayer.tick(1);
      mockPlayer.currentTime = 4;
      progressDispatches.length = 0;

      appStateHandler('background');

      expect(progressDispatches).toHaveLength(1);
      expect(progress()).toMatchObject({ position: 4 });
    });

    it('does not save on app state changes when nothing is playing', async () => {
      await playAndLoad(600);
      mockPlayer.emit({ playing: true });
      mockPlayer.pause();
      mockPlayer.emit({ playing: false }); // pause saves here
      progressDispatches.length = 0;

      appStateHandler('background');
      appStateHandler('active');
      expect(progressDispatches).toEqual([]);
    });

    it('saves the new part when the part changes', async () => {
      await playAndLoad(600);
      service.nextPart();
      mockPlayer.finishLoading(450);
      expect(progress()).toMatchObject({ partPath: partPath(2), position: 0, duration: 450 });
    });

    it('does not touch saved progress when a load fails', async () => {
      store.dispatch(setListenProgress({
        folderKey: book.folderKey,
        progress: { partPath: partPath(2), position: 120, duration: 600, updatedAt: 1 },
      }));
      await service.play(book);
      mockPlayer.emit({ playbackState: 'buffering', isLoaded: false });
      mockPlayer.emit({ playbackState: 'idle', isLoaded: false });
      appStateHandler('background');

      expect(progress()).toEqual({ partPath: partPath(2), position: 120, duration: 600, updatedAt: 1 });
    });
  });

  // ── Navigating parts ───────────────────────────────────────────────────────

  describe('nextPart / previousPart', () => {
    it('nextPart plays the following part from 0', async () => {
      await playAndLoad(600);
      mockPlayer.play.mockClear();
      service.nextPart();
      expect(mockPlayer.replace).toHaveBeenLastCalledWith(partUri(2));
      mockPlayer.finishLoading(300);
      expect(mockPlayer.play).toHaveBeenCalledTimes(1);
      expect(mockPlayer.seekTo).not.toHaveBeenCalled();
    });

    it('nextPart does nothing on the last part', async () => {
      await playAndLoad(600, 2);
      mockPlayer.replace.mockClear();
      service.nextPart();
      expect(mockPlayer.replace).not.toHaveBeenCalled();
      expect(service.getSnapshot()?.partIndex).toBe(2);
    });

    it('previousPart restarts the current part when more than 3 seconds in', async () => {
      await playAndLoad(600, 1);
      mockPlayer.replace.mockClear();
      mockPlayer.currentTime = 3.5;

      service.previousPart();
      await Promise.resolve();

      expect(mockPlayer.replace).not.toHaveBeenCalled();
      expect(mockPlayer.seekTo).toHaveBeenCalledWith(0);
    });

    it('previousPart goes back a part within the first 3 seconds', async () => {
      await playAndLoad(600, 1);
      mockPlayer.currentTime = 2;

      service.previousPart();

      expect(mockPlayer.replace).toHaveBeenLastCalledWith(partUri(1));
      expect(service.getSnapshot()?.partIndex).toBe(0);
    });

    it('previousPart on the first part just restarts it', async () => {
      await playAndLoad(600);
      mockPlayer.replace.mockClear();
      mockPlayer.currentTime = 1;

      service.previousPart();
      await Promise.resolve();

      expect(mockPlayer.replace).not.toHaveBeenCalled();
      expect(mockPlayer.seekTo).toHaveBeenCalledWith(0);
    });
  });

  describe('togglePlayPause', () => {
    it('pauses what is playing and plays what is paused', async () => {
      await playAndLoad(600);
      mockPlayer.emit({ playing: true });
      mockPlayer.pause.mockClear();
      mockPlayer.play.mockClear();

      service.togglePlayPause();
      expect(mockPlayer.pause).toHaveBeenCalledTimes(1);

      mockPlayer.emit({ playing: false });
      service.togglePlayPause();
      expect(mockPlayer.play).toHaveBeenCalledTimes(1);
    });

    it('does nothing when nothing is loaded', () => {
      service.togglePlayPause();
      expect(mockPlayer.play).not.toHaveBeenCalled();
    });
  });

  // ── Failures ───────────────────────────────────────────────────────────────

  describe('load failures', () => {
    it('surfaces an error and logs when the part falls back to idle instead of loading', async () => {
      await service.play(book);
      mockPlayer.emit({ playbackState: 'buffering', isLoaded: false });
      mockPlayer.emit({ playbackState: 'idle', isLoaded: false });

      expect(service.getSnapshot()?.error).toEqual(expect.any(String));
      expect(logger.error).toHaveBeenCalled();
      expect(mockPlayer.play).not.toHaveBeenCalled();
    });

    it('ignores the idle status Android sends before the new part is prepared', async () => {
      await service.play(book);
      mockPlayer.emit({ playbackState: 'idle', isLoaded: false });

      expect(service.getSnapshot()?.error).toBeNull();
      mockPlayer.finishLoading(300);
      expect(mockPlayer.play).toHaveBeenCalledTimes(1);
    });

    it('surfaces an error and does not throw when replace throws', async () => {
      mockPlayer.replace.mockImplementation(() => { throw new Error('Unsupported type'); });

      await expect(service.play(book)).resolves.toBeUndefined();

      expect(service.getSnapshot()?.error).toEqual(expect.any(String));
      expect(logger.error).toHaveBeenCalled();
    });

    it('retries the failed part when play is pressed, and clears the error', async () => {
      mockPlayer.replace.mockImplementationOnce(() => { throw new Error('Unsupported type'); });
      await service.play(book);
      expect(service.getSnapshot()?.error).not.toBeNull();

      service.togglePlayPause();
      await Promise.resolve();
      await Promise.resolve();

      expect(service.getSnapshot()?.error).toBeNull();
      expect(mockPlayer.replace).toHaveBeenCalledTimes(2);
      mockPlayer.finishLoading(300);
      expect(mockPlayer.play).toHaveBeenCalledTimes(1);
    });
  });
});
