import { AppState } from 'react-native';
import { Directory, File, Paths } from 'expo-file-system';
import type { IMediaLibrary, IMediaShow, IMediaAudiobook, IMediaOverride } from '@/store/libraryReducer';
import type { IMediaObject } from '@/scripts/FileScanner';
import { logger } from '@/scripts/Logger';

const TAG = 'LibraryStore';

/** Bump when the on-disk layout changes incompatibly. Newer-than-supported stores refuse to load. */
export const LIBRARY_STORE_VERSION = 1;

/** Minimum gap between autosaves; changes arriving inside the window coalesce into one save. */
export const AUTOSAVE_THROTTLE_MS = 1000;

const MANIFEST_PATH = 'manifest.json';
const MOVIES_PATH = 'movies.json';
const AUDIOBOOKS_PATH = 'audiobooks.json';
const OVERRIDES_PATH = 'overrides.json';
const THUMBNAILS_PATH = 'thumbnails.json';
const SHOWS_DIR = 'shows';

/** How many shard files are read concurrently while loading. */
const LOAD_CONCURRENCY = 16;

/** The persisted part of libraryReducer (transient isScanning/scanProgress and legacy scanList are never stored). */
export interface PersistedLibrary {
    mediaLibrary: IMediaLibrary;
    movies: IMediaObject[];
    audiobooks: IMediaAudiobook[];
    mediaOverrides: { [key: string]: IMediaOverride };
    thumbnails: { [path: string]: string };
}

export const EMPTY_PERSISTED_LIBRARY: PersistedLibrary = Object.freeze({
    mediaLibrary: Object.freeze({}),
    movies: Object.freeze([]) as unknown as IMediaObject[],
    audiobooks: Object.freeze([]) as unknown as IMediaAudiobook[],
    mediaOverrides: Object.freeze({}),
    thumbnails: Object.freeze({}),
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
    };
}

// ── Filesystem abstraction ────────────────────────────────────────────────────

/**
 * Minimal filesystem abstraction so the store is testable with an in-memory
 * fake.  Paths are relative to the library root directory and use '/'
 * separators (e.g. 'manifest.json', 'shows/ab12cd34.json').
 */
export interface LibraryFs {
    /** Returns null if the file does not exist; throws on other read errors. */
    read(path: string): Promise<string | null>;
    /** MUST be atomic: a crash leaves either the old or the new contents. */
    write(path: string, contents: string): Promise<void>;
    /** No-op if the file is missing. */
    remove(path: string): Promise<void>;
    /** File names directly inside `dir` ('' = root); [] if the directory is missing. */
    list(dir: string): Promise<string[]>;
}

/** Suffix for the staging file of a first-time write (target did not exist). */
const TMP_SUFFIX = '.tmp';
/** Suffix for the staging file of an overwrite; see {@link createExpoLibraryFs}. */
const NEW_SUFFIX = '.new';

/**
 * {@link LibraryFs} backed by expo-file-system, rooted at
 * `<Paths.document>/<rootDirName>/`.
 *
 * Atomicity: contents are written to a staging file next to the target and
 * then moved into place.  `File.move` fails if the destination exists on both
 * platforms (Android `Path.moveTo` without REPLACE_EXISTING, iOS
 * `moveItem`), so overwriting must delete the target first.  That leaves a
 * tiny window (between the delete and the move) with no target file.  To make
 * even that window recoverable, overwrites stage to `<path>.new` (which is
 * always complete by the time the target is deleted) and `read()` heals a
 * missing target from a leftover `<path>.new`.  First-time writes stage to
 * `<path>.tmp`, which is never trusted (it may be partial).
 */
