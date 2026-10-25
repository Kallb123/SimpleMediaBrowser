import libraryReducer, {
  appendMovieBatch,
  applyLibraryActions,
  areAllWatched,
  clearAllOverrides,
  clearLibraryAndMovies,
  getAudiobookWatchKeys,
  getSeasonWatchKeys,
  getShowWatchKeys,
  hydrateLibrary,
  markUnwatched,
  markWatched,
  mergeEpisodeBatch,
  mergeWatched,
  setMediaLibrary,
  setMediaOverride,
  setMoviePoster,
  setMovies,
  updateMovieMetadata,
  updateShowMetadata,
} from '@/store/libraryReducer';
import type { IMediaAudiobook, IMediaShow } from '@/store/libraryReducer';
import type { IMediaObject } from '@/scripts/libraryUtils';

const NO_IDS = () => ({ tvdb: null, imdb: null, tmdb: null });

const show = (title: string): IMediaShow => ({ ids: NO_IDS(), title, year: 0, poster: '', seasons: {} });
const movie = (name: string): IMediaObject => ({
  ids: NO_IDS(),
  episodeNumber: 0,
  title: name,
  filename: `${name}.mkv`,
  path: `content://m/${name}.mkv`,
  parsedPath: `m/${name}.mkv`,
  isDirectory: false,
  poster: '',
});

describe('applyLibraryActions', () => {
  const seeded = () => {
    let state = libraryReducer(undefined, { type: '@@init' });
    state = libraryReducer(state, setMediaLibrary({ A: show('A'), B: show('B') }));
    return libraryReducer(state, setMovies([movie('m1'), movie('m2')]));
  };

  it('produces the same state as applying the actions one by one', () => {
    const actions = [
      updateShowMetadata({ showName: 'A', providerId: '1', source: 'tmdb', poster: 'file:///a.jpg', title: 'A!', year: 2001 }),
      updateShowMetadata({ showName: 'B', providerId: '2', source: 'tvdb', poster: 'file:///b.jpg' }),
      updateMovieMetadata({ path: 'content://m/m1.mkv', providerId: '9', source: 'tmdb', poster: 'file:///m1.jpg' }),
      setMoviePoster({ path: 'content://m/m2.mkv', poster: 'file:///m2.jpg' }),
    ];

    const sequential = actions.reduce(libraryReducer, seeded());
    const batched = libraryReducer(seeded(), applyLibraryActions(actions));

    expect(batched).toEqual(sequential);
    expect(batched.mediaLibrary.A.poster).toBe('file:///a.jpg');
    expect(batched.movies[1].poster).toBe('file:///m2.jpg');
  });

  it('applies later actions on top of earlier ones within the same batch', () => {
    const next = libraryReducer(seeded(), applyLibraryActions([
      updateShowMetadata({ showName: 'A', providerId: '1', source: 'tmdb', poster: 'file:///first.jpg' }),
      updateShowMetadata({ showName: 'A', providerId: '1', source: 'tmdb', poster: 'file:///second.jpg' }),
    ]));
    expect(next.mediaLibrary.A.poster).toBe('file:///second.jpg');
  });

  it('leaves untouched parts of the state referentially equal', () => {
    const before = seeded();
    const after = libraryReducer(before, applyLibraryActions([
      updateShowMetadata({ showName: 'A', providerId: '1', source: 'tmdb', poster: 'file:///a.jpg' }),
    ]));
    expect(after.mediaLibrary.B).toBe(before.mediaLibrary.B);
    expect(after.movies).toBe(before.movies);
  });

  it('is a no-op for an empty batch', () => {
    const before = seeded();
    expect(libraryReducer(before, applyLibraryActions([]))).toBe(before);
  });
});

