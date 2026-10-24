import { FileScanner } from '@/scripts/FileScanner';
import type { SmbJsonData } from '@/scripts/SmbTypes';

// FileScanner imports native-backed modules at the top level; stub them so the module loads
// under Jest. None of the methods tested here touch video or image APIs, and the scanner is
// not wired to a store (only the pure build* methods are exercised).
jest.mock('expo-video', () => ({ createVideoPlayer: jest.fn() }));
jest.mock('expo-image-manipulator', () => ({ ImageManipulator: {}, SaveFormat: {} }));
jest.mock('@/scripts/Logger', () => ({
  logger: { log: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

type ScannedFile = Parameters<FileScanner['buildLibrary']>[0][number];

const NOW = 1_700_000_000_000;

/** Builds a scanned file as `recursiveCollect` would: `parts` are the folders under the source root. */
const scanned = (parts: string[], filename: string, extra: Partial<ScannedFile> = {}): ScannedFile => {
  const rel = [...parts, filename].join('/');
  return {
    ids: { tvdb: null, imdb: null, tmdb: null },
    episodeNumber: 0,
    title: filename,
    filename,
    path: `content://tree/${rel}`,
    parsedPath: `tree/${rel}`,
    isDirectory: false,
    poster: '',
    relativePathParts: parts,
    ...extra,
  };
};

describe('FileScanner', () => {
  let scanner: FileScanner;

  beforeEach(() => {
    jest.spyOn(Date, 'now').mockReturnValue(NOW);
    scanner = new FileScanner();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('buildLibrary', () => {
    it('groups episodes into shows and seasons using the filename', () => {
      const library = scanner.buildLibrary([
        scanned(['Bluey', 'Season 1'], 'Bluey.S01E01.Magic Xylophone.mkv'),
        scanned(['Bluey', 'Season 1'], 'Bluey.S01E02.Hospital.mkv'),
        scanned(['Bluey', 'Season 2'], 'Bluey.S02E01.Dance Mode.mkv'),
        scanned(['Lost'], 'Lost.1x05.White Rabbit.mkv'),
      ]);

      expect(Object.keys(library).sort()).toEqual(['Bluey', 'Lost']);
      expect(Object.keys(library.Bluey.seasons)).toEqual(['s01', 's02']);
      expect(Object.keys(library.Bluey.seasons.s01.episodes)).toEqual(['e01', 'e02']);
      expect(library.Bluey.seasons.s01.seasonNumber).toBe(1);
      expect(library.Bluey.seasons.s02.seasonNumber).toBe(2);
      expect(Object.keys(library.Lost.seasons.s01.episodes)).toEqual(['e05']);
    });

    it('builds the episode objects from the scanned file', () => {
      const library = scanner.buildLibrary([
        scanned(['Bluey', 'Season 1'], 'Bluey.S01E02.Hospital.mkv', { sourceUri: 'content://tree', metadataSource: 'tvdb' }),
      ]);

      const ep = library.Bluey.seasons.s01.episodes.e02;
      expect(ep).toEqual({
        ids: { tvdb: null, imdb: null, tmdb: null },
        episodeNumber: 2,
        title: 'Hospital',
        scannedTitle: 'Hospital',
        filename: 'Bluey.S01E02.Hospital.mkv',
        path: 'content://tree/Bluey/Season 1/Bluey.S01E02.Hospital.mkv',
        parsedPath: 'tree/Bluey/Season 1/Bluey.S01E02.Hospital.mkv',
        isDirectory: false,
        poster: '',
        sourceUri: 'content://tree',
        metadataSource: 'tvdb',
        firstDetected: NOW,
      });
      // The scanner-internal field never reaches the stored object.
      expect(ep).not.toHaveProperty('relativePathParts');
    });

    it('creates the show entry with empty ids/poster, and stamps source info from the first file', () => {
      const library = scanner.buildLibrary([
        scanned(['Bluey'], 'Bluey.S01E01.mkv', { sourceUri: 'content://tree', metadataSource: 'tvdb' }),
      ]);

      expect(library.Bluey).toMatchObject({
        ids: { tvdb: null, imdb: null, tmdb: null },
        title: 'Bluey',
        year: 0,
        poster: '',
        rawNames: [],
        metadataSource: 'tvdb',
        sourceUri: 'content://tree',
      });
    });

    it('falls back to the episode filename as the title when it has none', () => {
      const library = scanner.buildLibrary([scanned(['Bluey'], 'Bluey.S01E01.mkv')]);
      expect(library.Bluey.seasons.s01.episodes.e01.title).toBe('Bluey.S01E01.mkv');
      expect(library.Bluey.seasons.s01.episodes.e01.scannedTitle).toBe('Bluey.S01E01.mkv');
    });

    it('normalises year-suffixed folder names and merges them with the bare name', () => {
      const posters = new Map([['Bluey (2018)', 'file:///posters/bluey.jpg']]);
      const library = scanner.buildLibrary([
        scanned(['Bluey (2018)', 'Season 1'], 'Bluey (2018) - S01E01.mkv'),
        scanned(['Bluey', 'Season 2'], 'Bluey - S02E01.mkv'),
        scanned(['Bluey [2018]'], 'Bluey [2018] - S03E01.mkv'),
      ], posters);

      expect(Object.keys(library)).toEqual(['Bluey']);
      expect(library.Bluey.year).toBe(2018);
      expect(library.Bluey.rawNames).toEqual(['Bluey (2018)', 'Bluey [2018]']);
      expect(Object.keys(library.Bluey.seasons).sort()).toEqual(['s01', 's02', 's03']);
      // The poster is looked up by the raw folder name of the first file.
      expect(library.Bluey.poster).toBe('file:///posters/bluey.jpg');
    });

    it('back-fills the year when the first file for a show had none', () => {
      const library = scanner.buildLibrary([
        scanned(['Bluey'], 'Bluey.S01E01.mkv'),
        scanned(['Bluey (2018)'], 'Bluey (2018).S01E02.mkv'),
      ]);
      expect(library.Bluey.year).toBe(2018);
      expect(library.Bluey.rawNames).toEqual(['Bluey (2018)']);
    });

    it('does not overwrite an already-set year, and does not duplicate raw names', () => {
      const library = scanner.buildLibrary([
        scanned(['Show (2018)'], 'Show (2018) S01E01.mkv'),
        scanned(['Show (2018)'], 'Show (2018) S01E02.mkv'),
        scanned(['Show (2020)'], 'Show (2020) S01E03.mkv'),
      ]);
      expect(library.Show.year).toBe(2018);
      expect(library.Show.rawNames).toEqual(['Show (2018)', 'Show (2020)']);
    });

    it('prefers filename parsing over folder structure', () => {
      const library = scanner.buildLibrary([
        scanned(['Wrong Folder', 'Season 9'], 'Right Show.S01E02.Title.mkv'),
      ]);

      expect(Object.keys(library)).toEqual(['Right Show']);
      expect(Object.keys(library['Right Show'].seasons)).toEqual(['s01']);
      expect(Object.keys(library['Right Show'].seasons.s01.episodes)).toEqual(['e02']);
    });

    it('infers show/season/episode from the folders when the filename is not parseable', () => {
      const library = scanner.buildLibrary([
        scanned(['Bluey', 'Season 2'], 'E05.The Sign.mkv'),
        scanned(['Bluey'], 'ep3.Pilot.mkv'),
      ]);

      expect(library.Bluey.seasons.s02.episodes.e05.title).toBe('E05 The Sign');
      expect(library.Bluey.seasons.s02.episodes.e05.episodeNumber).toBe(5);
      expect(library.Bluey.seasons.s01.episodes.e03.title).toBe('ep3 Pilot');
    });

    it('skips files that sit in the root with an unparseable name', () => {
      const library = scanner.buildLibrary([scanned([], 'random movie file.mkv')]);
      expect(library).toEqual({});
    });

    it('still parses a root-level file whose name carries the show/season/episode', () => {
      const library = scanner.buildLibrary([scanned([], 'Lost.S02E03.Title.mkv')]);
      expect(Object.keys(library)).toEqual(['Lost']);
      expect(library.Lost.seasons.s02.episodes.e03.title).toBe('Title');
    });

    it('keeps the first episode when two files map to the same season/episode key', () => {
      const library = scanner.buildLibrary([
        scanned(['Show'], 'Show.S01E01.First.mkv'),
        scanned(['Show'], 'Show.S01E01.Second.mkv'),
      ]);
      expect(Object.keys(library.Show.seasons.s01.episodes)).toEqual(['e01']);
      expect(library.Show.seasons.s01.episodes.e01.title).toBe('First');
    });

    // NOTE: suspected limitation - files with no recognisable episode number all land on "e00",
    // so only the first of them is kept and the rest silently disappear from the library.
    it('collapses files with no detectable episode number onto e00 (first wins)', () => {
      const library = scanner.buildLibrary([
        scanned(['Show', 'Season 1'], 'Pilot.mkv'),
        scanned(['Show', 'Season 1'], 'Second.mkv'),
      ]);
      expect(Object.keys(library.Show.seasons.s01.episodes)).toEqual(['e00']);
      expect(library.Show.seasons.s01.episodes.e00.title).toBe('Pilot');
    });

    it('pads season and episode keys to two digits and leaves wider numbers alone', () => {
      const library = scanner.buildLibrary([
        scanned(['Anime'], 'Anime.S01E105.mkv'),
        scanned(['Anime'], 'Anime.S12E07.mkv'),
      ]);
      expect(Object.keys(library.Anime.seasons).sort()).toEqual(['s01', 's12']);
      expect(Object.keys(library.Anime.seasons.s01.episodes)).toEqual(['e105']);
      expect(Object.keys(library.Anime.seasons.s12.episodes)).toEqual(['e07']);
    });

    describe('smb.json sidecar data', () => {
      const showSmb = (extra: Partial<Extract<SmbJsonData, { type: 'show' }>> = {}): SmbJsonData => ({
        smbVersion: 1,
        type: 'show',
        ids: { tmdb: '82728', tvdb: null, imdb: 'tt7678620' },
        metadataSource: 'tmdb',
        ...extra,
      });

      it('seeds provider ids and metadata source from the folder\'s smb.json', () => {
        const library = scanner.buildLibrary(
          [scanned(['Bluey'], 'Bluey.S01E01.mkv')],
          undefined,
          new Map([['Bluey', showSmb()]]),
        );

        expect(library.Bluey.ids).toEqual({ tmdb: '82728', tvdb: null, imdb: 'tt7678620' });
        expect(library.Bluey.metadataSource).toBe('tmdb');
      });

      it('does not override a metadata source stamped from the scan source', () => {
        const library = scanner.buildLibrary(
          [scanned(['Bluey'], 'Bluey.S01E01.mkv', { metadataSource: 'tvdb' })],
          undefined,
          new Map([['Bluey', showSmb()]]),
        );
        expect(library.Bluey.metadataSource).toBe('tvdb');
      });

      it('applies smb.json episode titles as resolvedTitle', () => {
        const library = scanner.buildLibrary(
          [scanned(['Bluey'], 'Bluey.S01E01.mkv')],
          undefined,
          new Map([['Bluey', showSmb({ seasons: { s01: { episodes: { e01: { title: 'Magic Xylophone' } } } } })]]),
        );
        expect(library.Bluey.seasons.s01.episodes.e01.resolvedTitle).toBe('Magic Xylophone');
      });

      it('ignores smb.json data of the wrong type or for another folder', () => {
        const movieSmb: SmbJsonData = { smbVersion: 1, type: 'movie', ids: { tmdb: '1', tvdb: null, imdb: null } };
        const library = scanner.buildLibrary(
          [scanned(['Bluey'], 'Bluey.S01E01.mkv')],
          undefined,
          new Map<string, SmbJsonData>([['Bluey', movieSmb], ['Other', showSmb()]]),
        );
        expect(library.Bluey.ids).toEqual({ tvdb: null, imdb: null, tmdb: null });
      });

      it('applies episode thumbnails found next to the media files', () => {
        const thumbs = new Map([['Bluey', new Map([['s01:e01', 'file:///thumbs/s01e01.jpg']])]]);
        const library = scanner.buildLibrary(
          [scanned(['Bluey'], 'Bluey.S01E01.mkv'), scanned(['Bluey'], 'Bluey.S01E02.mkv')],
          undefined,
          undefined,
          thumbs,
        );
        expect(library.Bluey.seasons.s01.episodes.e01.resolvedThumbnail).toBe('file:///thumbs/s01e01.jpg');
        expect(library.Bluey.seasons.s01.episodes.e02.resolvedThumbnail).toBeUndefined();
      });
    });
  });

  describe('buildMovieList', () => {
    it('prefers the folder name as the title when the file sits in exactly one folder', () => {
      const [movie] = scanner.buildMovieList([scanned(['The.Matrix_1999'], 'movie-file.mkv')]);
      expect(movie.title).toBe('The Matrix 1999');
    });

    it('keeps a year in a folder title and strips separators', () => {
      const [movie] = scanner.buildMovieList([scanned(['Heat (1995)'], 'heat.mkv')]);
      expect(movie.title).toBe('Heat (1995)');
    });

    it('uses the filename for root-level and deeper-nested files', () => {
      const [root, nested] = scanner.buildMovieList([
        scanned([], 'Alien.1979.mkv'),
        scanned(['Alien Collection', 'Extras'], 'Deleted_Scenes.mkv'),
      ]);
      expect(root.title).toBe('Alien 1979');
      expect(nested.title).toBe('Deleted Scenes');
    });

    it('applies the folder poster only for files inside a folder, and defaults to empty', () => {
      const posters = new Map([['Heat (1995)', 'file:///heat.jpg']]);
      const [inFolder, root, otherFolder] = scanner.buildMovieList([
        scanned(['Heat (1995)'], 'heat.mkv'),
        scanned([], 'Heat.mkv'),
        scanned(['Ronin'], 'ronin.mkv'),
      ], posters);
      expect(inFolder.poster).toBe('file:///heat.jpg');
      expect(root.poster).toBe('');
      expect(otherFolder.poster).toBe('');
    });

    it('drops relativePathParts, stamps firstDetected and preserves the rest', () => {
      const [movie] = scanner.buildMovieList([
        scanned(['Heat'], 'heat.mkv', { sourceUri: 'content://tree', metadataSource: 'tmdb' }),
      ]);
      expect(movie).not.toHaveProperty('relativePathParts');
      expect(movie).toMatchObject({
        filename: 'heat.mkv',
        path: 'content://tree/Heat/heat.mkv',
        sourceUri: 'content://tree',
        metadataSource: 'tmdb',
        firstDetected: NOW,
      });
    });

    it('returns an empty list for no files', () => {
      expect(scanner.buildMovieList([])).toEqual([]);
    });

    describe('smb.json sidecar data', () => {
      const movieSmb = (ids: { tmdb: string | null; tvdb: string | null; imdb: string | null }): SmbJsonData =>
        ({ smbVersion: 1, type: 'movie', ids });

      it('seeds provider ids from the folder\'s smb.json', () => {
        const [movie] = scanner.buildMovieList(
          [scanned(['Heat'], 'heat.mkv')],
          undefined,
          new Map([['Heat', movieSmb({ tmdb: '949', tvdb: '12', imdb: 'tt0113277' })]]),
        );
        expect(movie.ids).toEqual({ tmdb: '949', tvdb: '12', imdb: 'tt0113277' });
      });

      it('does not apply ids from a show-type smb.json or for root-level files', () => {
        const showSmb: SmbJsonData = { smbVersion: 1, type: 'show', ids: { tmdb: '1', tvdb: null, imdb: null } };
        const smb = new Map<string, SmbJsonData>([['Heat', showSmb], ['', movieSmb({ tmdb: '2', tvdb: null, imdb: null })]]);
        const [wrongType, root] = scanner.buildMovieList(
          [scanned(['Heat'], 'heat.mkv'), scanned([], 'root.mkv')],
          undefined,
          smb,
        );
        expect(wrongType.ids.tmdb).toBeNull();
        expect(root.ids.tmdb).toBeNull();
      });

      it('keeps ids already present on the scanned file', () => {
        const [movie] = scanner.buildMovieList(
          [scanned(['Heat'], 'heat.mkv', { ids: { tvdb: null, imdb: null, tmdb: 'existing' } })],
          undefined,
          new Map([['Heat', movieSmb({ tmdb: '949', tvdb: null, imdb: null })]]),
        );
        expect(movie.ids.tmdb).toBe('existing');
      });
    });
  });

  describe('buildAudiobookList', () => {
    it('groups the files of one folder into a single audiobook, naturally ordered', () => {
      const books = scanner.buildAudiobookList([
        scanned(['Dune'], 'Part 10.mp3'),
        scanned(['Dune'], 'Part 2.mp3'),
        scanned(['Dune'], 'Part 1.mp3'),
      ]);

      expect(books).toHaveLength(1);
      expect(books[0].title).toBe('Dune');
      expect(books[0].scannedTitle).toBe('Dune');
      expect(books[0].folderKey).toBe('Dune');
      expect(books[0].files.map((f) => f.filename)).toEqual(['Part 1.mp3', 'Part 2.mp3', 'Part 10.mp3']);
      expect(books[0].path).toBe('content://tree/Dune/Part 1.mp3');
      expect(books[0].files[0]).toEqual({
        path: 'content://tree/Dune/Part 1.mp3',
        parsedPath: 'tree/Dune/Part 1.mp3',
        filename: 'Part 1.mp3',
      });
      expect(books[0].ids).toEqual({ itunes: null });
      expect(books[0].firstDetected).toBe(NOW);
    });

    it('makes each root-level file its own audiobook keyed by "::<name>"', () => {
      const books = scanner.buildAudiobookList([
        scanned([], 'The_Hobbit.m4b'),
        scanned([], 'Emma.mp3'),
      ]);

      expect(books.map((b) => b.folderKey)).toEqual(['::The_Hobbit', '::Emma']);
      expect(books.map((b) => b.title)).toEqual(['The Hobbit', 'Emma']);
      expect(books.every((b) => b.files.length === 1)).toBe(true);
    });

    it('keys nested folders by their full relative path and titles them by the last segment', () => {
      const books = scanner.buildAudiobookList([
        scanned(['Herbert', 'Dune_Messiah'], '01.mp3'),
        scanned(['Herbert', 'Dune'], '01.mp3'),
      ]);

      expect(books.map((b) => b.folderKey)).toEqual(['Herbert/Dune_Messiah', 'Herbert/Dune']);
      expect(books.map((b) => b.title)).toEqual(['Dune Messiah', 'Dune']);
    });

    it('preserves first-seen order of folders', () => {
      const books = scanner.buildAudiobookList([
        scanned(['B'], '1.mp3'),
        scanned(['A'], '1.mp3'),
        scanned(['B'], '2.mp3'),
      ]);
      expect(books.map((b) => b.folderKey)).toEqual(['B', 'A']);
      expect(books[0].files).toHaveLength(2);
    });

    it('applies the folder poster by relative folder path, and the source uri of the first file', () => {
      const books = scanner.buildAudiobookList([
        scanned(['Herbert', 'Dune'], '01.mp3', { sourceUri: 'content://tree' }),
        scanned([], 'Loose.mp3'),
      ], new Map([['Herbert/Dune', 'file:///dune.jpg'], ['', 'file:///should-not-apply.jpg']]));

      expect(books[0].poster).toBe('file:///dune.jpg');
      expect(books[0].sourceUri).toBe('content://tree');
      expect(books[1].poster).toBe('');
    });

    it('returns an empty list for no files', () => {
      expect(scanner.buildAudiobookList([])).toEqual([]);
    });
  });
});
