import { preferredTrack, resolveVideoRequest, sameTrack, trackLabel, trackLabels, unsupportedVideoTrack } from '../VideoPlayback';
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

describe('unsupportedVideoTrack', () => {
  const track = (isSupported: boolean | undefined, mimeType: string | null = 'video/hevc') =>
    ({ isSupported, mimeType }) as Parameters<typeof unsupportedVideoTrack>[0][number];

  it('is not a problem without any tracks', () => {
    expect(unsupportedVideoTrack([])).toBeNull();
  });

  it('is not a problem when one track is supported', () => {
    expect(unsupportedVideoTrack([track(false), track(true, 'video/avc')])).toBeNull();
  });

  it('returns the first mime type when every track is unsupported', () => {
    expect(unsupportedVideoTrack([track(false, 'video/hevc'), track(false, 'video/mpeg2')])).toBe('video/hevc');
  });

  it('falls back to "unknown" without a mime type', () => {
    expect(unsupportedVideoTrack([track(false, null)])).toBe('unknown');
  });

  it('treats an undefined isSupported (not Android) as supported', () => {
    expect(unsupportedVideoTrack([track(undefined)])).toBeNull();
    expect(unsupportedVideoTrack([track(false), track(undefined)])).toBeNull();
  });
});

describe('preferredTrack', () => {
  const track = (language: string, extra: { id?: string; label?: string; name?: string } = {}) => ({ language, label: language, ...extra });

  it('finds the track with the remembered language', () => {
    const tracks = [track('en'), track('fr'), track('de')];
    expect(preferredTrack(tracks, 'fr')).toBe(tracks[1]);
  });

  it('compares case-insensitively', () => {
    const tracks = [track('en'), track('FR')];
    expect(preferredTrack(tracks, 'fr')).toBe(tracks[1]);
    expect(preferredTrack(tracks, 'EN')).toBe(tracks[0]);
  });

  it('returns the first of several tracks in the same language', () => {
    const tracks = [track('en', { id: 'a' }), track('en', { id: 'b' })];
    expect(preferredTrack(tracks, 'en')).toBe(tracks[0]);
  });

  it('prefers an exact code over a regional variant', () => {
    const tracks = [track('en-GB'), track('en')];
    expect(preferredTrack(tracks, 'en')).toBe(tracks[1]);
  });

  it('falls back to the primary subtag in either direction', () => {
    const tracks = [track('de'), track('en-GB')];
    expect(preferredTrack(tracks, 'en')).toBe(tracks[1]);
    expect(preferredTrack(tracks, 'en_US')).toBe(tracks[1]);
    expect(preferredTrack([track('en')], 'en-GB')).not.toBeNull();
  });

  it('returns null when nothing matches or there is nothing to match', () => {
    expect(preferredTrack([track('en')], 'ja')).toBeNull();
    expect(preferredTrack([], 'en')).toBeNull();
    expect(preferredTrack([track('en')], '')).toBeNull();
    expect(preferredTrack([track('')], 'en')).toBeNull();
  });
});

describe('sameTrack', () => {
  it('compares by id when both have one', () => {
    expect(sameTrack({ id: '1', language: 'en', label: 'English' }, { id: '1', language: 'fr', label: 'x' })).toBe(true);
    expect(sameTrack({ id: '1', language: 'en', label: 'English' }, { id: '2', language: 'en', label: 'English' })).toBe(false);
  });

  it('compares language, label and name without ids', () => {
    expect(sameTrack({ language: 'en', label: 'English', name: 'SDH' }, { language: 'en', label: 'English', name: 'SDH' })).toBe(true);
    expect(sameTrack({ language: 'en', label: 'English', name: 'SDH' }, { language: 'en', label: 'English' })).toBe(false);
  });

  it('never matches a missing track', () => {
    expect(sameTrack(null, null)).toBe(false);
    expect(sameTrack({ language: 'en', label: 'English' }, null)).toBe(false);
  });
});

describe('trackLabel', () => {
  it('prefers the label, then the name, then the language', () => {
    expect(trackLabel({ label: 'English', name: 'eng-1', language: 'en' })).toBe('English');
    expect(trackLabel({ label: '', name: 'Commentary', language: 'en' })).toBe('Commentary');
    expect(trackLabel({ label: ' ', language: 'en' })).toBe('en');
  });

  it('falls back to "Unknown" when the track says nothing about itself', () => {
    expect(trackLabel({ label: '', language: '' })).toBe('Unknown');
  });
});

describe('trackLabels', () => {
  it('leaves distinct labels alone', () => {
    expect(trackLabels([
      { label: 'English', language: 'en' },
      { label: 'French', language: 'fr' },
    ])).toEqual(['English', 'French']);
  });

  it('appends the name to tracks that would read the same', () => {
    expect(trackLabels([
      { label: 'English', name: 'Stereo', language: 'en' },
      { label: 'English', name: 'Commentary', language: 'en' },
      { label: 'French', name: 'Stereo', language: 'fr' },
    ])).toEqual(['English - Stereo', 'English - Commentary', 'French']);
  });

  it('numbers tracks that stay identical', () => {
    expect(trackLabels([
      { label: 'English', language: 'en' },
      { label: 'English', language: 'en' },
      { label: 'English', name: 'English', language: 'en' },
    ])).toEqual(['English 1', 'English 2', 'English 3']);
  });
});