describe('watched tracking', () => {
  const init = () => libraryReducer(undefined, { type: '@@init' });
  const episode = (n: number, parsedPath: string): IMediaObject => ({ ...movie(`ep${n}`), episodeNumber: n, parsedPath });

  it('starts empty', () => {
    expect(init().watched).toEqual({});
  });

  it('marks files watched with the given timestamp', () => {
    const next = libraryReducer(init(), markWatched({ keys: ['a/1.mkv', 'a/2.mkv'], watchedAt: 100 }));
    expect(next.watched).toEqual({ 'a/1.mkv': 100, 'a/2.mkv': 100 });
  });

  it('re-marking a file refreshes its timestamp', () => {
    let state = libraryReducer(init(), markWatched({ keys: ['a/1.mkv'], watchedAt: 100 }));
    state = libraryReducer(state, markWatched({ keys: ['a/1.mkv'], watchedAt: 200 }));
    expect(state.watched).toEqual({ 'a/1.mkv': 200 });
  });

  it('unmarks only the given files and ignores ones that were never marked', () => {
    let state = libraryReducer(init(), markWatched({ keys: ['a/1.mkv', 'a/2.mkv'], watchedAt: 100 }));
    state = libraryReducer(state, markUnwatched(['a/1.mkv', 'never/3.mkv']));
    expect(state.watched).toEqual({ 'a/2.mkv': 100 });
  });

  it('merges imported marks, keeping the later timestamp per file', () => {
    let state = libraryReducer(init(), markWatched({ keys: ['a/1.mkv', 'a/2.mkv'], watchedAt: 100 }));
    state = libraryReducer(state, mergeWatched({ 'a/1.mkv': 50, 'a/2.mkv': 300, 'a/3.mkv': 10 }));
    expect(state.watched).toEqual({ 'a/1.mkv': 100, 'a/2.mkv': 300, 'a/3.mkv': 10 });
  });

  it('supports marking a whole folder in one batched dispatch', () => {
    const keys = Array.from({ length: 300 }, (_, i) => `book/ch${i}.mp3`);
    const next = libraryReducer(init(), applyLibraryActions([markWatched({ keys, watchedAt: 1 })]));
    expect(Object.keys(next.watched)).toHaveLength(300);
  });

  describe('survives rescans', () => {
    it('is not touched when a scan clears and rebuilds the library', () => {
      let state = libraryReducer(init(), markWatched({ keys: ['m/m1.mkv', 'S/e1.mkv'], watchedAt: 5 }));
      state = libraryReducer(state, setMovies([movie('m1')]));
      state = libraryReducer(state, clearLibraryAndMovies());
      expect(state.movies).toEqual([]);
      state = libraryReducer(state, appendMovieBatch([movie('m1')]));
      state = libraryReducer(state, mergeEpisodeBatch([{
        showName: 'S', rawShowName: 'S', folderYear: 0, folderPoster: '', seasonKey: 's01', seasonNumber: 1,
        episodeKey: 'e01', episode: episode(1, 'S/e1.mkv'),
      }]));
      expect(state.watched).toEqual({ 'm/m1.mkv': 5, 'S/e1.mkv': 5 });
    });

    it('is not cleared by clearing overrides', () => {
      let state = libraryReducer(init(), markWatched({ keys: ['a/1.mkv'], watchedAt: 5 }));
      state = libraryReducer(state, setMediaOverride({ key: 'show:A', override: { title: 'A!' } }));
      state = libraryReducer(state, clearAllOverrides());
      expect(state.watched).toEqual({ 'a/1.mkv': 5 });
    });
  });

  describe('hydrateLibrary', () => {
    const payload = (watched?: Record<string, number>): any => ({
      mediaLibrary: {}, movies: [], audiobooks: [], mediaOverrides: {}, thumbnails: {}, watched,
    });

    it('restores persisted marks', () => {
      expect(libraryReducer(init(), hydrateLibrary(payload({ 'a/1.mkv': 7 }))).watched).toEqual({ 'a/1.mkv': 7 });
    });

    it('tolerates a payload without marks', () => {
      const state = libraryReducer(libraryReducer(init(), markWatched({ keys: ['x'], watchedAt: 1 })), hydrateLibrary(payload()));
      expect(state.watched).toEqual({});
    });
  });

  describe('folder helpers', () => {
    const season = (...paths: string[]) => ({
      ids: NO_IDS(),
      seasonNumber: 1,
      episodes: Object.fromEntries(paths.map((p, i) => [`e0${i + 1}`, episode(i + 1, p)])),
    });
    const showWith = (...seasons: ReturnType<typeof season>[]): IMediaShow => ({
      ...show('S'),
      seasons: Object.fromEntries(seasons.map((s, i) => [`s0${i + 1}`, s])),
    });

    it('lists the episodes of a season and of a show', () => {
      const s = showWith(season('a', 'b'), season('c'));
      expect(getSeasonWatchKeys(s.seasons.s01)).toEqual(['a', 'b']);
      expect(getShowWatchKeys(s)).toEqual(['a', 'b', 'c']);
    });

    it('skips episodes the user hid, so they cannot block a folder from reading as watched', () => {
      const s = showWith(season('a', 'b'));
      const overrides = { 'episode:b': { hidden: true } };
      expect(getSeasonWatchKeys(s.seasons.s01, overrides)).toEqual(['a']);
      expect(getShowWatchKeys(s, overrides)).toEqual(['a']);
    });

    it('lists only the audio parts of an audiobook', () => {
      const book = {
        files: [
          { path: 'c1', parsedPath: 'b/1.mp3', filename: '1.mp3' },
          { path: 'c2', parsedPath: 'b/cover.jpg', filename: 'cover.jpg' },
          { path: 'c3', parsedPath: 'b/2.m4b', filename: '2.m4b' },
        ],
      } as unknown as IMediaAudiobook;
      expect(getAudiobookWatchKeys(book)).toEqual(['b/1.mp3', 'b/2.m4b']);
    });

    it('areAllWatched needs every key and never counts an empty folder', () => {
      expect(areAllWatched({ a: 1, b: 2 }, ['a', 'b'])).toBe(true);
      expect(areAllWatched({ a: 1 }, ['a', 'b'])).toBe(false);
      expect(areAllWatched({ a: 1 }, [])).toBe(false);
    });
  });
});
