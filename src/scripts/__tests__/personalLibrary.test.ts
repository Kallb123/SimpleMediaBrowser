import {
  extractYoutubeId,
  matchPersonalSidecars,
  nextPersonalVideo,
  parseYtDlpInfoJson,
  personalDisplayTitle,
  personalFolderKey,
  personalFolderLevel,
  personalOverrideKey,
  personalTitleFromFilename,
  personalWatchKeys,
  type IPersonalVideo,
} from '../personalLibrary';
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

const ids = (videos: readonly IPersonalVideo[]) => videos.map((v) => v.filename);

describe('personalFolderKey / personalOverrideKey', () => {
  it('joins the folder path with "/" and uses "" for the root', () => {
    expect(personalFolderKey([])).toBe('');
    expect(personalFolderKey(['Art'])).toBe('Art');
    expect(personalFolderKey(['Art', 'Watercolour'])).toBe('Art/Watercolour');
  });

  it('namespaces override keys by parsedPath', () => {
    expect(personalOverrideKey('Art/a.mp4')).toBe('personal:Art/a.mp4');
  });
});

describe('extractYoutubeId', () => {
  it('reads the bracketed 11-character id of a yt-dlp filename', () => {
    expect(extractYoutubeId('Never Gonna Give You Up [dQw4w9WgXcQ].mp4')).toBe('dQw4w9WgXcQ');
  });

  it('accepts underscores and hyphens in the id', () => {
    expect(extractYoutubeId('Clip [a_b-c_d-e_f].webm')).toBe('a_b-c_d-e_f');
    expect(extractYoutubeId('Clip [-----------].mkv')).toBe('-----------');
  });

  it('works without an extension', () => {
    expect(extractYoutubeId('Clip [dQw4w9WgXcQ]')).toBe('dQw4w9WgXcQ');
  });

  it('ignores brackets that are not 11 id characters', () => {
    expect(extractYoutubeId('Movie [1080p].mp4')).toBeNull();
    expect(extractYoutubeId('Movie [ABCDEFGHIJ].mp4')).toBeNull(); // 10
    expect(extractYoutubeId('Movie [ABCDEFGHIJKL].mp4')).toBeNull(); // 12
    expect(extractYoutubeId('Movie [Official Video].mp4')).toBeNull(); // 14 incl. a space
    expect(extractYoutubeId('Movie [].mp4')).toBeNull();
  });

  it('only matches the form at the end of the base name', () => {
    expect(extractYoutubeId('[dQw4w9WgXcQ] Clip.mp4')).toBeNull();
    expect(extractYoutubeId('Clip [dQw4w9WgXcQ] part 2.mp4')).toBeNull();
    expect(extractYoutubeId('Clip (dQw4w9WgXcQ).mp4')).toBeNull();
    expect(extractYoutubeId('Clip dQw4w9WgXcQ.mp4')).toBeNull();
  });

  it('does not take the id from a longer bracketed run', () => {
    expect(extractYoutubeId('Clip [xdQw4w9WgXcQ].mp4')).toBeNull();
  });

  it('returns null for a plain filename', () => {
    expect(extractYoutubeId('Holiday 2019.mp4')).toBeNull();
    expect(extractYoutubeId('')).toBeNull();
  });
});

describe('personalTitleFromFilename', () => {
  it('drops the extension and the trailing youtube id', () => {
    expect(personalTitleFromFilename('Never Gonna Give You Up [dQw4w9WgXcQ].mp4')).toBe('Never Gonna Give You Up');
  });

  it('only drops the extension when there is no id', () => {
    expect(personalTitleFromFilename('Holiday 2019.mp4')).toBe('Holiday 2019');
    expect(personalTitleFromFilename('Drawing [1080p].mkv')).toBe('Drawing [1080p]');
  });

  it('keeps dots inside the title', () => {
    expect(personalTitleFromFilename('Lesson 1.5 - Shading [dQw4w9WgXcQ].mp4')).toBe('Lesson 1.5 - Shading');
  });

  it('trims surrounding whitespace', () => {
    expect(personalTitleFromFilename('  Clip   [dQw4w9WgXcQ] .mp4')).toBe('Clip');
  });

  it('falls back to the base name when only the id is left', () => {
    expect(personalTitleFromFilename('[dQw4w9WgXcQ].mp4')).toBe('[dQw4w9WgXcQ]');
  });
});

