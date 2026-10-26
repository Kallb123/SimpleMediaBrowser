import { configureStore } from '@reduxjs/toolkit';
import libraryReducer, { hydrateLibrary, setListenProgress, setWatchProgress } from '@/store/libraryReducer';
import settingsReducer from '@/store/settingsReducer';
import { exportJson, importJson } from '@/scripts/ImportExportService';

// A store built from the real slice reducers stands in for `@/store/store`, which would
// create the redux-persist store.
const mockStore = configureStore({ reducer: { libraryReducer, settingsReducer } });
jest.mock('@/store/store', () => ({
  get store() {
    return mockStore;
  },
}));

let mockFileText = '';
let mockWritten = '';
jest.mock('expo-file-system', () => {
  class File {
    constructor(public uri: string = '') {}
    text() {
      return Promise.resolve(mockFileText);
    }
    write(content: string) {
      mockWritten = content;
    }
  }
  class Directory {
    uri = 'file:///export/';
    static pickDirectoryAsync() {
      return Promise.resolve(new Directory());
    }
    list() {
      return [];
    }
    createFile() {
      return new File('file:///export/out.json');
    }
  }
  return { File, Directory };
});
jest.mock('expo-document-picker', () => ({
  getDocumentAsync: jest.fn(async () => ({ canceled: false, assets: [{ uri: 'file:///import.json' }] })),
}));
jest.mock('@/scripts/Logger', () => ({ logger: { log: jest.fn(), warn: jest.fn(), error: jest.fn() } }));

const progress = (updatedAt: number, position = 10) => ({ partPath: 'b/1.mp3', position, duration: 600, updatedAt });
const watchProgress = (updatedAt: number, position = 10) => ({ position, duration: 5400, updatedAt });
const importFile = (body: object) => {
  mockFileText = JSON.stringify({ smbVersion: 1, exportedAt: '2026-01-01T00:00:00.000Z', ...body });
  return importJson();
};
const current = () => mockStore.getState().libraryReducer.listenProgress;
const currentWatch = () => mockStore.getState().libraryReducer.watchProgress;

