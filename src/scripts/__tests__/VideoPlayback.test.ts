import { resolveVideoRequest } from '../VideoPlayback';
import type { IMediaObject } from '../libraryUtils';
import type { LibraryState } from '@/store/libraryReducer';

const file = (name: string, extra: Partial<IMediaObject> = {}): IMediaObject => ({
  ids: { tvdb: null, imdb: null, tmdb: null },
  episodeNumber: 0,
  title: name,
  filename: `${name}.mkv`,
  path: `content://tree/${name}.mkv`,
  parsedPath: `tree/${name}.mkv`,
  isDirectory: false,
  poster: '',
  ...extra,
} as IMediaObject);

const episode = (name: string, episodeNumber: number, extra: Partial<IMediaObject> = {}) =>
  file(name, { episodeNumber, ...extra });

const makeLibrary = (
  overrides: LibraryState['mediaOverrides'] = {},
): Pick<LibraryState, 'mediaLibrary' | 'movies' | 'mediaOverrides'> => ({
  movies: [file('Heat', { title: 'Heat' })],
  mediaLibrary: {
    Bluey: {
      ids: { tvdb: null, imdb: null, tmdb: null },
      title: 'Bluey',
      year: 2018,
      poster: '',
      seasons: {
        '2': {
          ids: { tvdb: null, imdb: null, tmdb: null },
          seasonNumber: 2,
          episodes: {
            '1': episode('bluey-s02e01', 1, { title: 'scanned', resolvedTitle: 'Dance Mode' }),
            '2': episode('bluey-special', 0, { title: 'Special' }),
          },
        },
      },
    },
  },
  mediaOverrides: overrides,
});

describe('resolveVideoRequest', () => {
  it('finds a movie by its library key', () => {
    expect(resolveVideoRequest(makeLibrary(), 'tree/Heat.mkv', '0')).toEqual({
      path: 'content://tree/Heat.mkv',
      parsedPath: 'tree/Heat.mkv',
      filename: 'Heat.mkv',
      title: 'Heat',
      startAt: 0,
    });
  });

  it('lets a title override win for a movie', () => {
    const library = makeLibrary({ 'movie:tree/Heat.mkv': { title: 'Heat (1995)' } });
    expect(resolveVideoRequest(library, 'tree/Heat.mkv', '0')?.title).toBe('Heat (1995)');
  });

  it('finds an episode and labels it like the flat browse view', () => {
    expect(resolveVideoRequest(makeLibrary(), 'tree/bluey-s02e01.mkv', '12.5')).toEqual({
      path: 'content://tree/bluey-s02e01.mkv',
      parsedPath: 'tree/bluey-s02e01.mkv',
      filename: 'bluey-s02e01.mkv',
      title: 'Bluey S02E01 - Dance Mode',
      startAt: 12.5,
    });
  });

  it('applies show and episode overrides to the label', () => {
    const library = makeLibrary({
      'show:Bluey': { title: 'Bluey!' },
      'episode:tree/bluey-s02e01.mkv': { title: 'Renamed' },
    });
    expect(resolveVideoRequest(library, 'tree/bluey-s02e01.mkv', '0')?.title).toBe('Bluey! S02E01 - Renamed');
  });

  it('uses no prefix for an episode without a number', () => {
    expect(resolveVideoRequest(makeLibrary(), 'tree/bluey-special.mkv', '0')?.title).toBe('Special');
  });

  it('returns null for a file the library does not have', () => {
    expect(resolveVideoRequest(makeLibrary(), 'tree/missing.mkv', '0')).toBeNull();
  });

  it('returns null without a library key', () => {
    expect(resolveVideoRequest(makeLibrary(), undefined, '0')).toBeNull();
    expect(resolveVideoRequest(makeLibrary(), '', '0')).toBeNull();
  });

  describe('startAt', () => {
    const startFor = (startAt: string | undefined) =>
      resolveVideoRequest(makeLibrary(), 'tree/Heat.mkv', startAt)?.startAt;

    it('parses a number', () => {
      expect(startFor('90')).toBe(90);
      expect(startFor('1423.75')).toBe(1423.75);
    });

    it('falls back to 0 for garbage, negatives and a missing value', () => {
      expect(startFor('abc')).toBe(0);
      expect(startFor('Infinity')).toBe(0);
      expect(startFor('NaN')).toBe(0);
      expect(startFor('-5')).toBe(0);
      expect(startFor(undefined)).toBe(0);
    });
  });
});
