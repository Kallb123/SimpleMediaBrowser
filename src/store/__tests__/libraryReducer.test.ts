import libraryReducer, {
  applyLibraryActions,
  setMediaLibrary,
  setMoviePoster,
  setMovies,
  updateMovieMetadata,
  updateShowMetadata,
} from '@/store/libraryReducer';
import type { IMediaShow } from '@/store/libraryReducer';
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
