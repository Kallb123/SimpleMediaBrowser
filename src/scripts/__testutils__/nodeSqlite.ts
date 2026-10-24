import type { SqliteDatabase, SqliteTransaction } from '@/scripts/LibraryStore';

// Test-only (lives outside __tests__ so Jest doesn't treat it as a suite).
// Runs the production SQL of createExpoLibraryDb on Node's built-in SQLite.

// process.getBuiltinModule (Node >= 22.3) bypasses Jest's module resolver, which
// doesn't reliably know the prefix-only `node:sqlite` builtin across Node/Jest versions.
const sqlite = process.getBuiltinModule('node:sqlite') as typeof import('node:sqlite') | undefined;
if (!sqlite) throw new Error('node:sqlite is unavailable; the SQLite tests need Node >= 22.5');

type Params = (string | number | null)[];

/** One `runAsync` call, as seen by {@link NodeSqlite.failRunWhen}. */
export interface RunCall {
    sql: string;
    params: Params;
    /** 1-based count of runAsync calls since the hook was installed. */
    index: number;
}

export interface NodeSqlite {
    /** The underlying connection, for inspecting tables directly in tests. */
    raw: import('node:sqlite').DatabaseSync;
    /** Pass to `createExpoLibraryDb(name, open)`; every call returns the same in-memory database. */
    open: (name: string) => Promise<SqliteDatabase>;
    /** Number of times `open` was called. */
    openCount: number;
    /** Makes `runAsync` throw (before executing the statement) for calls the predicate accepts; null removes the hook. */
    failRunWhen(predicate: ((call: RunCall) => boolean) | null): void;
    /** Makes only the n-th runAsync call from now (1-based) throw. */
    failNthRun(n: number): void;
    all<T = Record<string, unknown>>(sql: string, ...params: Params): T[];
}

/**
 * A fresh `:memory:` database exposing the narrow expo-sqlite surface the
 * store uses.  Everything runs on one connection (a second `:memory:`
 * connection would be a different, empty database), so the exclusive
 * transaction simply scopes BEGIN/COMMIT/ROLLBACK around `task`, exactly as
 * expo-sqlite's `withExclusiveTransactionAsync` does on its dedicated connection.
 */
export function createNodeSqlite(): NodeSqlite {
    const raw = new sqlite!.DatabaseSync(':memory:');
    let hook: ((call: RunCall) => boolean) | null = null;
    let runs = 0;

    const txn: SqliteTransaction = {
        async runAsync(sql: string, params: Params = []) {
            const call = { sql, params, index: ++runs };
            if (hook?.(call)) throw new Error(`injected runAsync failure (call ${call.index}: ${sql})`);
            raw.prepare(sql).run(...params);
        },
    };

    const db: SqliteDatabase = {
        async execAsync(sql) {
            raw.exec(sql);
        },
        async getFirstAsync<T>(sql: string) {
            const row = raw.prepare(sql).get();
            return row ? ({ ...row } as T) : null;
        },
        async getAllAsync<T>(sql: string) {
            return raw.prepare(sql).all().map(row => ({ ...row }) as T);
        },
        // Mirrors expo-sqlite: BEGIN, task, COMMIT; any error (including a failed COMMIT) rolls back and is rethrown.
        async withExclusiveTransactionAsync(task) {
            let error: unknown;
            try {
                raw.exec('BEGIN');
                await task(txn);
                raw.exec('COMMIT');
            } catch (e) {
                raw.exec('ROLLBACK');
                error = e;
            }
            if (error) throw error;
        },
    };

    const self: NodeSqlite = {
        raw,
        openCount: 0,
        open: async () => {
            self.openCount++;
            return db;
        },
        failRunWhen(predicate) {
            hook = predicate;
            runs = 0;
        },
        failNthRun(n) {
            self.failRunWhen(call => call.index === n);
        },
        all<T>(sql: string, ...params: Params) {
            return raw.prepare(sql).all(...params).map(row => ({ ...row }) as T);
        },
    };
    return self;
}
