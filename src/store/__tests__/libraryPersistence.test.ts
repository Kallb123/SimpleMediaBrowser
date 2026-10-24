import { Alert } from 'react-native';
import { hydrateLibrary } from '../libraryReducer';

// Records the order of side effects across the mocked modules.
const mockCalls: string[] = [];
const mockLoad = jest.fn();
const mockWriteAll = jest.fn();
const mockStartAutoSave = jest.fn();
const mockAllowPersistWrites = jest.fn();
const mockTakeLegacy = jest.fn();
const mockDidRehydrateFail = jest.fn();
const mockDispatch = jest.fn();
const mockGetState = jest.fn();
const mockSubscribe = jest.fn();

jest.mock('@/scripts/Logger', () => ({
  logger: { log: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

jest.mock('@/scripts/LibraryStore', () => ({
  LibraryStore: {
    getInstance: () => ({
      load: (...a: unknown[]) => mockLoad(...a),
      writeAll: (...a: unknown[]) => mockWriteAll(...a),
      startAutoSave: (...a: unknown[]) => mockStartAutoSave(...a),
    }),
  },
  // Same contract as the real one: pick persisted fields, default the missing ones, drop transient ones.
  pickPersistedLibrary: (s: any) => ({
    mediaLibrary: s?.mediaLibrary ?? {},
    movies: s?.movies ?? [],
    audiobooks: s?.audiobooks ?? [],
    mediaOverrides: s?.mediaOverrides ?? {},
    thumbnails: s?.thumbnails ?? {},
  }),
}));

jest.mock('@/store/store', () => ({
  store: {
    dispatch: (...a: unknown[]) => mockDispatch(...a),
    getState: (...a: unknown[]) => mockGetState(...a),
    subscribe: (...a: unknown[]) => mockSubscribe(...a),
  },
  allowPersistWrites: () => mockAllowPersistWrites(),
  takeLegacyPersistedLibrary: () => mockTakeLegacy(),
  didPersistRehydrateFail: () => mockDidRehydrateFail(),
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

// Fresh module instance per test, because startLibraryPersistence memoises its run.
function load(): () => Promise<void> {
  let start!: () => Promise<void>;
  jest.isolateModules(() => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    start = require('../libraryPersistence').startLibraryPersistence;
  });
  return start;
}

function run(): Promise<void> {
  return load()();
}

let alertSpy: jest.SpyInstance;

beforeEach(() => {
  mockCalls.length = 0;
  jest.clearAllMocks();
  mockLoad.mockResolvedValue(null);
  mockWriteAll.mockImplementation(async () => { mockCalls.push('writeAll'); });
  mockStartAutoSave.mockImplementation(() => { mockCalls.push('autosave'); return () => {}; });
  mockAllowPersistWrites.mockImplementation(() => { mockCalls.push('allow'); });
  mockDispatch.mockImplementation(() => { mockCalls.push('hydrate'); });
  mockTakeLegacy.mockReturnValue(undefined);
  mockDidRehydrateFail.mockReturnValue(false);
  alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
});

afterEach(() => {
  alertSpy.mockRestore();
});

describe('startLibraryPersistence', () => {
  it('fresh install: writes an empty store, then hydrates, autosaves and allows settings writes', async () => {
    await run();

    expect(mockWriteAll).toHaveBeenCalledWith(EMPTY);
    expect(mockDispatch).toHaveBeenCalledWith(hydrateLibrary(EMPTY));
    expect(mockCalls).toEqual(['writeAll', 'hydrate', 'autosave', 'allow']);
    expect(alertSpy).not.toHaveBeenCalled();
  });

  it('upgrade: migrates the legacy blob without transient fields', async () => {
    mockTakeLegacy.mockReturnValue(LEGACY);

    await run();

    expect(mockWriteAll).toHaveBeenCalledTimes(1);
    expect(mockWriteAll).toHaveBeenCalledWith(PICKED_LEGACY);
    const written = mockWriteAll.mock.calls[0][0];
    expect(written).not.toHaveProperty('isScanning');
    expect(written).not.toHaveProperty('scanProgress');
    expect(written).not.toHaveProperty('scanList');
    expect(mockDispatch).toHaveBeenCalledWith(hydrateLibrary(PICKED_LEGACY));
    expect(mockCalls).toEqual(['writeAll', 'hydrate', 'autosave', 'allow']);
  });

  it('existing store: hydrates from it, never writes, and discards the stale legacy blob', async () => {
    const stored = { ...EMPTY, movies: [{ path: 'stored' }] };
    mockLoad.mockResolvedValue(stored);
    mockTakeLegacy.mockReturnValue(LEGACY);

    await run();

    expect(mockWriteAll).not.toHaveBeenCalled();
    expect(mockTakeLegacy).toHaveBeenCalledTimes(1); // taken to clear it, result ignored
    expect(mockDispatch).toHaveBeenCalledTimes(1);
    expect(mockDispatch).toHaveBeenCalledWith(hydrateLibrary(stored as any));
    expect(mockCalls).toEqual(['hydrate', 'autosave', 'allow']);
  });

  it('load throws: no hydrate, no autosave, alerts once, settings writes allowed', async () => {
    mockLoad.mockRejectedValue(new Error('corrupt'));
    mockTakeLegacy.mockReturnValue(LEGACY);

    await run();

    expect(mockDispatch).not.toHaveBeenCalled();
    expect(mockStartAutoSave).not.toHaveBeenCalled();
    expect(mockWriteAll).not.toHaveBeenCalled();
    expect(mockTakeLegacy).toHaveBeenCalledTimes(1); // legacy blob discarded
    expect(alertSpy).toHaveBeenCalledTimes(1);
    expect(mockAllowPersistWrites).toHaveBeenCalledTimes(1);
  });

  it('writeAll throws: still hydrates, but no autosave and settings writes stay blocked', async () => {
    mockTakeLegacy.mockReturnValue(LEGACY);
    mockWriteAll.mockRejectedValue(new Error('disk full'));

    await run();

    expect(mockDispatch).toHaveBeenCalledWith(hydrateLibrary(PICKED_LEGACY));
    expect(mockStartAutoSave).not.toHaveBeenCalled();
    expect(mockAllowPersistWrites).not.toHaveBeenCalled();
  });

  it('failed settings rehydrate, no store yet: skips the migration and leaves persist:root untouched', async () => {
    mockDidRehydrateFail.mockReturnValue(true);

    await run();

    expect(mockLoad).toHaveBeenCalledTimes(1);
    expect(mockTakeLegacy).not.toHaveBeenCalled();
    expect(mockWriteAll).not.toHaveBeenCalled();
    expect(mockDispatch).not.toHaveBeenCalled();
    expect(mockStartAutoSave).not.toHaveBeenCalled();
    expect(mockAllowPersistWrites).not.toHaveBeenCalled();
    expect(alertSpy).toHaveBeenCalledTimes(1);
  });

  it('failed settings rehydrate, existing store: still loads and autosaves the library', async () => {
    // The store.ts gate stays blocked after a failed rehydrate, so allowing writes here is a no-op.
    mockDidRehydrateFail.mockReturnValue(true);
    const stored = { ...EMPTY, movies: [{ path: 'stored' }] };
    mockLoad.mockResolvedValue(stored);

    await run();

    expect(mockWriteAll).not.toHaveBeenCalled();
    expect(mockDispatch).toHaveBeenCalledWith(hydrateLibrary(stored as any));
    expect(mockCalls).toEqual(['hydrate', 'autosave', 'allow']);
    expect(alertSpy).toHaveBeenCalledTimes(1);
  });

  it('autosave reads the persisted subset of the library slice', async () => {
    mockLoad.mockResolvedValue(EMPTY);
    mockGetState.mockReturnValue({ libraryReducer: { ...LEGACY } });

    await run();

    const source = mockStartAutoSave.mock.calls[0][0];
    expect(source.getState()).toEqual(PICKED_LEGACY);
    source.subscribe(() => {});
    expect(mockSubscribe).toHaveBeenCalledTimes(1);
  });

  it('is idempotent: a second call reuses the first run', async () => {
    const start = load();
    const first = start();
    const second = start();
    expect(second).toBe(first);
    await first;
    expect(mockLoad).toHaveBeenCalledTimes(1);
  });

  it('never rejects, even on an unexpected failure', async () => {
    mockLoad.mockResolvedValue(null);
    mockDispatch.mockImplementation(() => { throw new Error('boom'); });

    await expect(run()).resolves.toBeUndefined();
  });
});