describe('matchPersonalSidecars', () => {
  it('finds an image named after the video, whatever its extension', () => {
    for (const ext of ['jpg', 'jpeg', 'png', 'webp']) {
      expect(matchPersonalSidecars('Clip.mp4', ['Clip.mp4', `Clip.${ext}`])).toEqual({ image: `Clip.${ext}` });
    }
  });

  it('finds the Kodi-style -thumb variant', () => {
    expect(matchPersonalSidecars('Clip.mp4', ['Clip.mp4', 'Clip-thumb.png'])).toEqual({ image: 'Clip-thumb.png' });
  });

  it('prefers the plain image over the -thumb one', () => {
    expect(matchPersonalSidecars('Clip.mp4', ['Clip-thumb.jpg', 'Clip.webp'])).toEqual({ image: 'Clip.webp' });
  });

  it('finds the yt-dlp info.json', () => {
    expect(matchPersonalSidecars('Clip [dQw4w9WgXcQ].mp4', ['Clip [dQw4w9WgXcQ].mp4', 'Clip [dQw4w9WgXcQ].info.json']))
      .toEqual({ infoJson: 'Clip [dQw4w9WgXcQ].info.json' });
  });

  it('finds both at once', () => {
    expect(matchPersonalSidecars('a.mkv', ['a.mkv', 'a.jpg', 'a.info.json'])).toEqual({ image: 'a.jpg', infoJson: 'a.info.json' });
  });

  it('matches case-insensitively and returns the sibling\'s real name', () => {
    expect(matchPersonalSidecars('Clip.MP4', ['CLIP.JPG', 'clip.INFO.JSON'])).toEqual({ image: 'CLIP.JPG', infoJson: 'clip.INFO.JSON' });
    expect(matchPersonalSidecars('clip.mp4', ['Clip-Thumb.PNG'])).toEqual({ image: 'Clip-Thumb.PNG' });
  });

  it('ignores files that belong to other videos or are not sidecars', () => {
    expect(matchPersonalSidecars('Clip.mp4', ['Clip 2.jpg', 'Clipper.jpg', 'Clip.txt', 'Clip.srt', 'other.info.json', 'Clip.gif'])).toEqual({});
  });

  it('returns nothing without siblings', () => {
    expect(matchPersonalSidecars('Clip.mp4', [])).toEqual({});
  });
});

