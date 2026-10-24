import { AppState } from 'react-native';
import {
  AUTOSAVE_THROTTLE_MS,
  EMPTY_PERSISTED_LIBRARY,
  LIBRARY_STORE_VERSION,
  LibraryStore,
  fnv1a32Hex,
  pickPersistedLibrary,
  type LibraryFs,
  type PersistedLibrary,
} from '../LibraryStore';

// Logger and expo-file-system pull in native modules; the store under test only
// needs the logger's surface and talks to an in-memory LibraryFs.
jest.mock('@/scripts/Logger', () => ({
  logger: { log: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));
jest.mock('expo-file-system', () => ({
  Directory: class {},
  File: class {},
  Paths: { document: 'file:///doc/' },
}));

type Op = { op: 'write' | 'remove'; path: string };

/** In-memory LibraryFs that records mutating operations and can inject write failures. */
class FakeFs implements LibraryFs {
  files = new Map<string, string>();
  ops: Op[] = [];
  failWrite: (path: string) => boolean = () => false;

  async read(path: string) {
    return this.files.get(path) ?? null;
  }
  async write(path: string, contents: string) {
    if (this.failWrite(path)) throw new Error(`injected write failure: ${path}`);
    this.ops.push({ op: 'write', path });
    this.files.set(path, contents);
  }
  async remove(path: string) {
    this.ops.push({ op: 'remove', path });
    this.files.delete(path);
  }
  async list(dir: string) {
    const prefix = dir ? `${dir}/` : '';
    return [...this.files.keys()]
      .filter(p => p.startsWith(prefix) && !p.slice(prefix.length).includes('/'))
      .map(p => p.slice(prefix.length));
  }
  clearOps() {
    this.ops = [];
  }
  paths(kind?: Op['op']) {
    return this.ops.filter(o => !kind || o.op === kind).map(o => o.path);
  }
}

const show = (title: string, extra: object = {}): any => ({
  ids: { tvdb: null, imdb: null, tmdb: null },
  title,
  year: 2020,
  poster: '',
  seasons: { '1': { episodes: { '1': { path: `content://x/${title}/1.mkv` } } } },
  ...extra,
});

const makeLibrary = (): PersistedLibrary => ({
  mediaLibrary: {
    'Bluey': show('Bluey'),
    'AC/DC: Live': show('AC/DC: Live'),
    'Amélie 日本語': show('Amélie 日本語'),
    'Party 🎉🍿': show('Party 🎉🍿'),
  },
  movies: [{ name: 'Movie A', path: 'content://m/a.mkv' } as any],
  audiobooks: [{ title: 'Book', folderKey: 'book', path: 'p', files: [], poster: '' } as any],
  mediaOverrides: { 'show:Bluey': { title: 'Bluey!' } },
  thumbnails: { 'content://m/a.mkv': 'file:///t/a.jpg' },
});

/** Minimal stand-in for a Redux store holding a PersistedLibrary. */
function makeSource(initial: PersistedLibrary) {
  let state = initial;
  const listeners = new Set<() => void>();
  return {
    getState: () => state,
    subscribe: (l: () => void) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    set(next: PersistedLibrary) {
      state = next;
      listeners.forEach(l => l());
    },
    get state() {
      return state;
    },
  };
}

const manifestOf = (fs: FakeFs) => JSON.parse(fs.files.get('manifest.json')!);

describe('pickPersistedLibrary', () => {
  it('strips transient and legacy fields', () => {
    const picked = pickPersistedLibrary({
      ...makeLibrary(),
      isScanning: true,
      scanProgress: { phase: 'scanning' },
      scanList: ['x'],
    });
    expect(Object.keys(picked).sort()).toEqual(['audiobooks', 'mediaLibrary', 'mediaOverrides', 'movies', 'thumbnails']);
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
  });
});

describe('LibraryStore', () => {
  let fs: FakeFs;
  let appStateHandler: ((state: string) => void) | undefined;
  let appStateRemove: jest.Mock;

  beforeEach(() => {
    jest.useFakeTimers();
    fs = new FakeFs();
    appStateRemove = jest.fn();
    appStateHandler = undefined;
    jest.spyOn(AppState, 'addEventListener').mockImplementation(((_: string, handler: (s: string) => void) => {
      appStateHandler = handler;
      return { remove: appStateRemove };
    }) as any);
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  /** A store with `makeLibrary()` already written, plus a source bound to it. */
  async function started() {
    const store = new LibraryStore(fs);
    const lib = makeLibrary();
    await store.writeAll(lib);
    const source = makeSource(lib);
    const stop = store.startAutoSave(source);
    fs.clearOps();
    return { store, source, stop, lib };
  }

  describe('load / writeAll', () => {
    it('load() on an empty fs returns null', async () => {
      expect(await new LibraryStore(fs).load()).toBeNull();
    });

    it('round-trips through a fresh store on the same fs', async () => {
      const lib = makeLibrary();
      await new LibraryStore(fs).writeAll(lib);
      const loaded = await new LibraryStore(fs).load();
      expect(loaded).toEqual(lib);
      expect(Object.keys(loaded!.mediaLibrary)).toEqual(Object.keys(lib.mediaLibrary));
    });

    it('round-trips an empty library', async () => {
      await new LibraryStore(fs).writeAll(EMPTY_PERSISTED_LIBRARY);
      expect(await new LibraryStore(fs).load()).toEqual(EMPTY_PERSISTED_LIBRARY);
    });

    it('never uses raw show names in shard paths', async () => {
      await new LibraryStore(fs).writeAll(makeLibrary());
      for (const file of Object.values<string>(manifestOf(fs).shows)) {
        expect(file).toMatch(/^shows\/[0-9a-f]{8}\.json$/);
      }
    });

    it('writes the manifest last', async () => {
      await new LibraryStore(fs).writeAll(makeLibrary());
      const writes = fs.paths('write');
      expect(writes[writes.length - 1]).toBe('manifest.json');
      expect(writes.filter(p => p === 'manifest.json')).toHaveLength(1);
      expect(writes).toHaveLength(4 + 4 + 1);
    });

    it('removes orphaned shard files after writeAll and after load', async () => {
      fs.files.set('shows/deadbeef.json', '{}');
      const store = new LibraryStore(fs);
      await store.writeAll(makeLibrary());
      expect(fs.files.has('shows/deadbeef.json')).toBe(false);

      fs.files.set('shows/cafebabe.json.tmp', 'partial');
      await new LibraryStore(fs).load();
      expect(fs.files.has('shows/cafebabe.json.tmp')).toBe(false);
      expect(fs.files.size).toBe(1 + 4 + 4);
    });

    it('treats a missing top-level file as empty and recreates it on the next save', async () => {
      const lib = makeLibrary();
      await new LibraryStore(fs).writeAll(lib);
      fs.files.delete('movies.json');

      const store = new LibraryStore(fs);
      const loaded = (await store.load())!;
      expect(loaded.movies).toEqual([]);
      const stop = store.startAutoSave(makeSource(loaded));
      fs.clearOps();
      await store.flush();
      expect(fs.paths('write')).toEqual(['movies.json']);
      stop();
    });

    it('throws when a manifest-listed shard is missing', async () => {
      await new LibraryStore(fs).writeAll(makeLibrary());
      fs.files.delete(manifestOf(fs).shows['Bluey']);
      await expect(new LibraryStore(fs).load()).rejects.toThrow(/missing/);
    });

    it('throws when a shard is corrupt', async () => {
      await new LibraryStore(fs).writeAll(makeLibrary());
      fs.files.set(manifestOf(fs).shows['Bluey'], '{"name": "Blu');
      await expect(new LibraryStore(fs).load()).rejects.toThrow(/not valid JSON/);
    });

    it('throws when a shard holds a different show than the manifest says', async () => {
      await new LibraryStore(fs).writeAll(makeLibrary());
      const { shows } = manifestOf(fs);
      fs.files.set(shows['Bluey'], fs.files.get(shows['Party 🎉🍿'])!);
      await expect(new LibraryStore(fs).load()).rejects.toThrow(/does not contain/);
    });

    it('throws when a top-level file is corrupt', async () => {
      await new LibraryStore(fs).writeAll(makeLibrary());
      fs.files.set('overrides.json', 'nope');
      await expect(new LibraryStore(fs).load()).rejects.toThrow();
    });

    it('throws on a corrupt manifest', async () => {
      fs.files.set('manifest.json', '{');
      await expect(new LibraryStore(fs).load()).rejects.toThrow();
    });

    it('throws when the manifest version is newer than supported, without deleting anything', async () => {
      await new LibraryStore(fs).writeAll(makeLibrary());
      const manifest = manifestOf(fs);
      fs.files.set('manifest.json', JSON.stringify({ ...manifest, version: LIBRARY_STORE_VERSION + 1 }));
      fs.clearOps();
      await expect(new LibraryStore(fs).load()).rejects.toThrow(/newer than supported/);
      expect(fs.ops).toEqual([]);
    });

    it('does not delete orphans when load fails', async () => {
      await new LibraryStore(fs).writeAll(makeLibrary());
      fs.files.set('shows/deadbeef.json', '{}');
      fs.files.delete(manifestOf(fs).shows['Bluey']);
      fs.clearOps();
      await expect(new LibraryStore(fs).load()).rejects.toThrow();
      expect(fs.paths('remove')).toEqual([]);
    });

    it('startAutoSave requires a baseline', () => {
      expect(() => new LibraryStore(fs).startAutoSave(makeSource(makeLibrary()))).toThrow();
    });
  });

  describe('incremental save', () => {
    it('writes nothing when state is unchanged', async () => {
      const { store, source, stop } = await started();
      source.set({ ...source.state }); // new wrapper object, same field references
      await jest.advanceTimersByTimeAsync(AUTOSAVE_THROTTLE_MS * 3);
      await store.flush();
      expect(fs.ops).toEqual([]);
      stop();
    });

    it('writes only the changed show shard', async () => {
      const { store, source, lib, stop } = await started();
      const file = manifestOf(fs).shows['Bluey'];
      source.set({
        ...lib,
        mediaLibrary: { ...lib.mediaLibrary, Bluey: show('Bluey', { year: 1999 }) },
      });
      await store.flush();
      expect(fs.ops).toEqual([{ op: 'write', path: file }]);
      expect(JSON.parse(fs.files.get(file)!).show.year).toBe(1999);
      stop();
    });

    it('writes only a top-level file whose reference changed', async () => {
      const { store, source, lib, stop } = await started();
      source.set({ ...lib, thumbnails: { ...lib.thumbnails, 'content://m/b.mkv': 'file:///t/b.jpg' } });
      await store.flush();
      expect(fs.ops).toEqual([{ op: 'write', path: 'thumbnails.json' }]);
      stop();
    });

    it('writes a new show shard before the manifest', async () => {
      const { store, source, lib, stop } = await started();
      source.set({ ...lib, mediaLibrary: { ...lib.mediaLibrary, 'New Show': show('New Show') } });
      await store.flush();
      const writes = fs.paths('write');
      expect(writes).toHaveLength(2);
      expect(writes[0]).toMatch(/^shows\//);
      expect(writes[1]).toBe('manifest.json');
      expect(manifestOf(fs).shows['New Show']).toBe(writes[0]);
      expect(fs.paths('remove')).toEqual([]);
      stop();
    });

    it('writes the manifest before removing a deleted show shard', async () => {
      const { store, source, lib, stop } = await started();
      const file = manifestOf(fs).shows['Bluey'];
      const { Bluey, ...rest } = lib.mediaLibrary;
      source.set({ ...lib, mediaLibrary: rest });
      await store.flush();
      expect(fs.ops).toEqual([
        { op: 'write', path: 'manifest.json' },
        { op: 'remove', path: file },
      ]);
      expect(manifestOf(fs).shows).not.toHaveProperty('Bluey');
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
      expect(await new LibraryStore(fs).load()).toEqual(next);
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
      expect(fs.ops).toEqual([]);

      await jest.advanceTimersByTimeAsync(100);
      expect(fs.paths('write')).toHaveLength(1);
      expect(JSON.parse(fs.files.get(manifestOf(fs).shows['Bluey'])!).show.year).toBe(3);

      await jest.advanceTimersByTimeAsync(AUTOSAVE_THROTTLE_MS * 3);
      expect(fs.paths('write')).toHaveLength(1);
      stop();
    });

    it('flush() writes immediately and cancels the pending timer', async () => {
      const { store, source, lib, stop } = await started();
      source.set({ ...lib, movies: [] });
      expect(fs.ops).toEqual([]);
      await store.flush();
      expect(fs.paths('write')).toEqual(['movies.json']);
      await jest.advanceTimersByTimeAsync(AUTOSAVE_THROTTLE_MS * 3);
      expect(fs.paths('write')).toEqual(['movies.json']);
      stop();
    });

    it('flushes when the app goes to the background', async () => {
      const { source, lib, stop } = await started();
      source.set({ ...lib, movies: [] });
      appStateHandler!('background');
      await jest.advanceTimersByTimeAsync(0);
      expect(fs.paths('write')).toEqual(['movies.json']);
      stop();
    });

    it('stop() unsubscribes, cancels the timer and removes the AppState listener', async () => {
      const { source, lib, stop } = await started();
      source.set({ ...lib, movies: [] });
      stop();
      await jest.advanceTimersByTimeAsync(AUTOSAVE_THROTTLE_MS * 3);
      expect(fs.ops).toEqual([]);
      expect(appStateRemove).toHaveBeenCalled();
    });

    it('never runs two saves concurrently, and picks up changes made mid-save', async () => {
      const { store, source, lib, stop } = await started();
      let release!: () => void;
      const gate = new Promise<void>(r => (release = r));
      let active = 0;
      let maxActive = 0;
      const realWrite = fs.write.bind(fs);
      fs.write = async (path, contents) => {
        active++;
        maxActive = Math.max(maxActive, active);
        await gate;
        await realWrite(path, contents);
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
      expect(fs.files.get('thumbnails.json')).toBe('{}');
      expect(fs.files.get('movies.json')).toBe('[]');
      stop();
    });
  });

  describe('failure handling', () => {
    it('retries a failed shard write on the next save without repeating successful writes', async () => {
      const { store, source, lib, stop } = await started();
      const blueyFile = manifestOf(fs).shows['Bluey'];
      fs.failWrite = p => p === blueyFile;

      source.set({
        ...lib,
        mediaLibrary: { ...lib.mediaLibrary, Bluey: show('Bluey', { year: 1 }), 'Party 🎉🍿': show('Party 🎉🍿', { year: 2 }) },
        movies: [],
      });
      await expect(store.flush()).resolves.toBeUndefined();
      expect(fs.paths('write').sort()).toEqual([manifestOf(fs).shows['Party 🎉🍿'], 'movies.json'].sort());

      fs.failWrite = () => false;
      fs.clearOps();
      await store.flush();
      expect(fs.ops).toEqual([{ op: 'write', path: blueyFile }]);
      expect(JSON.parse(fs.files.get(blueyFile)!).show.year).toBe(1);
      stop();
    });

    it('does not publish a manifest that references a shard which failed to write', async () => {
      const { store, source, lib, stop } = await started();
      fs.failWrite = p => p.startsWith('shows/');
      source.set({ ...lib, mediaLibrary: { ...lib.mediaLibrary, 'New Show': show('New Show') } });
      await store.flush();
      expect(manifestOf(fs).shows).not.toHaveProperty('New Show');
      expect(fs.paths('write')).toEqual([]);

      fs.failWrite = () => false;
      await store.flush();
      const writes = fs.paths('write');
      expect(writes[writes.length - 1]).toBe('manifest.json');
      expect(manifestOf(fs).shows).toHaveProperty('New Show');
      stop();
    });

    it('retries a failed manifest write and only removes shards afterwards', async () => {
      const { store, source, lib, stop } = await started();
      const file = manifestOf(fs).shows['Bluey'];
      const { Bluey, ...rest } = lib.mediaLibrary;
      fs.failWrite = p => p === 'manifest.json';
      source.set({ ...lib, mediaLibrary: rest });
      await store.flush();
      expect(fs.paths('remove')).toEqual([]);
      expect(fs.files.has(file)).toBe(true);

      fs.failWrite = () => false;
      await store.flush();
      expect(fs.ops).toEqual([
        { op: 'write', path: 'manifest.json' },
        { op: 'remove', path: file },
      ]);
      stop();
    });

    it('does not throw out of the autosave timer when a write fails', async () => {
      const { source, lib, stop } = await started();
      fs.failWrite = () => true;
      source.set({ ...lib, movies: [] });
      await expect(jest.advanceTimersByTimeAsync(AUTOSAVE_THROTTLE_MS)).resolves.toBeUndefined();
      stop();
    });
  });

  describe('shard file naming', () => {
    it('fnv1a32Hex is deterministic and 8 hex chars', () => {
      expect(fnv1a32Hex('Bluey')).toBe(fnv1a32Hex('Bluey'));
      expect(fnv1a32Hex('Bluey')).toMatch(/^[0-9a-f]{8}$/);
      expect(fnv1a32Hex('')).toBe('811c9dc5');
      expect(fnv1a32Hex('a')).toBe('e40c292c');
    });

    it('gives colliding names distinct, stable files', async () => {
      const store = new LibraryStore(fs, () => 'aaaaaaaa');
      const lib = makeLibrary();
      await store.writeAll(lib);
      const shows: Record<string, string> = manifestOf(fs).shows;
      expect(new Set(Object.values(shows)).size).toBe(Object.keys(lib.mediaLibrary).length);
      expect(Object.values(shows)).toContain('shows/aaaaaaaa.json');
      expect(await new LibraryStore(fs).load()).toEqual(lib);

      // Adding and removing shows keeps surviving names on their existing files.
      const source = makeSource(lib);
      const stop = store.startAutoSave(source);
      const { Bluey, ...rest } = lib.mediaLibrary;
      source.set({ ...lib, mediaLibrary: { Aardvark: show('Aardvark'), ...rest } });
      await store.flush();
      const after: Record<string, string> = manifestOf(fs).shows;
      for (const name of Object.keys(rest)) expect(after[name]).toBe(shows[name]);
      expect(new Set(Object.values(after)).size).toBe(Object.keys(after).length);
      expect(await new LibraryStore(fs).load()).toEqual(source.state);
      stop();
    });

    it('does not hand a still-referenced file to a different show', async () => {
      const store = new LibraryStore(fs, () => 'bbbbbbbb');
      const lib: PersistedLibrary = { ...EMPTY_PERSISTED_LIBRARY, mediaLibrary: { One: show('One') } };
      await store.writeAll(lib);
      const oneFile = manifestOf(fs).shows['One'];

      const source = makeSource(lib);
      const stop = store.startAutoSave(source);
      // Replace One with Two: Two must not take One's file while the manifest still lists it.
      source.set({ ...lib, mediaLibrary: { Two: show('Two') } });
      await store.flush();
      expect(manifestOf(fs).shows['Two']).not.toBe(oneFile);
      expect(fs.files.has(oneFile)).toBe(false);
      expect(await new LibraryStore(fs).load()).toEqual(source.state);
      stop();
    });
  });
});
