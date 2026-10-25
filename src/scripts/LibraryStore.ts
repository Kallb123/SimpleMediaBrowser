import { AppState, type AppStateStatus } from 'react-native';
import { openDatabaseAsync } from 'expo-sqlite';
import type { IMediaLibrary, IMediaShow, IMediaAudiobook, IMediaOverride, IListenProgress } from '@/store/libraryReducer';
import type { IMediaObject } from '@/scripts/libraryUtils';
import { logger } from '@/scripts/Logger';

const TAG = 'LibraryStore';

/** Bump when the database layout changes incompatibly. Newer-than-supported stores refuse to load. */
export const LIBRARY_STORE_VERSION = 1;

/** Minimum gap between autosaves; changes arriving inside the window coalesce into one save. */
export const AUTOSAVE_THROTTLE_MS = 1000;

/** The persisted part of libraryReducer (transient isScanning/scanProgress and legacy scanList are never stored). */
export interface PersistedLibrary {
    mediaLibrary: IMediaLibrary;
    movies: IMediaObject[];
    audiobooks: IMediaAudiobook[];
    mediaOverrides: { [key: string]: IMediaOverride };
    thumbnails: { [path: string]: string };
    /** Watched/listened files: file `parsedPath` → timestamp it was marked (see `libraryReducer`). */
    watched: { [key: string]: number };
    /** In-app audiobook resume points: `folderKey` → progress (see `libraryReducer`). */
    listenProgress: { [folderKey: string]: IListenProgress };
}

export const EMPTY_PERSISTED_LIBRARY: PersistedLibrary = Object.freeze({
    mediaLibrary: Object.freeze({}),
    movies: Object.freeze([]) as unknown as IMediaObject[],
    audiobooks: Object.freeze([]) as unknown as IMediaAudiobook[],
    mediaOverrides: Object.freeze({}),
    thumbnails: Object.freeze({}),
    watched: Object.freeze({}),
    listenProgress: Object.freeze({}),
});

/**
 * Picks the persisted fields from a libraryReducer-shaped object (also legacy
 * persisted blobs, which may be missing fields or carry extras such as
 * `isScanning` / `scanProgress` / `scanList`).  Fields are returned by
 * reference (no cloning) so reference-based change detection keeps working.
 */
export function pickPersistedLibrary(state: Partial<Record<string, unknown>> | null | undefined): PersistedLibrary {
    const s = state ?? {};
    return {
        mediaLibrary: (s.mediaLibrary as IMediaLibrary | undefined) ?? EMPTY_PERSISTED_LIBRARY.mediaLibrary,
        movies: (s.movies as IMediaObject[] | undefined) ?? EMPTY_PERSISTED_LIBRARY.movies,
        audiobooks: (s.audiobooks as IMediaAudiobook[] | undefined) ?? EMPTY_PERSISTED_LIBRARY.audiobooks,
        mediaOverrides: (s.mediaOverrides as PersistedLibrary['mediaOverrides'] | undefined) ?? EMPTY_PERSISTED_LIBRARY.mediaOverrides,
        thumbnails: (s.thumbnails as PersistedLibrary['thumbnails'] | undefined) ?? EMPTY_PERSISTED_LIBRARY.thumbnails,
        watched: (s.watched as PersistedLibrary['watched'] | undefined) ?? EMPTY_PERSISTED_LIBRARY.watched,
        listenProgress: (s.listenProgress as PersistedLibrary['listenProgress'] | undefined) ?? EMPTY_PERSISTED_LIBRARY.listenProgress,
    };
}

// ── Database abstraction ──────────────────────────────────────────────────────

/** Whole-collection keys stored in the `kv` table, one JSON document each. */
const KV_KEYS = ['movies', 'audiobooks', 'mediaOverrides', 'thumbnails', 'watched', 'listenProgress'] as const;

/**
 * kv keys added after the first release of this layout. Stores written by an older
 * app lack them, which is expected (not worth a warning) and needs no version bump:
 * the row is simply created on the next save, and older apps ignore rows they don't know.
 */
