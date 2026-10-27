import { personalBrowseLevel, personalSortKey, visiblePersonalVideos } from '../personalBrowse';
import type { IPersonalVideo } from '../personalLibrary';
import type { IMediaOverride } from '@/store/libraryReducer';

const video = (filename: string, folderPath: string[] = [], extra: Partial<IPersonalVideo> = {}): IPersonalVideo => {
  const title = filename.replace(/\.[^.]+$/, '');
  const parsedPath = [...folderPath, filename].join('/');
  return {
    ids: { tvdb: null, imdb: null, tmdb: null },
    episodeNumber: 0,
    title,
    scannedTitle: title,
    filename,
    path: `content://p/${encodeURIComponent(parsedPath)}`,
    parsedPath,
    isDirectory: false,
    poster: '',
    folderPath,
    ...extra,
  };
};

const names = (videos: readonly IPersonalVideo[]) => videos.map((v) => v.filename);

describe('visiblePersonalVideos', () => {
  it('drops unavailable videos and videos hidden through their personal: override', () => {
    const a = video('a.mp4');
    const b = video('b.mp4', [], { unavailable: true });
    const c = video('c.mp4');
    const overrides: { [k: string]: IMediaOverride } = { 'personal:c.mp4': { hidden: true } };
    expect(names(visiblePersonalVideos([a, b, c], overrides))).toEqual(['a.mp4']);
  });

  it('is not affected by a movie: override with the same path', () => {
    const a = video('a.mp4');
    expect(visiblePersonalVideos([a], { 'movie:a.mp4': { hidden: true } })).toEqual([a]);
  });
});

describe('personalSortKey', () => {
  it('prefers the sort title, then the display title', () => {
    const v = video('Lesson 2 [dQw4w9WgXcQ].mp4', [], { title: 'Lesson 2', resolvedTitle: 'Lesson Two' });
    expect(personalSortKey(v)).toBe('Lesson Two');
    expect(personalSortKey(v, { [`personal:${v.parsedPath}`]: { title: 'Mine' } })).toBe('Mine');
    expect(personalSortKey(v, { [`personal:${v.parsedPath}`]: { title: 'Mine', sortTitle: 'Aardvark' } })).toBe('Aardvark');
  });
});

describe('personalBrowseLevel', () => {
  const root = video('intro.mp4', [], { lastOpened: 5, firstDetected: 1 });
  const wc1 = video('wc1.mp4', ['Art', 'Watercolour'], { lastOpened: 50, firstDetected: 10 });
  const wc2 = video('wc2.mp4', ['Art', 'Watercolour'], { firstDetected: 30 });
  const sk = video('sketch.mp4', ['Art']);
  const home = video('birthday.mp4', ['Home']);
  const all = [root, wc1, wc2, sk, home];

  it('lists the top-level folders and root videos in the folders layout', () => {
    const level = personalBrowseLevel(all, 'folders', undefined);
    expect(level.folders.map((f) => f.name)).toEqual(['Art', 'Home']);
    expect(names(level.videos)).toEqual(['intro.mp4']);
  });

  it('treats an empty folder key as the top level', () => {
    expect(personalBrowseLevel(all, 'folders', '').folders.map((f) => f.folderKey)).toEqual(['Art', 'Home']);
  });

  it('descends into a folder key', () => {
    const level = personalBrowseLevel(all, 'folders', 'Art');
    expect(level.folders.map((f) => f.folderKey)).toEqual(['Art/Watercolour']);
    expect(names(level.videos)).toEqual(['sketch.mp4']);
    const inner = personalBrowseLevel(all, 'folders', 'Art/Watercolour');
    expect(inner.folders).toEqual([]);
    expect(names(inner.videos)).toEqual(['wc1.mp4', 'wc2.mp4']);
  });

  it('gives a folder the latest lastOpened and firstDetected of its subtree', () => {
    const art = personalBrowseLevel(all, 'folders', undefined).folders[0];
    expect(art.lastOpened).toBe(50);
    expect(art.firstDetected).toBe(30);
    expect(names(art.videos).sort()).toEqual(['sketch.mp4', 'wc1.mp4', 'wc2.mp4']);
    const homeFolder = personalBrowseLevel(all, 'folders', undefined).folders[1];
    expect(homeFolder.lastOpened).toBeUndefined();
    expect(homeFolder.firstDetected).toBeUndefined();
  });

  it('lists every visible video in one list in the flat layout', () => {
    const level = personalBrowseLevel(all, 'flat', 'Art');
    expect(level.folders).toEqual([]);
    expect(names(level.videos)).toEqual(['intro.mp4', 'wc1.mp4', 'wc2.mp4', 'sketch.mp4', 'birthday.mp4']);
  });

  it('omits hidden and unavailable videos, and folders left with nothing visible', () => {
    const overrides: { [k: string]: IMediaOverride } = { 'personal:Home/birthday.mp4': { hidden: true } };
    const withGone = [...all, video('old.mp4', ['Old'], { unavailable: true })];
    const level = personalBrowseLevel(withGone, 'folders', undefined, overrides);
    expect(level.folders.map((f) => f.name)).toEqual(['Art']);
    expect(names(personalBrowseLevel(withGone, 'flat', undefined, overrides).videos)).not.toContain('old.mp4');
  });
});