export function createExpoLibraryFs(rootDirName: string = 'library'): LibraryFs {
    const root = new Directory(Paths.document, rootDirName);
    const ensuredDirs = new Set<string>();

    const fileAt = (path: string) => new File(root, ...path.split('/'));
    const ensureParent = (file: File) => {
        const parent = file.parentDirectory;
        if (ensuredDirs.has(parent.uri)) return;
        parent.create({ intermediates: true, idempotent: true });
        ensuredDirs.add(parent.uri);
    };

    return {
        async read(path) {
            const file = fileAt(path);
            if (!file.exists) {
                // Crash between "delete old target" and "move staged file" in write().
                const staged = fileAt(path + NEW_SUFFIX);
                if (!staged.exists) return null;
                logger.warn(TAG, `Recovering ${path} from interrupted write`);
                staged.move(file);
            }
            return file.text();
        },

        async write(path, contents) {
            const target = fileAt(path);
            ensureParent(target);
            const overwriting = target.exists;
            const staged = fileAt(path + (overwriting ? NEW_SUFFIX : TMP_SUFFIX));
            staged.write(contents);
            if (overwriting) {
                target.delete();
            } else {
                const stale = fileAt(path + NEW_SUFFIX);
                if (stale.exists) stale.delete();
            }
            staged.move(target);
        },

        async remove(path) {
            for (const suffix of ['', NEW_SUFFIX, TMP_SUFFIX]) {
                const file = fileAt(path + suffix);
                if (file.exists) file.delete();
            }
        },

        async list(dir) {
            const directory = dir ? new Directory(root, ...dir.split('/')) : root;
            if (!directory.exists) return [];
            return directory.list().filter((entry): entry is File => entry instanceof File).map(entry => entry.name);
        },
    };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** FNV-1a 32-bit hash of the string's UTF-16 code units, as 8 hex chars. */
export function fnv1a32Hex(input: string): string {
    let h = 0x811c9dc5;
    for (let i = 0; i < input.length; i++) {
        h ^= input.charCodeAt(i);
        h = Math.imul(h, 0x01000193);
    }
    return (h >>> 0).toString(16).padStart(8, '0');
}

interface Manifest {
    version: number;
    /** Show name → shard file path (relative to the library root). */
    shows: { [showName: string]: string };
}

interface ShowShard {
    name: string;
    show: IMediaShow;
}

/**
 * What the disk is known to hold, expressed as the references that were last
 * written.  `undefined` means "not on disk yet / unknown", so it always
 * compares unequal to a real value and gets written.
 */
interface Baseline {
    /** The mediaLibrary object last fully persisted (fast path: identical => no show changed). */
    library: IMediaLibrary | undefined;
    movies: IMediaObject[] | undefined;
    audiobooks: IMediaAudiobook[] | undefined;
    mediaOverrides: PersistedLibrary['mediaOverrides'] | undefined;
    thumbnails: PersistedLibrary['thumbnails'] | undefined;
    /** Manifest last written (or loaded). */
    manifest: { [showName: string]: string };
    /** Shard file → show object last written to it. */
    shardRefs: Map<string, IMediaShow>;
}

const TOP_LEVEL_FILES = [
    { key: 'movies', path: MOVIES_PATH },
    { key: 'audiobooks', path: AUDIOBOOKS_PATH },
    { key: 'mediaOverrides', path: OVERRIDES_PATH },
    { key: 'thumbnails', path: THUMBNAILS_PATH },
] as const;

type TopLevelKey = typeof TOP_LEVEL_FILES[number]['key'];

interface SavePlan {
    /** Complete show name → shard file mapping for the library being saved. */
    mapping: { [showName: string]: string };
    /** Shards to (re)write: [file, name, show]. */
    shards: [string, string, IMediaShow][];
    topLevel: TopLevelKey[];
    manifestChanged: boolean;
    /** Shard files referenced by the old manifest but not the new one. */
    removedFiles: string[];
}

type AutoSaveSource = { getState(): PersistedLibrary; subscribe(listener: () => void): () => void };

function parseJson<T>(path: string, text: string): T {
    try {
        return JSON.parse(text) as T;
    } catch (e) {
        throw new Error(`${path} is not valid JSON: ${e instanceof Error ? e.message : String(e)}`);
    }
}

function sameKeys(a: object, b: object): boolean {
    const ak = Object.keys(a);
    return ak.length === Object.keys(b).length && ak.every(k => k in b);
}

// ── Store ─────────────────────────────────────────────────────────────────────

/**
 * Persists the media library as a manifest plus one JSON shard per show and a
 * handful of whole-file collections, replacing the single `persist:root`
 * AsyncStorage entry (which Android reads through a ~2 MB CursorWindow).
 * See ARCHITECTURE.md §5.
 *
 * Saves are incremental: Immer keeps unchanged shows referentially identical,
 * so only shards whose object reference changed are rewritten.  Write order
 * guarantees the manifest never references a shard that does not exist yet,
 * and a shard is only deleted after the manifest stopped referencing it.
 */
export class LibraryStore {
    private static _instance: LibraryStore | null = null;

    private _baseline: Baseline | null = null;
    private _source: AutoSaveSource | null = null;
    private _timer: ReturnType<typeof setTimeout> | null = null;
    /** Tail of the save queue: saves never overlap. */
    private _queue: Promise<unknown> = Promise.resolve();
    /** Shard files whose removal failed; retried on the next save / load. */
    private _staleFiles = new Set<string>();

    static getInstance(): LibraryStore {
        if (!LibraryStore._instance) {
            LibraryStore._instance = new LibraryStore(createExpoLibraryFs());
        }
        return LibraryStore._instance;
    }

    /** `hash` is injectable so tests can force shard-name collisions. */
    constructor(private readonly fs: LibraryFs, private readonly hash: (name: string) => string = fnv1a32Hex) {}

    // ── Load ──────────────────────────────────────────────────────────────────

    /**
     * Resolves null when nothing is stored yet (no manifest).  Throws if a
     * manifest exists but anything it references can't be read or parsed, or
     * its version is newer than supported; callers must then NOT autosave
     * (the files may still be recoverable).
     */
    async load(): Promise<PersistedLibrary | null> {
        const started = Date.now();
        const manifestText = await this.fs.read(MANIFEST_PATH);
        if (manifestText === null) return null;

        const manifest = parseJson<Manifest>(MANIFEST_PATH, manifestText);
        if (typeof manifest?.version !== 'number' || manifest.version < 1) {
            throw new Error(`${MANIFEST_PATH} has an invalid version`);
        }
        if (manifest.version > LIBRARY_STORE_VERSION) {
            throw new Error(`Library store version ${manifest.version} is newer than supported (${LIBRARY_STORE_VERSION})`);
        }
        if (!manifest.shows || typeof manifest.shows !== 'object') {
            throw new Error(`${MANIFEST_PATH} has no shows table`);
        }

        const names = Object.keys(manifest.shows);
        const shards: ShowShard[] = new Array(names.length);
        for (let i = 0; i < names.length; i += LOAD_CONCURRENCY) {
            await Promise.all(names.slice(i, i + LOAD_CONCURRENCY).map(async (name, j) => {
                const file = manifest.shows[name];
                if (typeof file !== 'string' || !file.startsWith(`${SHOWS_DIR}/`)) {
                    throw new Error(`Manifest entry for "${name}" has an invalid shard path`);
                }
                const text = await this.fs.read(file);
                if (text === null) throw new Error(`Shard ${file} for "${name}" is missing`);
                const shard = parseJson<ShowShard>(file, text);
                if (shard?.name !== name || !shard.show || typeof shard.show !== 'object') {
                    throw new Error(`Shard ${file} does not contain show "${name}"`);
                }
                shards[i + j] = shard;
            }));
        }

        const mediaLibrary: IMediaLibrary = {};
        const shardRefs = new Map<string, IMediaShow>();
        shards.forEach(shard => {
            mediaLibrary[shard.name] = shard.show;
            shardRefs.set(manifest.shows[shard.name], shard.show);
        });

        const loaded = await Promise.all(TOP_LEVEL_FILES.map(async ({ key, path }) => {
            const text = await this.fs.read(path);
            const empty = Array.isArray(EMPTY_PERSISTED_LIBRARY[key]) ? [] : {};
            if (text === null) {
                logger.warn(TAG, `${path} is missing; treating as empty`);
                return { key, value: empty, missing: true };
            }
            const value = parseJson<unknown>(path, text);
            if (Array.isArray(value) !== Array.isArray(empty) || value === null || typeof value !== 'object') {
                throw new Error(`${path} has an unexpected shape`);
            }
            return { key, value, missing: false };
        }));

        const lib: PersistedLibrary = {
            mediaLibrary,
            movies: [],
            audiobooks: [],
            mediaOverrides: {},
            thumbnails: {},
        };
        const baseline: Baseline = {
            library: mediaLibrary,
            movies: undefined,
            audiobooks: undefined,
            mediaOverrides: undefined,
            thumbnails: undefined,
            manifest: { ...manifest.shows },
            shardRefs,
        };
        for (const { key, value, missing } of loaded) {
            (lib as any)[key] = value;
            // A missing top-level file stays "unwritten" in the baseline so the next save recreates it.
            if (!missing) (baseline as any)[key] = value;
        }
        this._baseline = baseline;

        await this.removeOrphans(new Set(Object.values(manifest.shows)));

        logger.log(TAG, `Loaded ${names.length} show(s), ${lib.movies.length} movie(s), ${lib.audiobooks.length} audiobook(s) in ${Date.now() - started} ms`);
        return lib;
    }

    /** Deletes shard files (and staging leftovers) the manifest doesn't reference. Best effort. */
    private async removeOrphans(referenced: Set<string>): Promise<void> {
        try {
            const files = await this.fs.list(SHOWS_DIR);
            for (const name of files) {
                const path = `${SHOWS_DIR}/${name}`;
                if (referenced.has(path)) continue;
                try {
                    await this.fs.remove(path);
                } catch (e) {
                    logger.warn(TAG, `Could not remove orphan ${path}`, e);
                }
            }
        } catch (e) {
            logger.warn(TAG, 'Could not list shard directory for orphan cleanup', e);
        }
    }

    // ── Full write ────────────────────────────────────────────────────────────

    /**
     * Writes the complete library (migration / first save): every shard, the
     * top-level files, then the manifest LAST (its existence marks the store
     * as initialised), then removes orphaned shard files.  Throws if any write
     * fails.  Records what was written as the baseline for incremental saves.
     */
    writeAll(lib: PersistedLibrary): Promise<void> {
        return this.enqueue(async () => {
            const mapping = this.assignFiles(lib.mediaLibrary);
            const shardRefs = new Map<string, IMediaShow>();
            for (const name of Object.keys(lib.mediaLibrary)) {
                const show = lib.mediaLibrary[name];
                await this.fs.write(mapping[name], JSON.stringify({ name, show } satisfies ShowShard));
                shardRefs.set(mapping[name], show);
            }
            for (const { key, path } of TOP_LEVEL_FILES) {
                await this.fs.write(path, JSON.stringify(lib[key]));
            }
            await this.fs.write(MANIFEST_PATH, JSON.stringify({ version: LIBRARY_STORE_VERSION, shows: mapping } satisfies Manifest));

            this._baseline = {
                library: lib.mediaLibrary,
                movies: lib.movies,
                audiobooks: lib.audiobooks,
                mediaOverrides: lib.mediaOverrides,
                thumbnails: lib.thumbnails,
                manifest: mapping,
                shardRefs,
            };
            await this.removeOrphans(new Set(Object.values(mapping)));
            logger.log(TAG, `Wrote full library: ${shardRefs.size} show(s), ${lib.movies.length} movie(s), ${lib.audiobooks.length} audiobook(s)`);
        });
    }

    // ── Incremental save ──────────────────────────────────────────────────────

    /**
     * Begins incremental autosave.  Only valid after load() returned data or
     * writeAll() completed (it needs the baseline).  Throttled; also flushes
     * when the app goes to the background.  Returns a stop function.
     */
    startAutoSave(source: AutoSaveSource): () => void {
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
        const appStateSub = AppState.addEventListener('change', state => {
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
            || this._staleFiles.size > 0;
    }

    /**
     * Assigns a shard file to every show: reuses the existing mapping for known
     * names (stable across saves), otherwise a hash-derived name with a numeric
     * suffix on collision.  Files referenced by the current manifest are never
     * handed to a different show, so a half-finished save can't corrupt it.
     */
    private assignFiles(library: IMediaLibrary): { [showName: string]: string } {
        const existing = this._baseline?.manifest ?? {};
        const mapping: { [showName: string]: string } = {};
        const taken = new Set<string>();
        const names = Object.keys(library);
        for (const name of names) {
            if (name in existing && !taken.has(existing[name])) {
                mapping[name] = existing[name];
                taken.add(existing[name]);
            }
        }
        const reserved = new Set(Object.values(existing));
        for (const name of names) {
            if (name in mapping) continue;
            const base = `${SHOWS_DIR}/${this.hash(name)}`;
            let candidate = `${base}.json`;
            for (let n = 1; taken.has(candidate) || reserved.has(candidate); n++) {
                candidate = `${base}-${n}.json`;
            }
            mapping[name] = candidate;
            taken.add(candidate);
        }
        return mapping;
    }

    private plan(lib: PersistedLibrary): SavePlan | null {
        const b = this._baseline!;
        if (!this.hasChanges(lib)) return null;

        const mapping = this.assignFiles(lib.mediaLibrary);
        const shards: SavePlan['shards'] = [];
        if (lib.mediaLibrary !== b.library) {
            for (const name of Object.keys(lib.mediaLibrary)) {
                const show = lib.mediaLibrary[name];
                if (b.shardRefs.get(mapping[name]) !== show) shards.push([mapping[name], name, show]);
            }
        }
        const manifestChanged = !sameKeys(mapping, b.manifest)
            || Object.keys(mapping).some(name => mapping[name] !== b.manifest[name]);
        const newFiles = new Set(Object.values(mapping));
        return {
            mapping,
            shards,
            topLevel: TOP_LEVEL_FILES.map(f => f.key).filter(key => lib[key] !== b[key]),
            manifestChanged,
            removedFiles: Object.values(b.manifest).filter(file => !newFiles.has(file)),
        };
    }

    /**
     * One save pass.  Order: changed shards, top-level files, manifest (only if
     * the show set changed and every shard landed), then deletion of shards the
     * new manifest no longer references.  The baseline advances per successful
     * write, so anything that failed is retried on the next pass.
     */
    private async saveChanges(): Promise<void> {
        const source = this._source;
        const b = this._baseline;
        if (!source || !b) return;
        const lib = source.getState();
        const plan = this.plan(lib);
        if (!plan) return;

        let failed = false;
        const attempt = async (what: string, write: () => Promise<void>): Promise<boolean> => {
            try {
                await write();
                return true;
            } catch (e) {
                failed = true;
                logger.error(TAG, `Failed to save ${what}; will retry on next save`, e);
                return false;
            }
        };

        let shardsOk = true;
        for (const [file, name, show] of plan.shards) {
            const ok = await attempt(file, () => this.fs.write(file, JSON.stringify({ name, show } satisfies ShowShard)));
            if (ok) b.shardRefs.set(file, show);
            else shardsOk = false;
        }

        for (const { key, path } of TOP_LEVEL_FILES) {
            if (!plan.topLevel.includes(key)) continue;
            const value = lib[key];
            if (await attempt(path, () => this.fs.write(path, JSON.stringify(value)))) {
                (b as any)[key] = value;
            }
        }

        let manifestOk = !plan.manifestChanged;
        // Never publish a manifest that points at a shard which failed to write.
        if (plan.manifestChanged && shardsOk) {
            const manifest: Manifest = { version: LIBRARY_STORE_VERSION, shows: plan.mapping };
            manifestOk = await attempt(MANIFEST_PATH, () => this.fs.write(MANIFEST_PATH, JSON.stringify(manifest)));
            if (manifestOk) {
                b.manifest = plan.mapping;
                for (const file of plan.removedFiles) this._staleFiles.add(file);
            }
        }

        if (manifestOk && shardsOk) {
            b.library = lib.mediaLibrary;
        }

        // Safe now: the on-disk manifest no longer references these.
        for (const file of [...this._staleFiles]) {
            if (Object.values(b.manifest).includes(file)) {
                this._staleFiles.delete(file);
                continue;
            }
            try {
                await this.fs.remove(file);
                b.shardRefs.delete(file);
                this._staleFiles.delete(file);
            } catch (e) {
                logger.warn(TAG, `Could not remove stale shard ${file}; will retry`, e);
            }
        }

        if (!failed) {
            logger.log(TAG, `Saved ${plan.shards.length} show(s)${plan.topLevel.length ? ` + ${plan.topLevel.join(', ')}` : ''}${plan.manifestChanged ? ' + manifest' : ''}`);
        }
    }
}
