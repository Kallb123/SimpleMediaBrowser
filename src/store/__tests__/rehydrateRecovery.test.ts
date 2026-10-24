import AsyncStorage from '@react-native-async-storage/async-storage';
import { StorageKeys } from '@/constants/StorageKeys';
import { createWriteGate } from '../persistGuards';
import { runLibraryPersistence } from '../libraryPersistence';
import type { LibraryPersistenceDeps } from '../libraryPersistence';
import {
  PERSIST_STORAGE_KEY,
  buildRecoveryPrompt,
  clearRehydrateFailure,
  errorMessage,
  isSizeFailure,
  performStartFresh,
  recordRehydrateFailure,
  shouldOfferRecovery,
} from '../rehydrateRecovery';

jest.mock('@react-native-async-storage/async-storage', () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'));

jest.mock('@/scripts/Logger', () => ({
  logger: { log: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

const SIZE_ERROR = 'Row too big to fit into CursorWindow requiredPos=0, totalRows=1';
const FAILURE_KEY = StorageKeys.REHYDRATE_FAILURE_KEY;

beforeEach(async () => {
  await AsyncStorage.clear();
  jest.clearAllMocks();
});

describe('shouldOfferRecovery', () => {
  const rec = (consecutiveFailures: number, lastError = 'read failed') => ({ consecutiveFailures, lastError });

  it('does not offer on a single, non-size failure', () => {
    expect(shouldOfferRecovery(rec(1))).toBe(false);
    expect(shouldOfferRecovery(rec(1, 'timeout of 5000ms exceeded'))).toBe(false);
  });

  it('offers after 2 consecutive failures', () => {
    expect(shouldOfferRecovery(rec(2))).toBe(true);
    expect(shouldOfferRecovery(rec(5))).toBe(true);
  });

  it('offers straight away for a size failure', () => {
    expect(shouldOfferRecovery(rec(1, SIZE_ERROR))).toBe(true);
    expect(shouldOfferRecovery(rec(1, "Couldn't read row 0, col 0 from CursorWindow"))).toBe(true);
  });
});

describe('isSizeFailure / errorMessage', () => {
  it('matches the #222 telltales case-insensitively', () => {
    expect(isSizeFailure(SIZE_ERROR)).toBe(true);
    expect(isSizeFailure('row too big')).toBe(true);
    expect(isSizeFailure('cursorwindow')).toBe(true);
    expect(isSizeFailure('disk I/O error')).toBe(false);
    expect(isSizeFailure('')).toBe(false);
  });

  it('extracts a message from errors, strings and other values', () => {
    expect(errorMessage(new Error('boom'))).toBe('boom');
    expect(errorMessage('plain')).toBe('plain');
    expect(errorMessage(undefined)).toBe('unknown error');
    expect(errorMessage({ code: 1 })).toBe('{"code":1}');
  });
});

describe('failure record bookkeeping', () => {
  it('increments per failed launch and keeps the latest error', async () => {
    const first = await recordRehydrateFailure(AsyncStorage, 'first', 100);
    const second = await recordRehydrateFailure(AsyncStorage, SIZE_ERROR, 200);

    expect(first).toEqual({ consecutiveFailures: 1, lastError: 'first', lastFailedAt: 100 });
    expect(second).toEqual({ consecutiveFailures: 2, lastError: SIZE_ERROR, lastFailedAt: 200 });
    expect(JSON.parse((await AsyncStorage.getItem(FAILURE_KEY))!)).toEqual(second);
  });

  it('is cleared by a successful rehydrate', async () => {
    await recordRehydrateFailure(AsyncStorage, 'x');
    await clearRehydrateFailure(AsyncStorage);

    expect(await AsyncStorage.getItem(FAILURE_KEY)).toBeNull();
    expect((await recordRehydrateFailure(AsyncStorage, 'y')).consecutiveFailures).toBe(1);
  });

  it('treats a corrupt record as no history', async () => {
    await AsyncStorage.setItem(FAILURE_KEY, '{not json');

    expect((await recordRehydrateFailure(AsyncStorage, 'x')).consecutiveFailures).toBe(1);
  });

  it('never throws when the record cannot be read or written', async () => {
    const broken = {
      getItem: jest.fn().mockRejectedValue(new Error('no')),
      setItem: jest.fn().mockRejectedValue(new Error('no')),
      removeItem: jest.fn().mockRejectedValue(new Error('no')),
    };

    await expect(recordRehydrateFailure(broken, 'x')).resolves.toMatchObject({ consecutiveFailures: 1 });
    await expect(clearRehydrateFailure(broken)).resolves.toBeUndefined();
  });

  it('is stored apart from persist:root', async () => {
    await recordRehydrateFailure(AsyncStorage, 'x');

    expect(FAILURE_KEY).not.toBe(PERSIST_STORAGE_KEY);
    expect(await AsyncStorage.getItem(PERSIST_STORAGE_KEY)).toBeNull();
  });
});

describe('buildRecoveryPrompt', () => {
  it('spells out that Start fresh discards data and requires setup and a rescan', () => {
    const { message } = buildRecoveryPrompt({ consecutiveFailures: 1, lastError: SIZE_ERROR });

    expect(message).toMatch(/Start fresh deletes/);
    expect(message).toMatch(/set up .*rescan/);
    expect(message).toMatch(/Keep trying/);
    expect(message).toContain(SIZE_ERROR);
  });

  it('truncates very long errors', () => {
    const { message } = buildRecoveryPrompt({ consecutiveFailures: 3, lastError: 'e'.repeat(1000) });

    expect(message.length).toBeLessThan(1000);
  });
});

describe('performStartFresh', () => {
  it('removes persist:root and the first-time flag, then re-arms the gate', async () => {
    await AsyncStorage.setItem(PERSIST_STORAGE_KEY, '{"settingsReducer":"x"}');
    await AsyncStorage.setItem(StorageKeys.FIRST_TIME_SETUP_KEY, 'false');
    const order: string[] = [];
    const storage = {
      removeItem: jest.fn(async (k: string) => { order.push(`remove ${k}`); await AsyncStorage.removeItem(k); }),
    };

    await performStartFresh({ storage, unblockWrites: () => { order.push('unblock'); } });

    expect(order).toEqual([`remove ${PERSIST_STORAGE_KEY}`, `remove ${StorageKeys.FIRST_TIME_SETUP_KEY}`, 'unblock']);
    expect(await AsyncStorage.getItem(PERSIST_STORAGE_KEY)).toBeNull();
    expect(await AsyncStorage.getItem(StorageKeys.FIRST_TIME_SETUP_KEY)).toBeNull();
  });

  it('does not unblock writes if persist:root cannot be removed', async () => {
    const unblockWrites = jest.fn();
    const storage = { removeItem: jest.fn().mockRejectedValue(new Error('locked')) };

    await expect(performStartFresh({ storage, unblockWrites })).rejects.toThrow('locked');
    expect(unblockWrites).not.toHaveBeenCalled();
    expect(storage.removeItem).toHaveBeenCalledTimes(1);
  });

  it('still unblocks if only the first-time flag cannot be reset', async () => {
    const unblockWrites = jest.fn();
    const storage = {
      removeItem: jest.fn().mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('x')),
    };

    await performStartFresh({ storage, unblockWrites });
    expect(unblockWrites).toHaveBeenCalledTimes(1);
  });
});

// Drives runLibraryPersistence with the real write gate and the AsyncStorage
// mock standing in for a device, to prove what ends up in persist:root.
describe('end to end over a write gate and AsyncStorage', () => {
  const OLD_BLOB = '{"settingsReducer":"{\\"apiKey\\":\\"keep-me\\"}","libraryReducer":"HUGE"}';
  let persistWriteKeys: string[];
  let gate: ReturnType<typeof createWriteGate>;
  let confirm: jest.Mock;
  let alert: jest.Mock;
  let libraryWrites: unknown[];

  // `rehydrateError` undefined means the rehydrate succeeded.
  function makeDeps(rehydrateError: unknown, stored: unknown = null): LibraryPersistenceDeps {
    if (rehydrateError !== undefined) gate.block(rehydrateError);
    return {
      waitForBootstrap: () => Promise.resolve(),
      didRehydrateFail: gate.isBlocked,
      takeLegacy: () => undefined,
      allowWrites: gate.allow,
      libraryStore: {
        load: async () => stored,
        writeAll: async (lib: unknown) => { libraryWrites.push(lib); },
        startAutoSave: () => () => {},
      } as any,
      dispatch: jest.fn(),
      getLibraryState: () => ({}),
      subscribe: jest.fn(),
      alert,
      getRehydrateError: gate.getBlockReason,
      recovery: {
        recordFailure: (m) => recordRehydrateFailure(AsyncStorage, m),
        clearFailure: () => clearRehydrateFailure(AsyncStorage),
        confirmStartFresh: confirm,
        startFresh: () => performStartFresh({ storage: AsyncStorage, unblockWrites: gate.unblock }),
      },
    };
  }

  beforeEach(async () => {
    await AsyncStorage.setItem(PERSIST_STORAGE_KEY, OLD_BLOB);
    persistWriteKeys = [];
    gate = newGate();
    confirm = jest.fn().mockResolvedValue(true);
    alert = jest.fn();
    libraryWrites = [];
  });

  // A gate over AsyncStorage that records which keys were actually written.
  const newGate = () => createWriteGate({
    getItem: (k) => AsyncStorage.getItem(k),
    removeItem: (k) => AsyncStorage.removeItem(k),
    setItem: (k, v) => { persistWriteKeys.push(k); return AsyncStorage.setItem(k, v); },
  });
  const persistWrites = () => persistWriteKeys.filter((k) => k === PERSIST_STORAGE_KEY);

  it('a single transient failure never removes or overwrites persist:root', async () => {
    const deps = makeDeps(new Error('SQLITE_BUSY'));

    await runLibraryPersistence(deps);
    // redux-persist's would-be write of defaults after the failed rehydrate:
    await gate.storage.setItem(PERSIST_STORAGE_KEY, '{"settingsReducer":"defaults"}');

    expect(confirm).not.toHaveBeenCalled();
    expect(alert).toHaveBeenCalledTimes(1);
    expect(await AsyncStorage.getItem(PERSIST_STORAGE_KEY)).toBe(OLD_BLOB);
    expect(persistWrites()).toHaveLength(0);
    expect(libraryWrites).toHaveLength(0);
    expect(JSON.parse((await AsyncStorage.getItem(FAILURE_KEY))!).consecutiveFailures).toBe(1);
  });

  it('a successful launch between failures resets the count', async () => {
    await runLibraryPersistence(makeDeps(new Error('SQLITE_BUSY')));
    gate = newGate();
    await runLibraryPersistence(makeDeps(undefined, { mediaLibrary: {}, movies: [], audiobooks: [], mediaOverrides: {}, thumbnails: {} }));
    expect(await AsyncStorage.getItem(FAILURE_KEY)).toBeNull();
    gate = newGate();
    await runLibraryPersistence(makeDeps(new Error('SQLITE_BUSY')));

    expect(confirm).not.toHaveBeenCalled();
    expect(JSON.parse((await AsyncStorage.getItem(FAILURE_KEY))!).consecutiveFailures).toBe(1);
  });

  it('"Keep trying" on a size failure leaves persist:root untouched and still blocked', async () => {
    confirm.mockResolvedValue(false);

    await runLibraryPersistence(makeDeps(new Error(SIZE_ERROR)));
    await gate.storage.setItem(PERSIST_STORAGE_KEY, '{"settingsReducer":"defaults"}');

    expect(confirm).toHaveBeenCalledTimes(1);
    expect(await AsyncStorage.getItem(PERSIST_STORAGE_KEY)).toBe(OLD_BLOB);
    expect(gate.isBlocked()).toBe(true);
    expect(libraryWrites).toHaveLength(0);
  });

  it('two failed launches in a row offer the choice on the second', async () => {
    confirm.mockResolvedValue(false);
    await runLibraryPersistence(makeDeps(new Error('timeout of 5000ms exceeded')));
    expect(confirm).not.toHaveBeenCalled();

    gate = newGate();
    await runLibraryPersistence(makeDeps(new Error('timeout of 5000ms exceeded')));
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(confirm.mock.calls[0][0]).toMatchObject({ consecutiveFailures: 2 });
  });

  it('"Start fresh" removes the entry, creates the library store, and lets settings persist again', async () => {
    await AsyncStorage.setItem(StorageKeys.FIRST_TIME_SETUP_KEY, 'false');
    const deps = makeDeps(new Error(SIZE_ERROR));

    // A write queued by redux-persist before the choice must not land on the old entry.
    await gate.storage.setItem(PERSIST_STORAGE_KEY, '{"settingsReducer":"defaults"}');
    expect(persistWrites()).toHaveLength(0);

    await runLibraryPersistence(deps);

    expect(await AsyncStorage.getItem(PERSIST_STORAGE_KEY)).toBeNull();
    expect(await AsyncStorage.getItem(StorageKeys.FIRST_TIME_SETUP_KEY)).toBeNull();
    expect(await AsyncStorage.getItem(FAILURE_KEY)).toBeNull();
    expect(libraryWrites).toHaveLength(1); // empty library store initialised
    expect(gate.isBlocked()).toBe(false);

    await gate.storage.setItem(PERSIST_STORAGE_KEY, '{"settingsReducer":"new settings"}');
    expect(await AsyncStorage.getItem(PERSIST_STORAGE_KEY)).toBe('{"settingsReducer":"new settings"}');
    expect(alert).not.toHaveBeenCalled();
  });

  it('"Start fresh" holds settings writes until the library store is initialised', async () => {
    let releaseWriteAll!: () => void;
    const deps = makeDeps(new Error(SIZE_ERROR));
    (deps.libraryStore as any).writeAll = () => new Promise<void>((resolve) => { releaseWriteAll = resolve; });

    const running = runLibraryPersistence(deps);
    for (let i = 0; i < 20; i++) await Promise.resolve();
    expect(await AsyncStorage.getItem(PERSIST_STORAGE_KEY)).toBeNull();

    const write = gate.storage.setItem(PERSIST_STORAGE_KEY, '{"s":1}');
    for (let i = 0; i < 20; i++) await Promise.resolve();
    expect(persistWrites()).toHaveLength(0);

    releaseWriteAll();
    await running;
    await write;
    expect(await AsyncStorage.getItem(PERSIST_STORAGE_KEY)).toBe('{"s":1}');
  });
});
