import { configureStore } from '@reduxjs/toolkit';
import libraryReducer, { hydrateLibrary, setListenProgress } from '@/store/libraryReducer';
import settingsReducer from '@/store/settingsReducer';
import { importJson } from '@/scripts/ImportExportService';

// A store built from the real slice reducers stands in for `@/store/store`, which would
// create the redux-persist store.
const mockStore = configureStore({ reducer: { libraryReducer, settingsReducer } });
jest.mock('@/store/store', () => ({
  get store() {
    return mockStore;
  },
}));

let mockFileText = '';
jest.mock('expo-file-system', () => ({
  File: class {
    text() {
      return Promise.resolve(mockFileText);
    }
  },
  Directory: class {},
}));
jest.mock('expo-document-picker', () => ({
  getDocumentAsync: jest.fn(async () => ({ canceled: false, assets: [{ uri: 'file:///import.json' }] })),
}));
jest.mock('@/scripts/Logger', () => ({ logger: { log: jest.fn(), warn: jest.fn(), error: jest.fn() } }));

const progress = (updatedAt: number, position = 10) => ({ partPath: 'b/1.mp3', position, duration: 600, updatedAt });
const importFile = (body: object) => {
  mockFileText = JSON.stringify({ smbVersion: 1, exportedAt: '2026-01-01T00:00:00.000Z', ...body });
  return importJson();
};
const current = () => mockStore.getState().libraryReducer.listenProgress;

describe('importJson listenProgress', () => {
  beforeEach(() => {
    mockStore.dispatch(hydrateLibrary({ mediaLibrary: {}, movies: [], audiobooks: [], mediaOverrides: {}, thumbnails: {}, watched: {}, listenProgress: {} }));
    mockStore.dispatch(setListenProgress({ folderKey: 'existing', progress: progress(500, 99) }));
  });

  it('merges valid entries and reports the section as applied', async () => {
    const { applied } = await importFile({ listenProgress: { fresh: progress(100, 5) } });
    expect(applied).toContain('listenProgress');
    expect(current().fresh).toEqual(progress(100, 5));
    expect(current().existing).toEqual(progress(500, 99));
  });

  it('keeps whichever side has the later updatedAt', async () => {
    await importFile({ listenProgress: { existing: progress(100, 1), other: progress(100, 2) } });
    expect(current().existing).toEqual(progress(500, 99));
    await importFile({ listenProgress: { existing: progress(900, 7) } });
    expect(current().existing).toEqual(progress(900, 7));
  });

  it('drops malformed entries', async () => {
    await importFile({
      listenProgress: {
        noPath: { position: 1, duration: 2, updatedAt: 3 },
        badPath: { partPath: 5, position: 1, duration: 2, updatedAt: 3 },
        stringPosition: { partPath: 'p', position: '1', duration: 2, updatedAt: 3 },
        nullDuration: { partPath: 'p', position: 1, duration: null, updatedAt: 3 },
        missingTime: { partPath: 'p', position: 1, duration: 2 },
        notObject: 'x',
        isNull: null,
        good: progress(10, 3),
      },
    });
    expect(Object.keys(current()).sort()).toEqual(['existing', 'good']);
  });

  it('ignores a non-object section and leaves progress alone', async () => {
    const { applied } = await importFile({ listenProgress: [progress(1)] });
    expect(applied).not.toContain('listenProgress');
    expect(Object.keys(current())).toEqual(['existing']);
  });

  it('is not touched by a file without the section', async () => {
    const { applied } = await importFile({ watched: { 'a/1.mkv': 1 } });
    expect(applied).toEqual(['watched']);
    expect(Object.keys(current())).toEqual(['existing']);
  });

  it('imports the audiobookPlayer setting, rejecting unknown values', async () => {
    await importFile({ settings: { audiobookPlayer: 'external' } });
    expect(mockStore.getState().settingsReducer.audiobookPlayer).toBe('external');
    await importFile({ settings: { audiobookPlayer: 'bogus' } });
    expect(mockStore.getState().settingsReducer.audiobookPlayer).toBe('external');
  });
});