const KV_KEYS_ADDED_LATER: ReadonlySet<string> = new Set(['watched', 'listenProgress']);

/** Everything {@link LibraryDb.readAll} returns: raw rows, parsed and validated by {@link LibraryStore.load}. */
export interface LibraryDbContents {
    /** Value of the `meta` 'version' row. */
    version: string;
    /** One row per show, in insertion order. */
    shows: { name: string; json: string }[];
    kv: { key: string; json: string }[];
}

/** One atomic unit of writes; see {@link LibraryDb.write}. */
export interface LibraryBatch {
    /** Delete every show row first (full replace), then apply the rest. */
    clearShows?: boolean;
    putShows: { name: string; json: string }[];
    deleteShows: string[];
    putKv: { key: string; json: string }[];
    /** Stored as the `meta` 'version' row; its presence marks the store as initialised. */
    version?: string;
}

/**
 * Minimal database abstraction so the store is testable with an in-memory
 * fake (there is no native SQLite under Jest).
 */
export interface LibraryDb {
    /** Resolves null when the store is not initialised (no 'version' row). */
    readAll(): Promise<LibraryDbContents | null>;
    /** Applies the whole batch in ONE transaction: everything commits or nothing does. */
    write(batch: LibraryBatch): Promise<void>;
}

const SCHEMA = `
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS meta  (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS shows (name TEXT PRIMARY KEY NOT NULL, json TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS kv    (key TEXT PRIMARY KEY NOT NULL, json TEXT NOT NULL);
`;

// ON CONFLICT ... DO UPDATE (unlike INSERT OR REPLACE) keeps a show's rowid, so its position in readAll() is stable.
const UPSERT_SHOW = 'INSERT INTO shows (name, json) VALUES (?, ?) ON CONFLICT(name) DO UPDATE SET json = excluded.json';
const UPSERT_KV = 'INSERT INTO kv (key, json) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET json = excluded.json';
const UPSERT_META = 'INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value';

/** The statement-running part of expo-sqlite's `SQLiteDatabase` that {@link createExpoLibraryDb} relies on. */
export interface SqliteTransaction {
    runAsync(sql: string): Promise<unknown>;
    runAsync(sql: string, params: (string | number | null)[]): Promise<unknown>;
}

/**
 * The subset of expo-sqlite's `SQLiteDatabase` that {@link createExpoLibraryDb}
 * uses, so the production SQL can also run on another driver (Jest runs it on
 * `node:sqlite`; see `__testutils__/nodeSqlite.ts`).
 */
export interface SqliteDatabase {
    execAsync(sql: string): Promise<void>;
    getFirstAsync<T>(sql: string): Promise<T | null>;
    getAllAsync<T>(sql: string): Promise<T[]>;
    withExclusiveTransactionAsync(task: (txn: SqliteTransaction) => Promise<void>): Promise<void>;
}

/**
 * {@link LibraryDb} backed by expo-sqlite (`library.db` in its default
 * directory).  The database opens lazily on first use, and a failed open is
 * retried on the next call.  `openDatabase` exists for tests; production uses
 * expo-sqlite's `openDatabaseAsync`.
 *
 * Batches run in `withExclusiveTransactionAsync`, which uses a dedicated
 * connection: all statements must go through the `txn` it passes in, and an
 * error rolls everything back.  Rows are read through expo-sqlite's bundled
 * sqlite3 (JNI), not Android's CursorWindow, so there is no ~2 MB row limit.
 */
