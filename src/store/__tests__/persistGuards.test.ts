import { REHYDRATE } from 'redux-persist';
import {
  createLegacyLibraryCapture,
  createRehydrateErrorGuard,
  createWriteGate,
} from '../persistGuards';

// Logger imports cleanly in Jest but hydrates/writes a real log file and echoes to the console.
jest.mock('@/scripts/Logger', () => ({
  logger: { log: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

const config: any = { key: 'root', storage: {} };

describe('createLegacyLibraryCapture', () => {
  const original = { settingsReducer: { a: 1 }, libraryReducer: { movies: [] } };

  it('strips libraryReducer from the inbound state, stashes it, and merges the rest', () => {
    const { reconciler, take } = createLegacyLibraryCapture();
    const legacy = { mediaLibrary: {}, movies: [{ path: 'm' }], isScanning: true };
    const inbound = { settingsReducer: { a: 2 }, libraryReducer: legacy, _persist: { version: -1, rehydrated: true } };

    const result = reconciler(inbound, original, original, config) as any;

    expect(result.settingsReducer).toEqual({ a: 2 });
    expect(result.libraryReducer).toBe(original.libraryReducer); // stale library not merged
    expect(take()).toBe(legacy);
    expect(take()).toBeUndefined(); // cleared after take
  });

  it('leaves nothing stashed when the blob has no library', () => {
    const { reconciler, take } = createLegacyLibraryCapture();

    const result = reconciler({ settingsReducer: { a: 3 } }, original, original, config) as any;

    expect(result.settingsReducer).toEqual({ a: 3 });
    expect(take()).toBeUndefined();
  });

  it('merges as usual when there is no inbound state', () => {
    const { reconciler, take } = createLegacyLibraryCapture();

    expect(reconciler(undefined, original, original, config)).toEqual(original);
    expect(take()).toBeUndefined();
  });

  it('keeps separate captures independent', () => {
    const a = createLegacyLibraryCapture();
    const b = createLegacyLibraryCapture();

    a.reconciler({ libraryReducer: { movies: [1] } }, original, original, config);

    expect(b.take()).toBeUndefined();
    expect(a.take()).toEqual({ movies: [1] });
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
    expect(gate.isBlocked()).toBe(false);
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

  it('unblock() re-arms the gate: writes are held until allow(), then pass', async () => {
    const base = makeBase();
    const gate = createWriteGate(base);
    const reason = new Error('Row too big to fit into CursorWindow');
    gate.block(reason);
    expect(gate.getBlockReason()).toBe(reason);

    gate.unblock();
    expect(gate.isBlocked()).toBe(false);
    expect(gate.getBlockReason()).toBeUndefined();

    const pending = gate.storage.setItem('persist:root', 'fresh');
    await flushMicrotasks();
    expect(base.setItem).not.toHaveBeenCalled();

    gate.allow();
    await pending;
    expect(base.setItem).toHaveBeenCalledWith('persist:root', 'fresh');
  });

  it('unblock() is a no-op when not blocked', async () => {
    const base = makeBase();
    const gate = createWriteGate(base);
    gate.allow();
    gate.unblock();

    await gate.storage.setItem('persist:root', 'x');
    expect(base.setItem).toHaveBeenCalledTimes(1);
  });

  it('keeps reads working after block()', async () => {
    const base = makeBase();
    const gate = createWriteGate(base);
    gate.block();

    await expect(gate.storage.getItem('k')).resolves.toBe('v');
  });
});

describe('createRehydrateErrorGuard', () => {
  const makeGate = () => createWriteGate({ getItem: jest.fn(), setItem: jest.fn(), removeItem: jest.fn() });
  const run = (guard: ReturnType<typeof createRehydrateErrorGuard>, action: any) => {
    const next = jest.fn((a) => a);
    const result = (guard as any)({})(next)(action);
    return { next, result };
  };

  it('blocks writes on a REHYDRATE error for the root key and still forwards the action', () => {
    const gate = makeGate();
    const guard = createRehydrateErrorGuard(gate);
    const action = { type: REHYDRATE, key: 'root', err: new Error('timed out') };

    const { next, result } = run(guard, action);

    expect(gate.isBlocked()).toBe(true);
    expect(gate.getBlockReason()).toBe(action.err);
    expect(next).toHaveBeenCalledWith(action);
    expect(result).toBe(action);
  });

  it('ignores successful rehydrates and other keys', () => {
    const gate = makeGate();
    const guard = createRehydrateErrorGuard(gate);

    run(guard, { type: REHYDRATE, key: 'root', payload: {} });
    run(guard, { type: REHYDRATE, key: 'other', err: new Error('x') });
    run(guard, { type: 'something/else', key: 'root', err: new Error('x') });
    run(guard, undefined);

    expect(gate.isBlocked()).toBe(false);
  });
});