describe('importJson listenProgress', () => {
  beforeEach(() => {
    mockStore.dispatch(hydrateLibrary({ mediaLibrary: {}, movies: [], audiobooks: [], mediaOverrides: {}, thumbnails: {}, watched: {}, listenProgress: {}, watchProgress: {} }));
    mockStore.dispatch(setListenProgress({ folderKey: 'existing', progress: progress(500, 99) }));
    mockStore.dispatch(setWatchProgress({ key: 'm/existing.mkv', progress: watchProgress(500, 99) }));
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

  it('merges valid watchProgress entries and reports the section as applied', async () => {
    const { applied } = await importFile({ watchProgress: { 'm/fresh.mkv': watchProgress(100, 5) } });
    expect(applied).toContain('watchProgress');
    expect(currentWatch()['m/fresh.mkv']).toEqual(watchProgress(100, 5));
    expect(currentWatch()['m/existing.mkv']).toEqual(watchProgress(500, 99));
  });

  it('keeps whichever watchProgress side has the later updatedAt', async () => {
    await importFile({ watchProgress: { 'm/existing.mkv': watchProgress(100, 1) } });
    expect(currentWatch()['m/existing.mkv']).toEqual(watchProgress(500, 99));
    await importFile({ watchProgress: { 'm/existing.mkv': watchProgress(900, 7) } });
    expect(currentWatch()['m/existing.mkv']).toEqual(watchProgress(900, 7));
  });

  it('drops malformed or negative watchProgress entries and strips extra fields', async () => {
    await importFile({
      watchProgress: {
        stringPosition: { position: '1', duration: 2, updatedAt: 3 },
        nullDuration: { position: 1, duration: null, updatedAt: 3 },
        missingTime: { position: 1, duration: 2 },
        negativePosition: { position: -1, duration: 2, updatedAt: 3 },
        infinite: { position: Infinity, duration: 2, updatedAt: 3 },
        notObject: 'x',
        isNull: null,
        good: { position: 3, duration: 0, updatedAt: 10, extra: 'x' },
      },
    });
    expect(Object.keys(currentWatch()).sort()).toEqual(['good', 'm/existing.mkv']);
    expect(currentWatch().good).toEqual({ position: 3, duration: 0, updatedAt: 10 });
  });

  it('ignores a non-object watchProgress section', async () => {
    const { applied } = await importFile({ watchProgress: [watchProgress(1)] });
    expect(applied).not.toContain('watchProgress');
    expect(Object.keys(currentWatch())).toEqual(['m/existing.mkv']);
  });

  it('imports the videoPlayer setting, rejecting unknown values', async () => {
    await importFile({ settings: { videoPlayer: 'external' } });
    expect(mockStore.getState().settingsReducer.videoPlayer).toBe('external');
    await importFile({ settings: { videoPlayer: 'bogus' } });
    expect(mockStore.getState().settingsReducer.videoPlayer).toBe('external');
  });

  it('imports the audiobookPlayer setting, rejecting unknown values', async () => {
    await importFile({ settings: { audiobookPlayer: 'external' } });
    expect(mockStore.getState().settingsReducer.audiobookPlayer).toBe('external');
    await importFile({ settings: { audiobookPlayer: 'bogus' } });
    expect(mockStore.getState().settingsReducer.audiobookPlayer).toBe('external');
  });

  it('imports the audiobook speed and rewind settings, ignoring non-numbers and clamping', async () => {
    await importFile({ settings: { audiobookPlaybackRate: 1.5, audiobookRewindSeconds: 30 } });
    expect(mockStore.getState().settingsReducer.audiobookPlaybackRate).toBe(1.5);
    expect(mockStore.getState().settingsReducer.audiobookRewindSeconds).toBe(30);
    await importFile({ settings: { audiobookPlaybackRate: '2', audiobookRewindSeconds: null } });
    expect(mockStore.getState().settingsReducer.audiobookPlaybackRate).toBe(1.5);
    expect(mockStore.getState().settingsReducer.audiobookRewindSeconds).toBe(30);
    await importFile({ settings: { audiobookPlaybackRate: 9, audiobookRewindSeconds: 1000 } });
    expect(mockStore.getState().settingsReducer.audiobookPlaybackRate).toBe(2);
    expect(mockStore.getState().settingsReducer.audiobookRewindSeconds).toBe(300);
  });

  it('imports the preferred video languages, ignoring non-strings and empty strings', async () => {
    await importFile({ settings: { videoSubtitleLanguage: 'off', videoAudioLanguage: 'ja' } });
    expect(mockStore.getState().settingsReducer.videoSubtitleLanguage).toBe('off');
    expect(mockStore.getState().settingsReducer.videoAudioLanguage).toBe('ja');
    await importFile({ settings: { videoSubtitleLanguage: 5, videoAudioLanguage: '' } });
    expect(mockStore.getState().settingsReducer.videoSubtitleLanguage).toBe('off');
    expect(mockStore.getState().settingsReducer.videoAudioLanguage).toBe('ja');
    await importFile({ settings: { videoSubtitleLanguage: null } });
    expect(mockStore.getState().settingsReducer.videoSubtitleLanguage).toBeNull();
  });
});

describe('video feature and sidebar sort settings', () => {
  const settings = () => mockStore.getState().settingsReducer;

  it('imports the video feature toggles, ignoring non-booleans', async () => {
    await importFile({ settings: { videoShowProgressBar: false, videoTrackPickerEnabled: false, videoSpeedControlEnabled: false, showSidebarSort: true } });
    expect(settings().videoShowProgressBar).toBe(false);
    expect(settings().videoTrackPickerEnabled).toBe(false);
    expect(settings().videoSpeedControlEnabled).toBe(false);
    expect(settings().showSidebarSort).toBe(true);
    await importFile({ settings: { videoShowProgressBar: 'true', videoTrackPickerEnabled: 1, videoSpeedControlEnabled: null, showSidebarSort: 'no' } });
    expect(settings().videoShowProgressBar).toBe(false);
    expect(settings().videoTrackPickerEnabled).toBe(false);
    expect(settings().videoSpeedControlEnabled).toBe(false);
    expect(settings().showSidebarSort).toBe(true);
  });

  it('imports the video playback rate, clamping and ignoring non-finite values', async () => {
    await importFile({ settings: { videoPlaybackRate: 1.5 } });
    expect(settings().videoPlaybackRate).toBe(1.5);
    await importFile({ settings: { videoPlaybackRate: '2' } });
    expect(settings().videoPlaybackRate).toBe(1.5);
    await importFile({ settings: { videoPlaybackRate: null } });
    expect(settings().videoPlaybackRate).toBe(1.5);
    await importFile({ settings: { videoPlaybackRate: 9 } });
    expect(settings().videoPlaybackRate).toBe(2);
    await importFile({ settings: { videoPlaybackRate: 0.1 } });
    expect(settings().videoPlaybackRate).toBe(0.5);
  });

  it('imports the auto-play-next mode, rejecting unknown values', async () => {
    await importFile({ settings: { videoAutoPlayNext: 'countdown' } });
    expect(settings().videoAutoPlayNext).toBe('countdown');
    await importFile({ settings: { videoAutoPlayNext: 'bogus' } });
    expect(settings().videoAutoPlayNext).toBe('countdown');
    await importFile({ settings: { videoAutoPlayNext: 'off' } });
    expect(settings().videoAutoPlayNext).toBe('off');
    await importFile({ settings: { videoAutoPlayNext: 3 } });
    expect(settings().videoAutoPlayNext).toBe('off');
  });

  it('imports the sort order, rejecting unknown values', async () => {
    await importFile({ settings: { sortOrder: 'recentlyAdded' } });
    expect(settings().sortOrder).toBe('recentlyAdded');
    await importFile({ settings: { sortOrder: 'random' } });
    expect(settings().sortOrder).toBe('recentlyAdded');
    await importFile({ settings: { sortOrder: 7 } });
    expect(settings().sortOrder).toBe('recentlyAdded');
  });

  it('round-trips the new settings through an export', async () => {
    await importFile({
      settings: {
        sortOrder: 'lastOpened',
        showSidebarSort: true,
        videoShowProgressBar: false,
        videoTrackPickerEnabled: false,
        videoSpeedControlEnabled: false,
        videoPlaybackRate: 1.25,
        videoAutoPlayNext: 'countdown',
      },
    });
    await exportJson({ includeSettings: true, includeOverrides: false, includeWatched: false, includeMatches: false });
    const exported = JSON.parse(mockWritten).settings;
    expect(exported).toMatchObject({
      sortOrder: 'lastOpened',
      showSidebarSort: true,
      videoShowProgressBar: false,
      videoTrackPickerEnabled: false,
      videoSpeedControlEnabled: false,
      videoPlaybackRate: 1.25,
      videoAutoPlayNext: 'countdown',
    });

    // Change everything, then re-import the exported file to restore it.
    await importFile({
      settings: {
        sortOrder: 'alphabetical',
        showSidebarSort: false,
        videoShowProgressBar: true,
        videoTrackPickerEnabled: true,
        videoSpeedControlEnabled: true,
        videoPlaybackRate: 1,
        videoAutoPlayNext: 'off',
      },
    });
    await importFile({ settings: exported });
    expect(settings()).toMatchObject({
      sortOrder: 'lastOpened',
      showSidebarSort: true,
      videoShowProgressBar: false,
      videoTrackPickerEnabled: false,
      videoSpeedControlEnabled: false,
      videoPlaybackRate: 1.25,
      videoAutoPlayNext: 'countdown',
    });
  });
});
