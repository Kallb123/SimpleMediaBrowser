import { REHYDRATE } from 'redux-persist';

jest.mock('@/scripts/Logger', () => ({
  logger: { log: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

jest.mock('@react-native-async-storage/async-storage', () =>
  jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

// Importing store.ts creates the real store, whose redux-persist bootstrap arms a 5 s
// timeout. Fake timers (installed before the require) keep it from holding Jest open.
jest.useFakeTimers();
const {
  createRehydrateErrorGuard,
  createWriteGate,
  legacyLibraryReconciler,
  takeLegacyPersistedLibrary,
// eslint-disable-next-line @typescript-eslint/no-require-imports
}: typeof import('../store') = require('../store');

afterAll(() => {
  jest.clearAllTimers();
  jest.useRealTimers();
});

const config: any = { key: 'root', storage: {} };

describe('legacyLibraryReconciler', () => {
  const original = { settingsReducer: { a: 1 }, libraryReducer: { movies: [] } };

  it('strips libraryReducer from the inbound state, stashes it, and merges the rest', () => {
    const legacy = { mediaLibrary: {}, movies: [{ path: 'm' }], isScanning: true };
    const inbound = { settingsReducer: { a: 2 }, libraryReducer: legacy, _persist: { version: -1, rehydrated: true } };

    const result = legacyLibraryReconciler(inbound, original, original, config) as any;

    expect(result.settingsReducer).toEqual({ a: 2 });
    expect(result.libraryReducer).toBe(original.libraryReducer); // stale library not merged
    expect(takeLegacyPersistedLibrary()).toBe(legacy);
    expect(takeLegacyPersistedLibrary()).toBeUndefined(); // cleared after take
  });

  it('leaves nothing stashed when the blob has no library', () => {
    const result = legacyLibraryReconciler({ settingsReducer: { a: 3 } }, original, original, config) as any;

    expect(result.settingsReducer).toEqual({ a: 3 });
    expect(takeLegacyPersistedLibrary()).toBeUndefined();
  });
});

describe('createWriteGate', () => {
  const makeBase = () => ({
    getItem: jest.fn().mockResolvedValue('v'),
    setItem: jest.fn().mockResolvedValue(undefined),
    removeItem: jest.fn().mockResolvedValue(undefined),
  });
  const flushMicrotasks = async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); };

  it('holds setItem until allowed, then writes through', async () => {
    const base = makeBase();
    const gate = createWriteGate(base);

    const pending = gate.storage.setItem('persist:root', '{}');
    await flushMicrotasks();
    expect(base.setItem).not.toHaveBeenCalled();

    gate.allow();
    await pending;
    expect(base.setItem).toHaveBeenCalledWith('persist:root', '{}');

    await gate.storage.setItem('persist:root', '{"x":1}');
    expect(base.setItem).toHaveBeenCalledTimes(2);
  });

  it('passes getItem and removeItem straight through, even while closed', async () => {
    const base = makeBase();
    const gate = createWriteGate(base);

    await expect(gate.storage.getItem('k')).resolves.toBe('v');
    await gate.storage.removeItem('k');
    expect(base.getItem).toHaveBeenCalledWith('k');
    expect(base.removeItem).toHaveBeenCalledWith('k');
  });

  it('block() turns waiting and future writes into no-ops', async () => {
    const base = makeBase();
    const gate = createWriteGate(base);

    const waiting = gate.storage.setItem('persist:root', 'a');
    gate.block();
    await waiting;
    await gate.storage.setItem('persist:root', 'b');
    gate.allow(); // a later allow cannot re-enable writes

    await gate.storage.setItem('persist:root', 'c');
    expect(base.setItem).not.toHaveBeenCalled();
    expect(gate.isBlocked()).toBe(true);
  });
});

describe('createRehydrateErrorGuard', () => {
  const run = (guard: ReturnType<typeof createRehydrateErrorGuard>, action: any) => {
    const next = jest.fn((a) => a);
    const result = (guard as any)({})(next)(action);
    return { next, result };
  };

  it('blocks writes on a REHYDRATE error for the root key and still forwards the action', () => {
    const gate = createWriteGate({ getItem: jest.fn(), setItem: jest.fn(), removeItem: jest.fn() });
    const guard = createRehydrateErrorGuard(gate);
    const action = { type: REHYDRATE, key: 'root', err: new Error('timed out') };

    const { next } = run(guard, action);

    expect(gate.isBlocked()).toBe(true);
    expect(next).toHaveBeenCalledWith(action);
  });

  it('ignores successful rehydrates and other keys', () => {
    const gate = createWriteGate({ getItem: jest.fn(), setItem: jest.fn(), removeItem: jest.fn() });
    const guard = createRehydrateErrorGuard(gate);

    run(guard, { type: REHYDRATE, key: 'root', payload: {} });
    run(guard, { type: REHYDRATE, key: 'other', err: new Error('x') });
    run(guard, { type: 'something/else' });

    expect(gate.isBlocked()).toBe(false);
  });
});