export function createExpoLibraryDb(
    name: string = 'library.db',
    openDatabase: (name: string) => Promise<SqliteDatabase> = openDatabaseAsync,
): LibraryDb {
    let opening: Promise<SqliteDatabase> | null = null;
    const open = () => {
        opening ??= (async () => {
            const db = await openDatabase(name);
            await db.execAsync(SCHEMA);
            return db;
        })().catch(e => {
            opening = null;
            throw e;
        });
        return opening;
    };

    return {
        async readAll() {
            const db = await open();
            const row = await db.getFirstAsync<{ value: string }>("SELECT value FROM meta WHERE key = 'version'");
            if (!row) return null;
            return {
                version: row.value,
                shows: await db.getAllAsync<{ name: string; json: string }>('SELECT name, json FROM shows ORDER BY rowid'),
                kv: await db.getAllAsync<{ key: string; json: string }>('SELECT key, json FROM kv'),
            };
        },

        async write(batch) {
            const db = await open();
            await db.withExclusiveTransactionAsync(async txn => {
                if (batch.clearShows) await txn.runAsync('DELETE FROM shows');
                for (const name of batch.deleteShows) await txn.runAsync('DELETE FROM shows WHERE name = ?', [name]);
                for (const { name, json } of batch.putShows) await txn.runAsync(UPSERT_SHOW, [name, json]);
                for (const { key, json } of batch.putKv) await txn.runAsync(UPSERT_KV, [key, json]);
                if (batch.version !== undefined) await txn.runAsync(UPSERT_META, ['version', batch.version]);
            });
        },
    };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * What the database is known to hold, expressed as the references that were
 * last written.  `undefined` means "not stored yet / unknown", so it always
 * compares unequal to a real value and gets written.
 */
interface Baseline {
    /** The mediaLibrary object last fully persisted (fast path: identical => no show changed). */
    library: IMediaLibrary | undefined;
    movies: IMediaObject[] | undefined;
    audiobooks: IMediaAudiobook[] | undefined;
    mediaOverrides: PersistedLibrary['mediaOverrides'] | undefined;
    thumbnails: PersistedLibrary['thumbnails'] | undefined;
    watched: PersistedLibrary['watched'] | undefined;
    listenProgress: PersistedLibrary['listenProgress'] | undefined;
    /** Show name → show object last written to its row. */
    showRefs: Map<string, IMediaShow>;
}

type AutoSaveSource = { getState(): PersistedLibrary; subscribe(listener: () => void): () => void };

/** The part of react-native's `AppState` the store uses; injectable for tests. */
export type AppStateSource = {
    addEventListener(type: 'change', listener: (state: AppStateStatus) => void): { remove(): void };
};

function parseJson<T>(what: string, text: string): T {
    try {
        return JSON.parse(text) as T;
    } catch (e) {
        throw new Error(`${what} is not valid JSON: ${e instanceof Error ? e.message : String(e)}`);
    }
}

const isRecord = (v: unknown): v is object => typeof v === 'object' && v !== null && !Array.isArray(v);

const baselineOf = (lib: PersistedLibrary): Baseline => ({
    library: lib.mediaLibrary,
    movies: lib.movies,
    audiobooks: lib.audiobooks,
    mediaOverrides: lib.mediaOverrides,
    thumbnails: lib.thumbnails,
    watched: lib.watched,
    listenProgress: lib.listenProgress,
    showRefs: new Map(Object.entries(lib.mediaLibrary)),
});

const summarize = (lib: PersistedLibrary) =>
    `${Object.keys(lib.mediaLibrary).length} show(s), ${lib.movies.length} movie(s), ${lib.audiobooks.length} audiobook(s)`;

// ── Store ─────────────────────────────────────────────────────────────────────

/**
 * Persists the media library in a SQLite database (one row per show plus one
 * JSON document per whole-collection), replacing the single `persist:root`
 * AsyncStorage entry (which Android reads through a ~2 MB CursorWindow).
 * See ARCHITECTURE.md §5.
 *
 * Every write is one transaction, so a crash or failure leaves the previous
 * state intact.  Saves are incremental: Immer keeps unchanged shows
 * referentially identical, so only rows whose object reference changed are
 * rewritten.
 */
export class LibraryStore {
    private static _instance: LibraryStore | null = null;

    private _baseline: Baseline | null = null;
    private _source: AutoSaveSource | null = null;
    private _timer: ReturnType<typeof setTimeout> | null = null;
    /** Tail of the save queue: saves never overlap. */
    private _queue: Promise<unknown> = Promise.resolve();

    static getInstance(): LibraryStore {
        if (!LibraryStore._instance) {
            LibraryStore._instance = new LibraryStore(createExpoLibraryDb());
        }
        return LibraryStore._instance;
    }

    constructor(private readonly db: LibraryDb) {}

    // ── Load ──────────────────────────────────────────────────────────────────

    /**
     * Resolves null when the store isn't initialised yet.  Throws if it is but
     * can't be read or parsed, or its version is newer than supported; callers
     * must then NOT autosave (the data may still be recoverable).
     */
    async load(): Promise<PersistedLibrary | null> {
        const started = Date.now();
        const contents = await this.db.readAll();
        if (contents === null) return null;

        const version = Number(contents.version);
        if (!Number.isInteger(version) || version < 1) {
            throw new Error(`Library store has an invalid version "${contents.version}"`);
        }
        if (version > LIBRARY_STORE_VERSION) {
            throw new Error(`Library store version ${version} is newer than supported (${LIBRARY_STORE_VERSION})`);
        }

        const mediaLibrary: IMediaLibrary = {};
        for (const { name, json } of contents.shows) {
            const show = parseJson<IMediaShow>(`Show "${name}"`, json);
            if (!isRecord(show)) throw new Error(`Show "${name}" has an unexpected shape`);
            mediaLibrary[name] = show;
        }

        const lib: PersistedLibrary = {
            mediaLibrary,
            movies: [],
            audiobooks: [],
            mediaOverrides: {},
            thumbnails: {},
            watched: {},
            listenProgress: {},
        };
        const baseline = baselineOf(lib);
        // A missing key stays "unwritten" in the baseline so the next save recreates it.
        baseline.movies = baseline.audiobooks = baseline.mediaOverrides = baseline.thumbnails = baseline.watched = baseline.listenProgress = undefined;
        for (const key of KV_KEYS) {
            const row = contents.kv.find(r => r.key === key);
            if (!row) {
                if (KV_KEYS_ADDED_LATER.has(key)) logger.log(TAG, `"${key}" is not stored yet; treating as empty`);
                else logger.warn(TAG, `"${key}" is missing; treating as empty`);
                continue;
            }
            const value = parseJson<unknown>(`"${key}"`, row.json);
            const shapeOk = Array.isArray(lib[key]) ? Array.isArray(value) : isRecord(value);
            if (!shapeOk) {
                throw new Error(`"${key}" has an unexpected shape`);
            }
            (lib as any)[key] = value;
            (baseline as any)[key] = value;
        }
        this._baseline = baseline;

        logger.log(TAG, `Loaded ${summarize(lib)} in ${Date.now() - started} ms`);
        return lib;
    }

    // ── Full write ────────────────────────────────────────────────────────────

    /**
     * Writes the complete library (migration / first save), replacing any
     * existing contents, and marks the store initialised — all in one
     * transaction, so "initialised" is never visible with partial data.
     * Rejects if the write fails.  Records what was written as the baseline
     * for incremental saves (only once committed).
     */
    writeAll(lib: PersistedLibrary): Promise<void> {
        return this.enqueue(async () => {
            const started = Date.now();
            await this.db.write({
                clearShows: true,
                putShows: Object.keys(lib.mediaLibrary).map(name => ({ name, json: JSON.stringify(lib.mediaLibrary[name]) })),
                deleteShows: [],
                putKv: KV_KEYS.map(key => ({ key, json: JSON.stringify(lib[key]) })),
                version: String(LIBRARY_STORE_VERSION),
            });
            this._baseline = baselineOf(lib);
            logger.log(TAG, `Wrote full library: ${summarize(lib)} in ${Date.now() - started} ms`);
        });
    }

    // ── Incremental save ──────────────────────────────────────────────────────

    /**
     * Begins incremental autosave.  Only valid after load() returned data or
     * writeAll() completed (it needs the baseline).  Throttled; also flushes
     * when the app goes to the background (`appState` is injectable for tests).
     * Returns a stop function.
     */
    startAutoSave(source: AutoSaveSource, appState: AppStateSource = AppState): () => void {
        if (!this._baseline) {
            throw new Error('LibraryStore.startAutoSave requires load() to return data or writeAll() to complete first');
        }
        this._source = source;

        const onChange = () => {
            if (this._timer || !this.hasChanges(source.getState())) return;
            this._timer = setTimeout(() => {
                this._timer = null;
                void this.enqueue(() => this.saveChanges()).catch(() => { /* already logged */ });
            }, AUTOSAVE_THROTTLE_MS);
        };
        const unsubscribe = source.subscribe(onChange);
        const appStateSub = appState.addEventListener('change', state => {
            if (state === 'background' || state === 'inactive') void this.flush();
        });

        // Pick up anything that changed between load()/writeAll() and now.
        onChange();

        return () => {
            unsubscribe();
            appStateSub.remove();
            if (this._timer) {
                clearTimeout(this._timer);
                this._timer = null;
            }
        };
    }

    /** Writes any pending changes now; resolves when written. Never rejects (failures are logged and retried next save). */
    async flush(): Promise<void> {
        if (this._timer) {
            clearTimeout(this._timer);
            this._timer = null;
        }
        try {
            await this.enqueue(() => this.saveChanges());
        } catch {
            // already logged in saveChanges
        }
    }

    /** Runs `task` after every previously queued task has finished, so saves never overlap. */
    private enqueue<T>(task: () => Promise<T>): Promise<T> {
        const run = this._queue.then(task);
        this._queue = run.catch(() => undefined);
        return run;
    }

    /** Cheap check used on every store change. */
    private hasChanges(lib: PersistedLibrary): boolean {
        const b = this._baseline;
        if (!b) return false;
        return lib.mediaLibrary !== b.library
            || lib.movies !== b.movies
            || lib.audiobooks !== b.audiobooks
            || lib.mediaOverrides !== b.mediaOverrides
            || lib.thumbnails !== b.thumbnails
            || lib.watched !== b.watched
            || lib.listenProgress !== b.listenProgress;
    }

    /**
     * One save pass: diffs the state against the baseline and writes the
     * difference as a single transaction.  The baseline only advances once it
     * commits; on failure it is left alone, so the next pass retries everything.
     */
    private async saveChanges(): Promise<void> {
        const source = this._source;
        const b = this._baseline;
        if (!source || !b) return;
        const lib = source.getState();
        if (!this.hasChanges(lib)) return;

        try {
            const putShows: LibraryBatch['putShows'] = [];
            const deleteShows: string[] = [];
            if (lib.mediaLibrary !== b.library) {
                for (const name of Object.keys(lib.mediaLibrary)) {
                    const show = lib.mediaLibrary[name];
                    if (b.showRefs.get(name) !== show) putShows.push({ name, json: JSON.stringify(show) });
                }
                for (const name of b.showRefs.keys()) {
                    if (!Object.prototype.hasOwnProperty.call(lib.mediaLibrary, name)) deleteShows.push(name);
                }
            }
            const changedKv = KV_KEYS.filter(key => lib[key] !== b[key]);
            await this.db.write({
                putShows,
                deleteShows,
                putKv: changedKv.map(key => ({ key, json: JSON.stringify(lib[key]) })),
            });
            this._baseline = baselineOf(lib);
            logger.log(TAG, `Saved ${putShows.length} show(s)${deleteShows.length ? `, removed ${deleteShows.length}` : ''}${changedKv.length ? ` + ${changedKv.join(', ')}` : ''}`);
        } catch (e) {
            logger.error(TAG, 'Failed to save library; will retry on next save', e);
        }
    }
}
