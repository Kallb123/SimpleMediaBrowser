import type { AppStateStatus } from 'react-native';
import {
  AUTOSAVE_THROTTLE_MS,
  EMPTY_PERSISTED_LIBRARY,
  LIBRARY_STORE_VERSION,
  LibraryStore,
  pickPersistedLibrary,
  type AppStateSource,
  type LibraryBatch,
  type LibraryDb,
  type LibraryDbContents,
  type PersistedLibrary,
} from '../LibraryStore';
import { makeLibrary, makeSource, show } from '@/scripts/__testutils__/libraryFixtures';

// Logger and expo-sqlite pull in native modules; the store under test only
// needs the logger's surface and talks to an in-memory LibraryDb.
jest.mock('@/scripts/Logger', () => ({
  logger: { log: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));
jest.mock('expo-sqlite', () => ({ openDatabaseAsync: jest.fn() }));

/**
 * In-memory LibraryDb.  Each batch is applied to a copy and swapped in only if
 * it succeeds, mimicking a transaction; it records committed batches and can
 * inject failures.
 */
class FakeDb implements LibraryDb {
  version: string | null = null;
  shows = new Map<string, string>();
  kv = new Map<string, string>();
  /** Batches that were committed, in order. */
  batches: LibraryBatch[] = [];
  /** Throw (before committing anything) for batches this returns true for. */
  failWhen: (batch: LibraryBatch) => boolean = () => false;
  /** Awaited at the start of every write; lets a test park a save. */
  beforeWrite: () => Promise<void> = async () => {};

  async readAll(): Promise<LibraryDbContents | null> {
    if (this.version === null) return null;
    return {
      version: this.version,
      shows: [...this.shows].map(([name, json]) => ({ name, json })),
      kv: [...this.kv].map(([key, json]) => ({ key, json })),
    };
  }

  async write(batch: LibraryBatch): Promise<void> {
    await this.beforeWrite();
    const shows = new Map(this.shows);
    const kv = new Map(this.kv);
    let version = this.version;
    if (batch.clearShows) shows.clear();
    batch.deleteShows.forEach(name => shows.delete(name));
    batch.putShows.forEach(({ name, json }) => shows.set(name, json));
    batch.putKv.forEach(({ key, json }) => kv.set(key, json));
    if (batch.version !== undefined) version = batch.version;
    // Everything is staged; fail here to prove nothing leaks out of a failed transaction.
    if (this.failWhen(batch)) throw new Error('injected write failure');
    this.shows = shows;
    this.kv = kv;
    this.version = version;
    this.batches.push(batch);
  }

  clearBatches() {
    this.batches = [];
  }
  showJson(name: string) {
    return JSON.parse(this.shows.get(name)!);
  }
}

describe('pickPersistedLibrary', () => {
  it('strips transient and legacy fields', () => {
    const picked = pickPersistedLibrary({
      ...makeLibrary(),
      isScanning: true,
      scanProgress: { phase: 'scanning' },
      scanList: ['x'],
    });
    expect(Object.keys(picked).sort()).toEqual(['audiobooks', 'listenProgress', 'mediaLibrary', 'mediaOverrides', 'movies', 'thumbnails', 'watchProgress', 'watched']);
  });

  it('defaults missing fields to empty', () => {
    expect(pickPersistedLibrary({ movies: [1] })).toEqual({
      ...EMPTY_PERSISTED_LIBRARY,
      movies: [1],
    });
    expect(pickPersistedLibrary(null)).toEqual(EMPTY_PERSISTED_LIBRARY);
    expect(pickPersistedLibrary(undefined)).toEqual(EMPTY_PERSISTED_LIBRARY);
  });

  it('preserves object identity of the fields it copies', () => {
    const lib = makeLibrary();
    const picked = pickPersistedLibrary({ ...lib, isScanning: false });
    expect(picked.mediaLibrary).toBe(lib.mediaLibrary);
    expect(picked.movies).toBe(lib.movies);
    expect(picked.audiobooks).toBe(lib.audiobooks);
    expect(picked.mediaOverrides).toBe(lib.mediaOverrides);
    expect(picked.thumbnails).toBe(lib.thumbnails);
    expect(picked.watched).toBe(lib.watched);
    expect(picked.listenProgress).toBe(lib.listenProgress);
    expect(picked.watchProgress).toBe(lib.watchProgress);
  });
});

describe('LibraryStore', () => {
  let db: FakeDb;
  let appStateHandler: ((state: AppStateStatus) => void) | undefined;
  let appStateRemove: jest.Mock;
  let appState: AppStateSource;

  beforeEach(() => {
    jest.useFakeTimers();
    db = new FakeDb();
    appStateRemove = jest.fn();
    appStateHandler = undefined;
    appState = {
      addEventListener: (_type, handler) => {
        appStateHandler = handler;
        return { remove: appStateRemove };
      },
    };
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  /** A store with `makeLibrary()` already written, plus a source bound to it. */
  async function started() {
    const store = new LibraryStore(db);
    const lib = makeLibrary();
    await store.writeAll(lib);
    const source = makeSource(lib);
    const stop = store.startAutoSave(source, appState);
    db.clearBatches();
    return { store, source, stop, lib };
  }

  const names = (batch: LibraryBatch) => batch.putShows.map(s => s.name);

  describe('load / writeAll', () => {
    it('load() on an uninitialised db returns null', async () => {
      expect(await new LibraryStore(db).load()).toBeNull();
    });

    it('round-trips through a fresh store on the same db', async () => {
      const lib = makeLibrary();
      await new LibraryStore(db).writeAll(lib);
      const loaded = await new LibraryStore(db).load();
      expect(loaded).toEqual(lib);
      expect(Object.keys(loaded!.mediaLibrary)).toEqual(Object.keys(lib.mediaLibrary));
    });

    it('stores show names verbatim (slashes, quotes, unicode, emoji)', async () => {
      const odd = ['a/b\\c', `it's "quoted"`, 'Amélie 日本語', 'Party 🎉🍿', '../../etc', "x'; DROP TABLE shows;--", 'constructor'];
      const lib: PersistedLibrary = {
        ...EMPTY_PERSISTED_LIBRARY,
        mediaLibrary: Object.fromEntries(odd.map(n => [n, show(n)])),
      };
      await new LibraryStore(db).writeAll(lib);
      expect([...db.shows.keys()]).toEqual(odd);
      expect(await new LibraryStore(db).load()).toEqual(lib);
    });

    it('round-trips an empty library', async () => {
      await new LibraryStore(db).writeAll(EMPTY_PERSISTED_LIBRARY);
      expect(await new LibraryStore(db).load()).toEqual(EMPTY_PERSISTED_LIBRARY);
    });

    it('writeAll is a single batch that includes everything and the version marker', async () => {
      const lib = makeLibrary();
      await new LibraryStore(db).writeAll(lib);
      expect(db.batches).toHaveLength(1);
      const [batch] = db.batches;
      expect(batch.version).toBe(String(LIBRARY_STORE_VERSION));
      expect(batch.clearShows).toBe(true);
      expect(names(batch)).toEqual(Object.keys(lib.mediaLibrary));
      expect(batch.putKv.map(k => k.key).sort()).toEqual(['audiobooks', 'listenProgress', 'mediaOverrides', 'movies', 'thumbnails', 'watchProgress', 'watched']);
    });

    it('writeAll replaces previous contents', async () => {
      await new LibraryStore(db).writeAll(makeLibrary());
      const next: PersistedLibrary = {
        ...EMPTY_PERSISTED_LIBRARY,
        mediaLibrary: { Bluey: show('Bluey', { year: 1 }), 'New Show': show('New Show') },
      };
      await new LibraryStore(db).writeAll(next);
      expect([...db.shows.keys()].sort()).toEqual(['Bluey', 'New Show']);
      expect(await new LibraryStore(db).load()).toEqual(next);
    });

    it('writeAll failure rejects, commits nothing and leaves the store uninitialised', async () => {
      db.failWhen = () => true;
      const store = new LibraryStore(db);
      await expect(store.writeAll(makeLibrary())).rejects.toThrow(/injected/);
      expect(db.version).toBeNull();
      expect(db.shows.size).toBe(0);
      expect(db.kv.size).toBe(0);
      expect(await new LibraryStore(db).load()).toBeNull();
      // No baseline was recorded, so autosave can't start on the failed write.
      expect(() => store.startAutoSave(makeSource(makeLibrary()), appState)).toThrow();
    });

    it('treats a missing kv row as empty and recreates it on the next save', async () => {
      await new LibraryStore(db).writeAll(makeLibrary());
      db.kv.delete('movies');

      const store = new LibraryStore(db);
      const loaded = (await store.load())!;
      expect(loaded.movies).toEqual([]);
      const stop = store.startAutoSave(makeSource(loaded), appState);
      db.clearBatches();
      await store.flush();
      expect(db.batches).toHaveLength(1);
      expect(db.batches[0].putKv.map(k => k.key)).toEqual(['movies']);
      expect(db.batches[0].putShows).toEqual([]);
      stop();
    });

    it('loads a store written before watched tracking as having none, and adds the row on the next save', async () => {
      await new LibraryStore(db).writeAll(makeLibrary());
      db.kv.delete('watched');

      const store = new LibraryStore(db);
      const loaded = (await store.load())!;
      expect(loaded.watched).toEqual({});
      const stop = store.startAutoSave(makeSource(loaded), appState);
      db.clearBatches();
      await store.flush();
      expect(db.batches).toHaveLength(1);
      expect(db.batches[0].putKv.map(k => k.key)).toEqual(['watched']);
      expect(db.kv.get('watched')).toBe('{}');
      stop();
    });

    it('persists watched marks and loads them back', async () => {
      const lib = makeLibrary();
      await new LibraryStore(db).writeAll(lib);
      expect((await new LibraryStore(db).load())!.watched).toEqual(lib.watched);
    });

    it('loads a store written before listen progress as having none, and adds the row on the next save', async () => {
      await new LibraryStore(db).writeAll(makeLibrary());
      db.kv.delete('listenProgress');

      const store = new LibraryStore(db);
      const loaded = (await store.load())!;
      expect(loaded.listenProgress).toEqual({});
      const stop = store.startAutoSave(makeSource(loaded), appState);
      db.clearBatches();
      await store.flush();
      expect(db.batches).toHaveLength(1);
      expect(db.batches[0].putKv.map(k => k.key)).toEqual(['listenProgress']);
      expect(db.kv.get('listenProgress')).toBe('{}');
      stop();
    });

    it('persists listen progress and loads it back', async () => {
      const lib = makeLibrary();
      await new LibraryStore(db).writeAll(lib);
      expect((await new LibraryStore(db).load())!.listenProgress).toEqual(lib.listenProgress);
    });

    it('loads a store written before video progress as having none, and adds the row on the next save', async () => {
      await new LibraryStore(db).writeAll(makeLibrary());
      db.kv.delete('watchProgress');

      const store = new LibraryStore(db);
      const loaded = (await store.load())!;
      expect(loaded.watchProgress).toEqual({});
      const stop = store.startAutoSave(makeSource(loaded), appState);
      db.clearBatches();
      await store.flush();
      expect(db.batches).toHaveLength(1);
      expect(db.batches[0].putKv.map(k => k.key)).toEqual(['watchProgress']);
      expect(db.kv.get('watchProgress')).toBe('{}');
      stop();
    });

    it('persists video progress and loads it back', async () => {
      const lib = makeLibrary();
      await new LibraryStore(db).writeAll(lib);
      expect((await new LibraryStore(db).load())!.watchProgress).toEqual(lib.watchProgress);
    });

    it('throws when the watchProgress row has the wrong shape', async () => {
      await new LibraryStore(db).writeAll(makeLibrary());
      db.kv.set('watchProgress', '[]');
      await expect(new LibraryStore(db).load()).rejects.toThrow(/unexpected shape/);
    });

    it('throws when the listenProgress row has the wrong shape', async () => {
      await new LibraryStore(db).writeAll(makeLibrary());
      db.kv.set('listenProgress', '[]');
      await expect(new LibraryStore(db).load()).rejects.toThrow(/unexpected shape/);
    });

    it('throws when the watched row has the wrong shape', async () => {
      await new LibraryStore(db).writeAll(makeLibrary());
      db.kv.set('watched', '[]');
      await expect(new LibraryStore(db).load()).rejects.toThrow(/unexpected shape/);
    });

    it('throws when a show row is corrupt', async () => {
      await new LibraryStore(db).writeAll(makeLibrary());
      db.shows.set('Bluey', '{"title": "Blu');
      await expect(new LibraryStore(db).load()).rejects.toThrow(/not valid JSON/);
    });

    it('throws when a show row is not an object', async () => {
      await new LibraryStore(db).writeAll(makeLibrary());
      db.shows.set('Bluey', '[1]');
      await expect(new LibraryStore(db).load()).rejects.toThrow(/unexpected shape/);
    });

    it('throws when a kv row is corrupt', async () => {
      await new LibraryStore(db).writeAll(makeLibrary());
      db.kv.set('mediaOverrides', 'nope');
      await expect(new LibraryStore(db).load()).rejects.toThrow(/not valid JSON/);
    });

    it('throws when a kv row has the wrong shape', async () => {
      await new LibraryStore(db).writeAll(makeLibrary());
      db.kv.set('movies', '{}');
      await expect(new LibraryStore(db).load()).rejects.toThrow(/unexpected shape/);
      db.kv.set('movies', '[]');
      db.kv.set('thumbnails', '[]');
      await expect(new LibraryStore(db).load()).rejects.toThrow(/unexpected shape/);
      db.kv.set('thumbnails', 'null');
      await expect(new LibraryStore(db).load()).rejects.toThrow(/unexpected shape/);
    });

    it('throws on an invalid version', async () => {
      await new LibraryStore(db).writeAll(makeLibrary());
      db.version = 'abc';
      await expect(new LibraryStore(db).load()).rejects.toThrow(/invalid version/);
    });

    it('throws when the version is newer than supported, without writing anything', async () => {
      await new LibraryStore(db).writeAll(makeLibrary());
      db.version = String(LIBRARY_STORE_VERSION + 1);
      db.clearBatches();
      await expect(new LibraryStore(db).load()).rejects.toThrow(/newer than supported/);
      expect(db.batches).toEqual([]);
    });

    it('propagates database read errors', async () => {
      db.readAll = async () => {
        throw new Error('disk I/O error');
      };
      await expect(new LibraryStore(db).load()).rejects.toThrow(/disk I\/O/);
    });

    it('startAutoSave requires a baseline', () => {
      expect(() => new LibraryStore(db).startAutoSave(makeSource(makeLibrary()), appState)).toThrow();
    });
  });

  describe('incremental save', () => {
    it('writes nothing when state is unchanged', async () => {
      const { store, source, stop } = await started();
      source.set({ ...source.state }); // new wrapper object, same field references
      await jest.advanceTimersByTimeAsync(AUTOSAVE_THROTTLE_MS * 3);
      await store.flush();
      expect(db.batches).toEqual([]);
      stop();
    });

    it('writes only the changed show', async () => {
      const { store, source, lib, stop } = await started();
      source.set({
        ...lib,
        mediaLibrary: { ...lib.mediaLibrary, Bluey: show('Bluey', { year: 1999 }) },
      });
      await store.flush();
      expect(db.batches).toEqual([{ putShows: [{ name: 'Bluey', json: JSON.stringify(show('Bluey', { year: 1999 })) }], deleteShows: [], putKv: [] }]);
      expect(db.showJson('Bluey').year).toBe(1999);
      stop();
    });

    it('writes an added show', async () => {
      const { store, source, lib, stop } = await started();
      source.set({ ...lib, mediaLibrary: { ...lib.mediaLibrary, 'New Show': show('New Show') } });
      await store.flush();
      expect(db.batches).toHaveLength(1);
      expect(names(db.batches[0])).toEqual(['New Show']);
      expect(db.batches[0].deleteShows).toEqual([]);
      expect(db.shows.has('New Show')).toBe(true);
      stop();
    });

    it('deletes a removed show', async () => {
      const { store, source, lib, stop } = await started();
      const { Bluey, ...rest } = lib.mediaLibrary;
      source.set({ ...lib, mediaLibrary: rest });
      await store.flush();
      expect(db.batches).toHaveLength(1);
      expect(db.batches[0].putShows).toEqual([]);
      expect(db.batches[0].deleteShows).toEqual(['Bluey']);
      expect(db.shows.has('Bluey')).toBe(false);
      stop();
    });

    it('writes only the watched row when a file is marked watched', async () => {
      const { store, source, lib, stop } = await started();
      source.set({ ...lib, watched: { ...lib.watched, 'm/b.mkv': 1700000001000 } });
      await store.flush();
      expect(db.batches).toHaveLength(1);
      expect(db.batches[0].putShows).toEqual([]);
      expect(db.batches[0].putKv.map(k => k.key)).toEqual(['watched']);
      expect(JSON.parse(db.kv.get('watched')!)).toEqual({ 'm/a.mkv': 1700000000000, 'm/b.mkv': 1700000001000 });
      stop();
    });

    it('writes only the listenProgress row when listening progress is recorded', async () => {
      const { store, source, lib, stop } = await started();
      const progress = { partPath: 'book/2.mp3', position: 3, duration: 900, updatedAt: 1700000002000 };
      source.set({ ...lib, listenProgress: { ...lib.listenProgress, book: progress } });
      await store.flush();
      expect(db.batches).toHaveLength(1);
      expect(db.batches[0].putShows).toEqual([]);
      expect(db.batches[0].putKv.map(k => k.key)).toEqual(['listenProgress']);
      expect(JSON.parse(db.kv.get('listenProgress')!)).toEqual({ book: progress });
      stop();
    });

    it('writes only the watchProgress row when video progress is recorded', async () => {
      const { store, source, lib, stop } = await started();
      const progress = { position: 600, duration: 5400, updatedAt: 1700000003000 };
      source.set({ ...lib, watchProgress: { ...lib.watchProgress, 'm/b.mkv': progress } });
      await store.flush();
      expect(db.batches).toHaveLength(1);
      expect(db.batches[0].putShows).toEqual([]);
      expect(db.batches[0].putKv.map(k => k.key)).toEqual(['watchProgress']);
      expect(JSON.parse(db.kv.get('watchProgress')!)).toEqual({ 'm/a.mkv': lib.watchProgress['m/a.mkv'], 'm/b.mkv': progress });
      stop();
    });

    it('only writes the kv key whose reference changed', async () => {
      const { store, source, lib, stop } = await started();
      source.set({ ...lib, thumbnails: { ...lib.thumbnails, 'content://m/b.mkv': 'file:///t/b.jpg' } });
      await store.flush();
      expect(db.batches).toHaveLength(1);
      expect(db.batches[0].putShows).toEqual([]);
      expect(db.batches[0].deleteShows).toEqual([]);
      expect(db.batches[0].putKv.map(k => k.key)).toEqual(['thumbnails']);
      stop();
    });

    it('does not mark the store initialised again or clear shows', async () => {
      const { store, source, lib, stop } = await started();
      source.set({ ...lib, movies: [] });
      await store.flush();
      expect(db.batches[0].version).toBeUndefined();
      expect(db.batches[0].clearShows).toBeUndefined();
      stop();
    });

    it('an incremental save can be loaded by a fresh store', async () => {
      const { store, source, lib, stop } = await started();
      const { Bluey, ...rest } = lib.mediaLibrary;
      const next = {
        ...lib,
        mediaLibrary: { ...rest, 'New Show': show('New Show'), 'Party 🎉🍿': show('Party 🎉🍿', { year: 5 }) },
        movies: [],
      };
      source.set(next);
      await store.flush();
      expect(await new LibraryStore(db).load()).toEqual(next);
      stop();
    });

    it('saves after a load use the loaded shows as the baseline', async () => {
      await new LibraryStore(db).writeAll(makeLibrary());
      const store = new LibraryStore(db);
      const loaded = (await store.load())!;
      const source = makeSource(loaded);
      const stop = store.startAutoSave(source, appState);
      db.clearBatches();
      await store.flush();
      expect(db.batches).toEqual([]);

      source.set({ ...loaded, mediaLibrary: { ...loaded.mediaLibrary, Bluey: show('Bluey', { year: 3 }) } });
      await store.flush();
      expect(db.batches).toHaveLength(1);
      expect(names(db.batches[0])).toEqual(['Bluey']);
      stop();
    });
  });

  describe('throttling and flushing', () => {
    it('coalesces changes inside the throttle window into one save', async () => {
      const { source, lib, stop } = await started();
      const change = (year: number) =>
        source.set({ ...lib, mediaLibrary: { ...lib.mediaLibrary, Bluey: show('Bluey', { year }) } });

      change(1);
      await jest.advanceTimersByTimeAsync(AUTOSAVE_THROTTLE_MS - 100);
      change(2);
      change(3);
      expect(db.batches).toEqual([]);

      await jest.advanceTimersByTimeAsync(100);
      expect(db.batches).toHaveLength(1);
      expect(db.showJson('Bluey').year).toBe(3);

      await jest.advanceTimersByTimeAsync(AUTOSAVE_THROTTLE_MS * 3);
      expect(db.batches).toHaveLength(1);
      stop();
    });

    it('flush() writes immediately and cancels the pending timer', async () => {
      const { store, source, lib, stop } = await started();
      source.set({ ...lib, movies: [] });
      expect(db.batches).toEqual([]);
      await store.flush();
      expect(db.batches).toHaveLength(1);
      await jest.advanceTimersByTimeAsync(AUTOSAVE_THROTTLE_MS * 3);
      expect(db.batches).toHaveLength(1);
      stop();
    });

    it('flushes when the app goes to the background', async () => {
      const { source, lib, stop } = await started();
      source.set({ ...lib, movies: [] });
      appStateHandler!('background');
      await jest.advanceTimersByTimeAsync(0);
      expect(db.batches).toHaveLength(1);
      stop();
    });

    it('flushes when the app becomes inactive, but not when it becomes active', async () => {
      const { source, lib, stop } = await started();
      source.set({ ...lib, movies: [] });
      appStateHandler!('active');
      await jest.advanceTimersByTimeAsync(0);
      expect(db.batches).toEqual([]);
      appStateHandler!('inactive');
      await jest.advanceTimersByTimeAsync(0);
      expect(db.batches).toHaveLength(1);
      stop();
    });

    it('stop() unsubscribes, cancels the timer and removes the AppState listener', async () => {
      const { source, lib, stop } = await started();
      source.set({ ...lib, movies: [] });
      stop();
      await jest.advanceTimersByTimeAsync(AUTOSAVE_THROTTLE_MS * 3);
      expect(db.batches).toEqual([]);
      expect(appStateRemove).toHaveBeenCalled();
    });

    it('never runs two saves concurrently, and picks up changes made mid-save', async () => {
      const { store, source, lib, stop } = await started();
      let release!: () => void;
      const gate = new Promise<void>(r => (release = r));
      let active = 0;
      let maxActive = 0;
      db.beforeWrite = async () => {
        active++;
        maxActive = Math.max(maxActive, active);
        await gate;
        active--;
      };

      source.set({ ...lib, movies: [] });
      const first = store.flush();
      await jest.advanceTimersByTimeAsync(0);
      // First save is parked inside write(); a change and a second flush arrive meanwhile.
      source.set({ ...lib, movies: [], thumbnails: {} });
      const second = store.flush();
      await jest.advanceTimersByTimeAsync(AUTOSAVE_THROTTLE_MS * 2);
      release();
      await Promise.all([first, second]);

      expect(maxActive).toBe(1);
      expect(db.batches).toHaveLength(2);
      expect(db.kv.get('thumbnails')).toBe('{}');
      expect(db.kv.get('movies')).toBe('[]');
      stop();
    });

    it('a change arriving mid-save is saved by the autosave timer afterwards', async () => {
      const { source, lib, stop } = await started();
      let release!: () => void;
      db.beforeWrite = () => new Promise<void>(r => (release = r));

      const movies: any[] = [];
      source.set({ ...lib, movies });
      await jest.advanceTimersByTimeAsync(AUTOSAVE_THROTTLE_MS); // timer fires, save parks in write()
      source.set({ ...lib, movies, thumbnails: {} });
      db.beforeWrite = async () => {};
      release();
      await jest.advanceTimersByTimeAsync(AUTOSAVE_THROTTLE_MS * 2);

      expect(db.batches).toHaveLength(2);
      expect(db.batches[1].putKv.map(k => k.key)).toEqual(['thumbnails']);
      stop();
    });
  });

  describe('failure handling', () => {
    it('a failed batch commits nothing and the whole diff is retried on the next save', async () => {
      const { store, source, lib, stop } = await started();
      const before = { shows: new Map(db.shows), kv: new Map(db.kv) };
      db.failWhen = () => true;

      source.set({
        ...lib,
        mediaLibrary: { ...lib.mediaLibrary, Bluey: show('Bluey', { year: 1 }), 'Party 🎉🍿': show('Party 🎉🍿', { year: 2 }) },
        movies: [],
      });
      await expect(store.flush()).resolves.toBeUndefined();
      expect(db.batches).toEqual([]);
      expect(db.shows).toEqual(before.shows);
      expect(db.kv).toEqual(before.kv);

      db.failWhen = () => false;
      await store.flush();
      expect(db.batches).toHaveLength(1);
      expect(names(db.batches[0]).sort()).toEqual(['Bluey', 'Party 🎉🍿']);
      expect(db.batches[0].putKv.map(k => k.key)).toEqual(['movies']);
      expect(await new LibraryStore(db).load()).toEqual(source.state);
      stop();
    });

    it('a failed removal is retried on the next save', async () => {
      const { store, source, lib, stop } = await started();
      const { Bluey, ...rest } = lib.mediaLibrary;
      db.failWhen = () => true;
      source.set({ ...lib, mediaLibrary: rest });
      await store.flush();
      expect(db.shows.has('Bluey')).toBe(true);

      db.failWhen = () => false;
      await store.flush();
      expect(db.batches).toHaveLength(1);
      expect(db.batches[0].deleteShows).toEqual(['Bluey']);
      expect(db.shows.has('Bluey')).toBe(false);
      stop();
    });

    it('a later change after a failure is saved together with the failed one', async () => {
      const { store, source, lib, stop } = await started();
      db.failWhen = () => true;
      source.set({ ...lib, mediaLibrary: { ...lib.mediaLibrary, Bluey: show('Bluey', { year: 1 }) } });
      await store.flush();

      db.failWhen = () => false;
      source.set({ ...source.state, mediaLibrary: { ...source.state.mediaLibrary, 'New Show': show('New Show') } });
      await store.flush();
      expect(db.batches).toHaveLength(1);
      expect(names(db.batches[0]).sort()).toEqual(['Bluey', 'New Show']);
      expect(await new LibraryStore(db).load()).toEqual(source.state);
      stop();
    });

    it('does not throw out of the autosave timer when a write fails', async () => {
      const { source, lib, stop } = await started();
      db.failWhen = () => true;
      source.set({ ...lib, movies: [] });
      await expect(jest.advanceTimersByTimeAsync(AUTOSAVE_THROTTLE_MS)).resolves.toBeUndefined();
      stop();
    });
  });
});