describe('parseYtDlpInfoJson', () => {
  const info = (extra: object) => JSON.stringify({ id: 'dQw4w9WgXcQ', title: 'Never Gonna Give You Up', ...extra });

  it('reads a YouTube download by extractor_key', () => {
    expect(parseYtDlpInfoJson(info({
      extractor_key: 'Youtube',
      channel: 'Rick Astley',
      uploader: 'Someone Else',
      description: 'The official video',
      upload_date: '20091025',
    }))).toEqual({
      id: 'dQw4w9WgXcQ',
      isYoutube: true,
      title: 'Never Gonna Give You Up',
      channel: 'Rick Astley',
      description: 'The official video',
      uploadDate: '20091025',
    });
  });

  it('recognises YouTube by the extractor name', () => {
    expect(parseYtDlpInfoJson(info({ extractor: 'youtube' }))?.isYoutube).toBe(true);
  });

  it('recognises YouTube by webpage_url', () => {
    expect(parseYtDlpInfoJson(info({ webpage_url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' }))?.isYoutube).toBe(true);
    expect(parseYtDlpInfoJson(info({ webpage_url: 'https://youtu.be/dQw4w9WgXcQ' }))?.isYoutube).toBe(true);
    expect(parseYtDlpInfoJson(info({ webpage_url: 'https://m.youtube.com/watch?v=dQw4w9WgXcQ' }))?.isYoutube).toBe(true);
  });

  it('falls back to uploader when there is no channel', () => {
    expect(parseYtDlpInfoJson(info({ uploader: 'Rick' }))?.channel).toBe('Rick');
  });

  it('is not YouTube for other extractors, but still reads the metadata', () => {
    expect(parseYtDlpInfoJson(JSON.stringify({
      id: '123456789', title: 'Clip', extractor_key: 'Vimeo', uploader: 'Someone', webpage_url: 'https://vimeo.com/123456789',
    }))).toEqual({ id: '123456789', isYoutube: false, title: 'Clip', channel: 'Someone' });
  });

  it('does not mistake look-alike hosts for YouTube', () => {
    expect(parseYtDlpInfoJson(info({ webpage_url: 'https://notyoutube.com/watch?v=dQw4w9WgXcQ' }))?.isYoutube).toBe(false);
    expect(parseYtDlpInfoJson(info({ webpage_url: 'https://example.com/youtube.com' }))?.isYoutube).toBe(false);
  });

  it('is not YouTube when the id is not a YouTube id', () => {
    expect(parseYtDlpInfoJson(JSON.stringify({ id: 'short', extractor_key: 'Youtube' }))?.isYoutube).toBe(false);
    expect(parseYtDlpInfoJson(JSON.stringify({ extractor_key: 'Youtube', title: 'x' }))?.isYoutube).toBe(false);
  });

  it('leaves out missing, empty and wrongly typed fields', () => {
    expect(parseYtDlpInfoJson(JSON.stringify({
      id: 42, title: '  ', channel: 7, uploader: '', description: null, upload_date: '2009-10-25',
    }))).toEqual({ isYoutube: false });
    expect(parseYtDlpInfoJson('{}')).toEqual({ isYoutube: false });
  });

  it('trims strings', () => {
    expect(parseYtDlpInfoJson(info({ title: '  Padded  ' }))?.title).toBe('Padded');
  });

  it('returns null for text that is not a JSON object', () => {
    expect(parseYtDlpInfoJson('')).toBeNull();
    expect(parseYtDlpInfoJson('{not json')).toBeNull();
    expect(parseYtDlpInfoJson('[1, 2]')).toBeNull();
    expect(parseYtDlpInfoJson('null')).toBeNull();
    expect(parseYtDlpInfoJson('"text"')).toBeNull();
    expect(parseYtDlpInfoJson('12')).toBeNull();
  });
});

describe('personalFolderLevel', () => {
  const all = [
    video('root.mp4', []),
    video('b.mp4', ['Art']),
    video('a.mp4', ['Art']),
    video('deep.mp4', ['Art', 'Watercolour']),
    video('deeper.mp4', ['Art', 'Watercolour', 'Skies']),
    video('home.mp4', ['Home']),
    video('10.mp4', ['Lesson 10']),
    video('2.mp4', ['Lesson 2']),
  ];

  it('lists the root level: child folders with their whole subtree, and the videos at the root', () => {
    const level = personalFolderLevel(all, []);
    expect(ids(level.videos)).toEqual(['root.mp4']);
    expect(level.folders.map((f) => f.name)).toEqual(['Art', 'Home', 'Lesson 2', 'Lesson 10']);
    const art = level.folders[0];
    expect(art).toMatchObject({ folderKey: 'Art', folderPath: ['Art'] });
    expect(ids(art.videos).sort()).toEqual(['a.mp4', 'b.mp4', 'deep.mp4', 'deeper.mp4']);
  });

  it('descends into a folder', () => {
    const level = personalFolderLevel(all, ['Art']);
    expect(ids(level.videos)).toEqual(['b.mp4', 'a.mp4']);
    expect(level.folders).toHaveLength(1);
    expect(level.folders[0]).toMatchObject({ name: 'Watercolour', folderKey: 'Art/Watercolour', folderPath: ['Art', 'Watercolour'] });
    expect(ids(level.folders[0].videos)).toEqual(['deep.mp4', 'deeper.mp4']);
  });

  it('is empty for a folder without content or an unknown folder', () => {
    expect(personalFolderLevel(all, ['Home'])).toEqual({ folders: [], videos: [all[5]] });
    expect(personalFolderLevel(all, ['Nope'])).toEqual({ folders: [], videos: [] });
    expect(personalFolderLevel([], [])).toEqual({ folders: [], videos: [] });
  });

  it('merges same-named folders from different sources', () => {
    const fromA = video('one.mp4', ['Art'], { sourceUri: 'content://a' });
    const fromB = video('two.mp4', ['Art'], { sourceUri: 'content://b' });
    const level = personalFolderLevel([fromA, fromB], []);
    expect(level.folders).toHaveLength(1);
    expect(level.folders[0].videos).toEqual([fromA, fromB]);
  });

  it('keeps folder names case-sensitive (they are the keys of the folder posters)', () => {
    const level = personalFolderLevel([video('a.mp4', ['Art']), video('b.mp4', ['art'])], []);
    expect(level.folders.map((f) => f.name).sort()).toEqual(['Art', 'art']);
  });

  it('does not treat a folder whose name merely starts like another as inside it', () => {
    const level = personalFolderLevel([video('a.mp4', ['Art']), video('b.mp4', ['Art2'])], ['Art']);
    expect(level.folders).toEqual([]);
    expect(ids(level.videos)).toEqual(['a.mp4']);
  });
});

describe('personalWatchKeys', () => {
  const videos = [
    video('root.mp4', []),
    video('a.mp4', ['Art']),
    video('b.mp4', ['Art', 'Watercolour']),
    video('c.mp4', ['Art2']),
    video('d.mp4', ['Home']),
  ];

  it('returns every video for the root key', () => {
    expect(personalWatchKeys(videos, '')).toEqual(['root.mp4', 'Art/a.mp4', 'Art/Watercolour/b.mp4', 'Art2/c.mp4', 'Home/d.mp4']);
  });

  it('returns the whole subtree of a folder, not a sibling with the same prefix', () => {
    expect(personalWatchKeys(videos, 'Art')).toEqual(['Art/a.mp4', 'Art/Watercolour/b.mp4']);
    expect(personalWatchKeys(videos, 'Art/Watercolour')).toEqual(['Art/Watercolour/b.mp4']);
    expect(personalWatchKeys(videos, 'Home')).toEqual(['Home/d.mp4']);
  });

  it('skips hidden videos', () => {
    const overrides = { 'personal:Art/a.mp4': { hidden: true } };
    expect(personalWatchKeys(videos, 'Art', overrides)).toEqual(['Art/Watercolour/b.mp4']);
    expect(personalWatchKeys(videos, '', overrides)).not.toContain('Art/a.mp4');
  });

  it('is not affected by overrides that are not hiding', () => {
    expect(personalWatchKeys(videos, 'Art', { 'personal:Art/a.mp4': { title: 'x', hidden: false } })).toEqual(['Art/a.mp4', 'Art/Watercolour/b.mp4']);
  });

  it('returns nothing for an unknown folder', () => {
    expect(personalWatchKeys(videos, 'Nope')).toEqual([]);
  });
});

describe('personalDisplayTitle', () => {
  const v = video('Clip [dQw4w9WgXcQ].mp4', [], { title: 'Clip', resolvedTitle: 'Resolved Clip' });

  it('prefers the override, then the resolved title, then the filename title', () => {
    expect(personalDisplayTitle(v, { [personalOverrideKey(v.parsedPath)]: { title: 'Mine' } })).toBe('Mine');
    expect(personalDisplayTitle(v, {})).toBe('Resolved Clip');
    expect(personalDisplayTitle(v)).toBe('Resolved Clip');
    expect(personalDisplayTitle({ ...v, resolvedTitle: undefined })).toBe('Clip');
  });

  it('ignores overrides of other videos and overrides without a title', () => {
    expect(personalDisplayTitle(v, { 'personal:other.mp4': { title: 'Other' }, [personalOverrideKey(v.parsedPath)]: { sortTitle: 'z' } })).toBe('Resolved Clip');
  });
});

describe('nextPersonalVideo', () => {
  const folder = ['Course'];
  const lessons = ['Lesson 10.mp4', 'Lesson 2.mp4', 'Lesson 1.mp4'].map((f) => video(f, folder));
  const elsewhere = video('Lesson 3.mp4', ['Other']);
  const all = [...lessons, elsewhere, video('Lesson 0.mp4', [])];
  const key = (name: string) => `Course/${name}`;

  it('orders numerically, not lexically', () => {
    expect(nextPersonalVideo(all, key('Lesson 1.mp4'))?.filename).toBe('Lesson 2.mp4');
    expect(nextPersonalVideo(all, key('Lesson 2.mp4'))?.filename).toBe('Lesson 10.mp4');
  });

  it('returns null after the last video of the folder', () => {
    expect(nextPersonalVideo(all, key('Lesson 10.mp4'))).toBeNull();
  });

  it('stays in the same folder', () => {
    expect(nextPersonalVideo(all, 'Other/Lesson 3.mp4')).toBeNull();
    expect(nextPersonalVideo(all, 'Lesson 0.mp4')).toBeNull();
  });

  it('is case-insensitive', () => {
    const mixed = [video('b clip.mp4'), video('A clip.mp4'), video('c clip.mp4')];
    expect(nextPersonalVideo(mixed, 'A clip.mp4')?.filename).toBe('b clip.mp4');
    expect(nextPersonalVideo(mixed, 'b clip.mp4')?.filename).toBe('c clip.mp4');
  });

  it('orders by display title (override, then resolved title) rather than filename', () => {
    const vids = [
      video('x.mp4', [], { resolvedTitle: 'Part 2' }),
      video('y.mp4', [], { resolvedTitle: 'Part 1' }),
      video('z.mp4', [], { resolvedTitle: 'Part 10' }),
    ];
    expect(nextPersonalVideo(vids, 'y.mp4')?.filename).toBe('x.mp4');
    expect(nextPersonalVideo(vids, 'x.mp4')?.filename).toBe('z.mp4');
    const overrides: { [k: string]: IMediaOverride } = { 'personal:x.mp4': { title: 'Part 0' } };
    expect(nextPersonalVideo(vids, 'x.mp4', overrides)?.filename).toBe('y.mp4');
  });

  it('lets a sortTitle override decide the order', () => {
    const vids = [video('a.mp4'), video('b.mp4'), video('c.mp4')];
    const overrides: { [k: string]: IMediaOverride } = { 'personal:a.mp4': { sortTitle: 'zzz' }, 'personal:c.mp4': { sortTitle: '0' } };
    // Order: c (0), b, a (zzz)
    expect(nextPersonalVideo(vids, 'c.mp4', overrides)?.filename).toBe('b.mp4');
    expect(nextPersonalVideo(vids, 'b.mp4', overrides)?.filename).toBe('a.mp4');
    expect(nextPersonalVideo(vids, 'a.mp4', overrides)).toBeNull();
  });

  it('sortTitle wins over a title override', () => {
    const vids = [video('a.mp4'), video('b.mp4')];
    const overrides: { [k: string]: IMediaOverride } = { 'personal:a.mp4': { title: 'Aardvark', sortTitle: 'zzz' } };
    expect(nextPersonalVideo(vids, 'b.mp4', overrides)?.filename).toBe('a.mp4');
  });

  it('skips hidden videos', () => {
    const overrides: { [k: string]: IMediaOverride } = { [`personal:${key('Lesson 2.mp4')}`]: { hidden: true } };
    expect(nextPersonalVideo(all, key('Lesson 1.mp4'), overrides)?.filename).toBe('Lesson 10.mp4');
  });

  it('returns null when only hidden videos remain', () => {
    const overrides: { [k: string]: IMediaOverride } = { [`personal:${key('Lesson 10.mp4')}`]: { hidden: true } };
    expect(nextPersonalVideo(all, key('Lesson 2.mp4'), overrides)).toBeNull();
  });

  it('still finds the next video from a current video that is hidden', () => {
    const overrides: { [k: string]: IMediaOverride } = { [`personal:${key('Lesson 2.mp4')}`]: { hidden: true } };
    expect(nextPersonalVideo(all, key('Lesson 2.mp4'), overrides)?.filename).toBe('Lesson 10.mp4');
  });

  it('returns null for a video it does not know', () => {
    expect(nextPersonalVideo(all, 'nope.mp4')).toBeNull();
    expect(nextPersonalVideo([], 'nope.mp4')).toBeNull();
  });

  it('breaks title ties by filename so the order is stable', () => {
    const vids = [video('b.mp4', [], { resolvedTitle: 'Same' }), video('a.mp4', [], { resolvedTitle: 'Same' })];
    expect(nextPersonalVideo(vids, 'a.mp4')?.filename).toBe('b.mp4');
    expect(nextPersonalVideo(vids, 'b.mp4')).toBeNull();
  });

  it('does not reorder the input', () => {
    const input = [...lessons];
    nextPersonalVideo(input, key('Lesson 1.mp4'));
    expect(input).toEqual(lessons);
  });
});
