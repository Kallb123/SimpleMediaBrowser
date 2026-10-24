import { hydrateLibrary } from '../libraryReducer';
import { runLibraryPersistence } from '../libraryPersistence';
import type { LibraryPersistenceDeps } from '../libraryPersistence';

jest.mock('@/scripts/Logger', () => ({
  logger: { log: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

// Only used by the startLibraryPersistence tests at the bottom; importing the real
// store.ts would create the redux-persist store (and its 5 s rehydrate timeout).
const mockStoreSubscribe = jest.fn();
jest.mock('@/store/store', () => ({
  store: { dispatch: jest.fn(), getState: () => ({ libraryReducer: {} }), subscribe: (...a: unknown[]) => mockStoreSubscribe(...a) },
  allowPersistWrites: jest.fn(),
  takeLegacyPersistedLibrary: jest.fn(),
  didPersistRehydrateFail: () => false,
  waitForPersistBootstrap: () => Promise.resolve(),
}));

const EMPTY = { mediaLibrary: {}, movies: [], audiobooks: [], mediaOverrides: {}, thumbnails: {} };

const LEGACY: any = {
  mediaLibrary: { Bluey: { title: 'Bluey', seasons: {} } },
  movies: [{ path: 'm1' }, { path: 'm2' }],
  audiobooks: [{ folderKey: 'a1' }],
  mediaOverrides: { 'show:Bluey': { title: 'Bluey!' } },
  thumbnails: { m1: 'file://t.jpg' },
  // Legacy transient fields that must not be carried into the library store.
  isScanning: true,
  scanProgress: { phase: 'collecting' },
  scanList: ['x'],
};

const PICKED_LEGACY: any = {
  mediaLibrary: LEGACY.mediaLibrary,
  movies: LEGACY.movies,
  audiobooks: LEGACY.audiobooks,
  mediaOverrides: LEGACY.mediaOverrides,
  thumbnails: LEGACY.thumbnails,
};

// Records the order of side effects across the fake deps.
let calls: string[];
let load: jest.Mock;
let writeAll: jest.Mock;
let startAutoSave: jest.Mock;
let allowWrites: jest.Mock;
let takeLegacy: jest.Mock;
let didRehydrateFail: jest.Mock;
let dispatch: jest.Mock;
let getLibraryState: jest.Mock;
let subscribe: jest.Mock;
let alert: jest.Mock;

function run(): Promise<void> {
  const deps: LibraryPersistenceDeps = {
    waitForBootstrap: () => Promise.resolve(),
    didRehydrateFail: didRehydrateFail as any,
    takeLegacy: takeLegacy as any,
    allowWrites: allowWrites as any,
    libraryStore: { load, writeAll, startAutoSave } as any,
    dispatch: dispatch as any,
    getLibraryState: getLibraryState as any,
    subscribe: subscribe as any,
    alert: alert as any,
  };
  return runLibraryPersistence(deps);
}

beforeEach(() => {
  calls = [];
  load = jest.fn().mockResolvedValue(null);
  writeAll = jest.fn(async () => { calls.push('writeAll'); });
  startAutoSave = jest.fn(() => { calls.push('autosave'); return () => {}; });
  allowWrites = jest.fn(() => { calls.push('allow'); });
  takeLegacy = jest.fn().mockReturnValue(undefined);
  didRehydrateFail = jest.fn().mockReturnValue(false);
  dispatch = jest.fn(() => { calls.push('hydrate'); });
  getLibraryState = jest.fn().mockReturnValue({});
  subscribe = jest.fn();
  alert = jest.fn();
});

describe('runLibraryPersistence', () => {
  it('fresh install: writes an empty store, then hydrates, autosaves and allows settings writes', async () => {
    await run();

    expect(writeAll).toHaveBeenCalledWith(EMPTY);
    expect(dispatch).toHaveBeenCalledWith(hydrateLibrary(EMPTY));
    expect(calls).toEqual(['writeAll', 'hydrate', 'autosave', 'allow']);
    expect(alert).not.toHaveBeenCalled();
  });

  it('upgrade: migrates the legacy blob without transient fields', async () => {
    takeLegacy.mockReturnValue(LEGACY);

    await run();

    expect(writeAll).toHaveBeenCalledTimes(1);
    expect(writeAll).toHaveBeenCalledWith(PICKED_LEGACY);
    const written = writeAll.mock.calls[0][0];
    expect(written).not.toHaveProperty('isScanning');
    expect(written).not.toHaveProperty('scanProgress');
    expect(written).not.toHaveProperty('scanList');
    expect(dispatch).toHaveBeenCalledWith(hydrateLibrary(PICKED_LEGACY));
    expect(calls).toEqual(['writeAll', 'hydrate', 'autosave', 'allow']);
  });

  it('existing store: hydrates from it, never writes, and discards the stale legacy blob', async () => {
    const stored = { ...EMPTY, movies: [{ path: 'stored' }] };
    load.mockResolvedValue(stored);
    takeLegacy.mockReturnValue(LEGACY);

    await run();

    expect(writeAll).not.toHaveBeenCalled();
    expect(takeLegacy).toHaveBeenCalledTimes(1); // taken to clear it, result ignored
    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(dispatch).toHaveBeenCalledWith(hydrateLibrary(stored as any));
    expect(calls).toEqual(['hydrate', 'autosave', 'allow']);
  });

  it('load throws: no hydrate, no autosave, alerts once, settings writes allowed', async () => {
    load.mockRejectedValue(new Error('corrupt'));
    takeLegacy.mockReturnValue(LEGACY);

    await run();

    expect(dispatch).not.toHaveBeenCalled();
    expect(startAutoSave).not.toHaveBeenCalled();
    expect(writeAll).not.toHaveBeenCalled();
    expect(takeLegacy).toHaveBeenCalledTimes(1); // legacy blob discarded
    expect(alert).toHaveBeenCalledTimes(1);
    expect(allowWrites).toHaveBeenCalledTimes(1);
  });

  it('writeAll throws: still hydrates, but no autosave and settings writes stay blocked', async () => {
    takeLegacy.mockReturnValue(LEGACY);
    writeAll.mockRejectedValue(new Error('disk full'));

    await run();

    expect(dispatch).toHaveBeenCalledWith(hydrateLibrary(PICKED_LEGACY));
    expect(startAutoSave).not.toHaveBeenCalled();
    expect(allowWrites).not.toHaveBeenCalled();
  });

  it('failed settings rehydrate, no store yet: skips the migration and leaves persist:root untouched', async () => {
    didRehydrateFail.mockReturnValue(true);

    await run();

    expect(load).toHaveBeenCalledTimes(1);
    expect(takeLegacy).not.toHaveBeenCalled();
    expect(writeAll).not.toHaveBeenCalled();
    expect(dispatch).not.toHaveBeenCalled();
    expect(startAutoSave).not.toHaveBeenCalled();
    expect(allowWrites).not.toHaveBeenCalled();
    expect(alert).toHaveBeenCalledTimes(1);
  });

  it('failed settings rehydrate, existing store: still loads and autosaves the library', async () => {
    // The write gate stays blocked after a failed rehydrate, so allowing writes here is a no-op.
    didRehydrateFail.mockReturnValue(true);
    const stored = { ...EMPTY, movies: [{ path: 'stored' }] };
    load.mockResolvedValue(stored);

    await run();

    expect(writeAll).not.toHaveBeenCalled();
    expect(dispatch).toHaveBeenCalledWith(hydrateLibrary(stored as any));
    expect(calls).toEqual(['hydrate', 'autosave', 'allow']);
    expect(alert).toHaveBeenCalledTimes(1);
  });

  it('autosave reads the persisted subset of the library slice', async () => {
    load.mockResolvedValue(EMPTY);
    getLibraryState.mockReturnValue({ ...LEGACY });

    await run();

    const source = startAutoSave.mock.calls[0][0];
    expect(source.getState()).toEqual(PICKED_LEGACY);
    const listener = () => {};
    source.subscribe(listener);
    expect(subscribe).toHaveBeenCalledWith(listener);
  });

  it('rejects if a dependency throws (startLibraryPersistence is what swallows it)', async () => {
    dispatch.mockImplementation(() => { throw new Error('boom'); });

    await expect(run()).rejects.toThrow('boom');
  });
});

describe('startLibraryPersistence', () => {
  // Fresh module instances per test, because the run is memoised at module level.
  function loadModules() {
    let mods!: { start: () => Promise<void>; LibraryStore: typeof import('@/scripts/LibraryStore').LibraryStore };
    jest.isolateModules(() => {
      /* eslint-disable @typescript-eslint/no-require-imports */
      mods = {
        start: require('../libraryPersistence').startLibraryPersistence,
        LibraryStore: require('@/scripts/LibraryStore').LibraryStore,
      };
      /* eslint-enable @typescript-eslint/no-require-imports */
    });
    return mods;
  }

  it('is memoised: a second call reuses the first run', async () => {
    const { start, LibraryStore } = loadModules();
    const getInstance = jest.spyOn(LibraryStore, 'getInstance').mockReturnValue({
      load: load.mockResolvedValue(EMPTY),
      writeAll,
      startAutoSave,
    } as any);

    const first = start();
    const second = start();
    expect(second).toBe(first);
    await first;

    expect(getInstance).toHaveBeenCalledTimes(1);
    expect(load).toHaveBeenCalledTimes(1);
    expect(startAutoSave).toHaveBeenCalledTimes(1);
  });

  it('never rejects, even on an unexpected failure', async () => {
    const { start, LibraryStore } = loadModules();
    jest.spyOn(LibraryStore, 'getInstance').mockImplementation(() => { throw new Error('boom'); });

    await expect(start()).resolves.toBeUndefined();
  });
});
