import type { AppStateStatus } from 'react-native';
import {
  EMPTY_PERSISTED_LIBRARY,
  LIBRARY_STORE_VERSION,
  LibraryStore,
  createExpoLibraryDb,
  type AppStateSource,
  type PersistedLibrary,
} from '../LibraryStore';
import { createNodeSqlite, type NodeSqlite } from '@/scripts/__testutils__/nodeSqlite';
import { makeLibrary, makeSource, show } from '@/scripts/__testutils__/libraryFixtures';

// Runs the production SQL (createExpoLibraryDb: schema, upserts, exclusive
// transactions, reads) on a real SQLite via node:sqlite.  The fake-LibraryDb
// suite in LibraryStore.test.ts covers throttling/queueing; this one covers
// what actually lands in the tables.
jest.mock('@/scripts/Logger', () => ({
  logger: { log: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));
jest.mock('expo-sqlite', () => ({ openDatabaseAsync: jest.fn() }));

describe('LibraryStore on SQLite', () => {
  let sqlite: NodeSqlite;
  let appState: AppStateSource;

  beforeEach(() => {
    jest.useFakeTimers();
    sqlite = createNodeSqlite();
    appState = {
      addEventListener: (_type: 'change', _listener: (state: AppStateStatus) => void) => ({ remove: () => {} }),
    };
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  /** A new store (and a new createExpoLibraryDb) over the same underlying database, like an app restart. */
  const newStore = () => new LibraryStore(createExpoLibraryDb('test.db', sqlite.open));

  const showNames = () => sqlite.all<{ name: string }>('SELECT name FROM shows ORDER BY rowid').map(r => r.name);
  const dump = () => ({
    meta: sqlite.all('SELECT key, value FROM meta ORDER BY key'),
    shows: sqlite.all('SELECT rowid, name, json FROM shows ORDER BY rowid'),
    kv: sqlite.all('SELECT key, json FROM kv ORDER BY key'),
  });

  /** Logs every row insert/update/delete from now on, so tests can see exactly which rows a save touched. */
  function watchWrites() {
    sqlite.raw.exec('CREATE TABLE touched (id INTEGER PRIMARY KEY, entry TEXT NOT NULL)');
    for (const [table, keyColumn] of [['shows', 'name'], ['kv', 'key'], ['meta', 'key']]) {
      for (const [op, row] of [['insert', 'NEW'], ['update', 'NEW'], ['delete', 'OLD']]) {
        sqlite.raw.exec(`
          CREATE TRIGGER ${table}_${op} AFTER ${op.toUpperCase()} ON ${table}
          BEGIN INSERT INTO touched (entry) VALUES ('${table}:${op}:' || ${row}.${keyColumn}); END`);
      }
    }
    return () => sqlite.all<{ entry: string }>('SELECT entry FROM touched ORDER BY id').map(r => r.entry);
  }

  /** writeAll + startAutoSave on a fresh store; the returned source is the "Redux store". */
  async function started(lib = makeLibrary()) {
    const store = newStore();
    await store.writeAll(lib);
    const source = makeSource(lib);
    const stop = store.startAutoSave(source, appState);
    return { store, source, stop, lib };
  }

  describe('schema', () => {
    it('creates the tables and is idempotent across opens', async () => {
      const lib = makeLibrary();
      await newStore().writeAll(lib);
      const tables = () => sqlite.all<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").map(r => r.name);
      expect(tables()).toEqual(['kv', 'meta', 'shows']);

      // Re-running the schema (a second open) must neither fail nor wipe data.
      const again = newStore();
      expect(await again.load()).toEqual(lib);
      expect(await again.load()).toEqual(lib);
      expect(tables()).toEqual(['kv', 'meta', 'shows']);
      expect(sqlite.openCount).toBe(2);
    });

    it('opens lazily, once per createExpoLibraryDb', async () => {
      const store = newStore();
      expect(sqlite.openCount).toBe(0);
      await store.load();
      await store.writeAll(makeLibrary());
      await store.load();
      expect(sqlite.openCount).toBe(1);
    });

    it('retries a failed open on the next call', async () => {
      let attempts = 0;
      const store = new LibraryStore(createExpoLibraryDb('test.db', async name => {
        if (++attempts === 1) throw new Error('cannot open');
        return sqlite.open(name);
      }));
      await expect(store.load()).rejects.toThrow(/cannot open/);
      expect(await store.load()).toBeNull();
      expect(attempts).toBe(2);
    });
  });

  describe('load / writeAll', () => {
    it('load() on a fresh database returns null', async () => {
      expect(await newStore().load()).toBeNull();
    });

    it('round-trips through a fresh store on the same database', async () => {
      const lib = makeLibrary();
      await newStore().writeAll(lib);
      const loaded = await newStore().load();
      expect(loaded).toEqual(lib);
      expect(Object.keys(loaded!.mediaLibrary)).toEqual(Object.keys(lib.mediaLibrary));
      expect(sqlite.all('SELECT value FROM meta WHERE key = ?', 'version')).toEqual([{ value: String(LIBRARY_STORE_VERSION) }]);
    });

    it('stores odd show names verbatim as bound parameters', async () => {
      const odd = ['/', 'a/b\\c', `it's "quoted"`, `'`, `"`, "x'); DROP TABLE shows; --", "'; DROP TABLE shows; --", 'Amélie 日本語', 'Party 🎉🍿', '../../etc', 'constructor'];
      const lib: PersistedLibrary = {
        ...EMPTY_PERSISTED_LIBRARY,
        mediaLibrary: Object.fromEntries(odd.map(n => [n, show(n)])),
      };
      await newStore().writeAll(lib);
      expect(showNames()).toEqual(odd);
      expect(await newStore().load()).toEqual(lib);
    });

    it('round-trips movies, audiobooks, overrides and thumbnails as whole documents', async () => {
      const lib = makeLibrary();
      await newStore().writeAll(lib);
      expect(sqlite.all<{ key: string }>('SELECT key FROM kv ORDER BY key').map(r => r.key)).toEqual(['audiobooks', 'mediaOverrides', 'movies', 'thumbnails']);
      const loaded = (await newStore().load())!;
      expect(loaded.movies).toEqual(lib.movies);
      expect(loaded.audiobooks).toEqual(lib.audiobooks);
      expect(loaded.mediaOverrides).toEqual(lib.mediaOverrides);
      expect(loaded.thumbnails).toEqual(lib.thumbnails);
    });

    it('round-trips an empty library', async () => {
      await newStore().writeAll(EMPTY_PERSISTED_LIBRARY);
      expect(showNames()).toEqual([]);
      expect(await newStore().load()).toEqual(EMPTY_PERSISTED_LIBRARY);
    });

    it('writeAll replaces previous contents', async () => {
      await newStore().writeAll(makeLibrary());
      expect(showNames()).toHaveLength(4);
      const next: PersistedLibrary = {
        ...EMPTY_PERSISTED_LIBRARY,
        mediaLibrary: { Bluey: show('Bluey', { year: 1 }), 'New Show': show('New Show') },
      };
      await newStore().writeAll(next);
      expect(showNames()).toEqual(['Bluey', 'New Show']);
      expect(sqlite.all('SELECT json FROM kv WHERE key = ?', 'movies')).toEqual([{ json: '[]' }]);
      expect(await newStore().load()).toEqual(next);
    });

    it('upserting a show keeps its position (rowid) and load order', async () => {
      const { store, source, lib, stop } = await started();
      const order = Object.keys(lib.mediaLibrary);
      const rowidsBefore = dump().shows.map((r: any) => [r.rowid, r.name]);

      source.set({ ...lib, mediaLibrary: { ...lib.mediaLibrary, 'AC/DC: Live': show('AC/DC: Live', { year: 1977 }) } });
      await store.flush();

      expect(dump().shows.map((r: any) => [r.rowid, r.name])).toEqual(rowidsBefore);
      expect(showNames()).toEqual(order);
      const loaded = (await newStore().load())!;
      expect(Object.keys(loaded.mediaLibrary)).toEqual(order);
      expect(loaded.mediaLibrary['AC/DC: Live'].year).toBe(1977);
      stop();
    });
  });

  describe('incremental saves', () => {
    it('updates a changed show, inserts an added one and deletes a removed one', async () => {
      const { store, source, lib, stop } = await started();
      const touched = watchWrites();
      const { 'Amélie 日本語': _removed, ...rest } = lib.mediaLibrary;
      source.set({
        ...lib,
        mediaLibrary: { ...rest, Bluey: show('Bluey', { year: 1999 }), 'New Show': show('New Show') },
      });
      await store.flush();

      expect(touched().sort()).toEqual(['shows:delete:Amélie 日本語', 'shows:insert:New Show', 'shows:update:Bluey']);
      expect(showNames()).toEqual(['Bluey', 'AC/DC: Live', 'Party 🎉🍿', 'New Show']);
      expect(await newStore().load()).toEqual(source.state);
      stop();
    });

    it('touches only the kv rows whose collection changed, and never meta', async () => {
      const { store, source, lib, stop } = await started();
      const touched = watchWrites();
      source.set({ ...lib, thumbnails: { ...lib.thumbnails, 'content://m/b.mkv': 'file:///t/b.jpg' } });
      await store.flush();
      expect(touched()).toEqual(['kv:update:thumbnails']);

      source.set({ ...source.state, movies: [], mediaOverrides: {} });
      await store.flush();
      expect(touched().slice(1).sort()).toEqual(['kv:update:mediaOverrides', 'kv:update:movies']);
      expect(touched().some(e => e.startsWith('meta:'))).toBe(false);
      expect(await newStore().load()).toEqual(source.state);
      stop();
    });

    it('writes nothing when the state is unchanged', async () => {
      const { store, source, stop } = await started();
      const touched = watchWrites();
      source.set({ ...source.state });
      await store.flush();
      expect(touched()).toEqual([]);
      stop();
    });

    it('recreates a missing kv row on the next save', async () => {
      await newStore().writeAll(makeLibrary());
      sqlite.raw.exec("DELETE FROM kv WHERE key = 'movies'");

      const store = newStore();
      const loaded = (await store.load())!;
      expect(loaded.movies).toEqual([]);
      const stop = store.startAutoSave(makeSource(loaded), appState);
      const touched = watchWrites();
      await store.flush();
      expect(touched()).toEqual(['kv:insert:movies']);
      stop();
    });
  });

  describe('transaction rollback', () => {
    // Run 1 is DELETE FROM shows, 2-5 the shows, 6-9 the kv rows, 10 the version marker.
    it.each([[3, 'mid-batch'], [10, 'on the version marker']])('a failing writeAll statement (run %i, %s) leaves the store uninitialised', async n => {
      const store = newStore();
      sqlite.failNthRun(n);
      await expect(store.writeAll(makeLibrary())).rejects.toThrow(/injected/);

      expect(dump()).toEqual({ meta: [], shows: [], kv: [] });
      expect(await newStore().load()).toBeNull();
      expect(() => store.startAutoSave(makeSource(makeLibrary()), appState)).toThrow();

      // The connection is usable again and a retry succeeds.
      sqlite.failRunWhen(null);
      const lib = makeLibrary();
      await store.writeAll(lib);
      expect(await newStore().load()).toEqual(lib);
    });

    it('a failing writeAll over existing data keeps the previous contents, including the rows it had cleared', async () => {
      const old = makeLibrary();
      await newStore().writeAll(old);
      const before = dump();

      sqlite.failNthRun(4); // after the DELETE and the first inserts
      await expect(newStore().writeAll({ ...EMPTY_PERSISTED_LIBRARY, mediaLibrary: { Other: show('Other'), Another: show('Another'), Third: show('Third') } })).rejects.toThrow(/injected/);

      expect(dump()).toEqual(before);
      expect(await newStore().load()).toEqual(old);
    });

    it('a failing incremental save changes nothing, and the next save retries the whole diff', async () => {
      const { store, source, lib, stop } = await started();
      const before = dump();
      const { 'Bluey': _removed, ...rest } = lib.mediaLibrary;
      source.set({
        ...lib,
        mediaLibrary: { ...rest, 'AC/DC: Live': show('AC/DC: Live', { year: 1 }), 'New Show': show('New Show') },
        movies: [],
      });

      // Order within the batch: delete Bluey (1), upsert AC/DC (2), insert New Show (3), movies kv (4).
      sqlite.failNthRun(3);
      await expect(store.flush()).resolves.toBeUndefined();
      expect(dump()).toEqual(before);

      sqlite.failRunWhen(null);
      const touched = watchWrites();
      await store.flush();
      expect(touched().sort()).toEqual(['kv:update:movies', 'shows:delete:Bluey', 'shows:insert:New Show', 'shows:update:AC/DC: Live']);
      expect(await newStore().load()).toEqual(source.state);
      stop();
    });
  });

  describe('load validation against real rows', () => {
    it('throws on a corrupt show row', async () => {
      await newStore().writeAll(makeLibrary());
      sqlite.raw.exec(`UPDATE shows SET json = '{"title": "Blu' WHERE name = 'Bluey'`);
      await expect(newStore().load()).rejects.toThrow(/Show "Bluey" is not valid JSON/);
    });

    it('throws on a show row that is not an object', async () => {
      await newStore().writeAll(makeLibrary());
      sqlite.raw.exec(`UPDATE shows SET json = '[1]' WHERE name = 'Bluey'`);
      await expect(newStore().load()).rejects.toThrow(/unexpected shape/);
    });

    it('throws on a corrupt or wrongly shaped kv row', async () => {
      await newStore().writeAll(makeLibrary());
      sqlite.raw.exec(`UPDATE kv SET json = 'nope' WHERE key = 'mediaOverrides'`);
      await expect(newStore().load()).rejects.toThrow(/not valid JSON/);
      sqlite.raw.exec(`UPDATE kv SET json = '{}' WHERE key = 'mediaOverrides'`);
      sqlite.raw.exec(`UPDATE kv SET json = '{}' WHERE key = 'movies'`);
      await expect(newStore().load()).rejects.toThrow(/unexpected shape/);
    });

    it('throws on an invalid or newer version row, without writing anything', async () => {
      await newStore().writeAll(makeLibrary());
      sqlite.raw.exec(`UPDATE meta SET value = 'abc' WHERE key = 'version'`);
      await expect(newStore().load()).rejects.toThrow(/invalid version/);

      sqlite.raw.exec(`UPDATE meta SET value = '${LIBRARY_STORE_VERSION + 1}' WHERE key = 'version'`);
      const before = dump();
      await expect(newStore().load()).rejects.toThrow(/newer than supported/);
      expect(dump()).toEqual(before);
    });
  });
});
