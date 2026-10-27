import { configureStore } from '@reduxjs/toolkit';
import { FileScanner } from '@/scripts/FileScanner';
import type { SmbJsonData } from '@/scripts/SmbTypes';
import libraryReducer, { setPersonal, setPersonalFolderPosters } from '@/store/libraryReducer';
import scanReducer from '@/store/scanReducer';
import settingsReducer, { setEnablePosterFetching, setEnableThumbnailGeneration, setTmdbApiKey } from '@/store/settingsReducer';
import type { IMediaSource } from '@/store/settingsReducer';
import { setLibrarySink } from '@/scripts/librarySink';
import type { LibrarySink } from '@/scripts/librarySink';
import type { IPersonalVideo } from '@/scripts/personalLibrary';

// FileScanner imports native-backed modules at the top level; stub them so the module loads
// under Jest. The pure build* tests never touch video, image or file APIs; the scanAllSources
// tests below drive an in-memory SAF tree (`mockFs`) through a store built from the real reducers.
jest.mock('expo-video', () => ({ createVideoPlayer: jest.fn() }));
jest.mock('expo-image-manipulator', () => ({ ImageManipulator: {}, SaveFormat: {} }));
jest.mock('@/scripts/Logger', () => ({
  logger: { log: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

/** In-memory stand-in for SAF and the app's document directory. */
const mockFs = {
  /** SAF directory uri → its child entry uris. A directory that is absent cannot be read. */
  dirs: new Map<string, string[]>(),
  /** SAF file uri → its text content. */
  texts: new Map<string, string>(),
  /** Local uris for which `new File(uri).exists` is true. */
  existing: new Set<string>(),
  /** [source, destination] of every File.copy. */
  copied: [] as [string, string][],
};
jest.mock('expo-file-system', () => {
  class MockFile {
    uri: string;
    constructor(base: string | { uri: string }, name?: string) {
      const root = typeof base === 'string' ? base : base.uri;
      this.uri = name === undefined ? root : `${root}/${name}`;
    }
    get exists() { return mockFs.existing.has(this.uri); }
    copy(dest: { uri: string }) {
      mockFs.copied.push([this.uri, dest.uri]);
      mockFs.existing.add(dest.uri);
    }
    write() { /* not used by these tests */ }
    delete() { mockFs.existing.delete(this.uri); }
    textSync() { return '{}'; }
  }
  class MockDirectory {
    uri: string;
    constructor(base: string | { uri: string }, name: string) {
      this.uri = `${typeof base === 'string' ? base : base.uri}/${name}`;
    }
    get exists() { return true; }
    create() { /* always exists */ }
  }
  return { File: MockFile, Directory: MockDirectory, Paths: { document: 'file:///doc' } };
});
jest.mock('expo-file-system/legacy', () => ({
  StorageAccessFramework: {
    readDirectoryAsync: async (dir: string) => {
      const entries = mockFs.dirs.get(dir);
      if (!entries) throw new Error(`cannot read ${dir}`);
      return entries;
    },
    readAsStringAsync: async (uri: string) => {
      const text = mockFs.texts.get(uri);
      if (text === undefined) throw new Error(`cannot read ${uri}`);
      return text;
    },
  },
}));

const mockEnrichAll = jest.fn();
const mockEnrichSelection = jest.fn();
jest.mock('@/scripts/MetadataService', () => ({
  MetadataService: {
    getInstance: () => ({
      enrichAll: (...args: unknown[]) => mockEnrichAll(...args),
      enrichSelection: (...args: unknown[]) => mockEnrichSelection(...args),
    }),
  },
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

    it('keeps every file whose episode number cannot be determined, under distinct stable keys', () => {
      const files = () => [
        scanned(['Show', 'Season 1'], 'Pilot.mkv'),
        scanned(['Show', 'Season 1'], 'Second.mkv'),
        scanned(['Show', 'Season 1'], 'Third.mkv'),
      ];
      const library = scanner.buildLibrary(files());
      const episodes = library.Show.seasons.s01.episodes;
      expect(Object.keys(episodes)).toHaveLength(3);
      // The first keeps "e00"; the rest get filename-derived keys.
      expect(episodes.e00.title).toBe('Pilot');
      expect(Object.keys(episodes).filter((k) => k !== 'e00').every((k) => /^e00-[0-9a-z]+$/.test(k))).toBe(true);
      expect(Object.values(episodes).map((e) => e.title).sort()).toEqual(['Pilot', 'Second', 'Third']);
      expect(Object.values(episodes).every((e) => e.episodeNumber === 0)).toBe(true);

      // Rescanning the same files gives the same keys.
      expect(Object.keys(scanner.buildLibrary(files()).Show.seasons.s01.episodes)).toEqual(Object.keys(episodes));
    });

    it('keeps the plain "e00" key for a lone episode-0 file, e.g. a genuine S01E00', () => {
      const library = scanner.buildLibrary([
        scanned(['Show'], 'Show.S01E00.Pilot.mkv'),
        scanned(['Show'], 'Show.S01E01.First.mkv'),
      ]);
      expect(Object.keys(library.Show.seasons.s01.episodes).sort()).toEqual(['e00', 'e01']);
      expect(library.Show.seasons.s01.episodes.e00.title).toBe('Pilot');
    });

    it('keeps same-named unnumbered files from different subfolders, but not the same file twice', () => {
      const a = scanned(['Show', 'Season 1', 'A'], 'Pilot.mkv');
      const b = scanned(['Show', 'Season 1', 'B'], 'Pilot.mkv');
      a.parsedPath = 'root/Show/Season 1/A/Pilot.mkv';
      b.parsedPath = 'root/Show/Season 1/B/Pilot.mkv';
      const library = scanner.buildLibrary([a, b, { ...a }]);
      const episodes = Object.values(library.Show.seasons.s01.episodes);
      expect(episodes.map((e) => e.parsedPath).sort()).toEqual([a.parsedPath, b.parsedPath]);
    });

    it('does not change keys for numbered episodes or let unnumbered files collide with them', () => {
      const library = scanner.buildLibrary([
        scanned(['Show', 'Season 1'], 'E01.mkv'),
        scanned(['Show', 'Season 1'], 'Bonus.mkv'),
        scanned(['Show', 'Season 1'], '02 - Two.mkv'),
      ]);
      const keys = Object.keys(library.Show.seasons.s01.episodes);
      expect(keys).toContain('e01');
      expect(keys).toContain('e02');
      expect(keys).toHaveLength(3);
    });

    it('extracts numbers from filenames without a show name using the folder structure', () => {
      const library = scanner.buildLibrary([
        scanned(['Show'], 'S02E05.mkv'),
        scanned(['Show', 'Specials'], 'Episode 1.mkv'),
        scanned(['Show', 'Season 3'], '01 - Title.mkv'),
        scanned(['Show', 'Season 3'], '02 - Title Two.mkv'),
      ]);
      expect(Object.keys(library.Show.seasons).sort()).toEqual(['s00', 's02', 's03']);
      expect(Object.keys(library.Show.seasons.s02.episodes)).toEqual(['e05']);
      expect(Object.keys(library.Show.seasons.s00.episodes)).toEqual(['e01']);
      expect(Object.keys(library.Show.seasons.s03.episodes).sort()).toEqual(['e01', 'e02']);
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


// ── scanAllSources: Personal sources ─────────────────────────────────────────

describe('FileScanner.scanAllSources (personal sources)', () => {
  const ROOT = 'content://tree/root';
  const OTHER_ROOT = 'content://tree/other';
  const POSTER_URI = /^file:\/\/\/doc\/smb_posters\/personal_(?:folder_)?[0-9a-f]{16}_local\.jpg$/;

  const makeStore = () => configureStore({
    reducer: { libraryReducer, settingsReducer, scanReducer },
    middleware: (getDefault) => getDefault({ serializableCheck: false, immutableCheck: false }),
  });

  let store: ReturnType<typeof makeStore>;
  let scanner: FileScanner;
  const lib = () => store.getState().libraryReducer;

  /** The SAF uri of the entry `name` inside `dir` (names are percent-encoded like real SAF uris). */
  const child = (dir: string, name: string) => `${dir}/${encodeURIComponent(name)}`;
  const addDir = (dir: string, names: string[]) => mockFs.dirs.set(dir, names.map((n) => child(dir, n)));
  const personalSource = (uri: string): IMediaSource => ({ uri, contentType: 'personal' });
  const video = (name: string): IPersonalVideo => lib().personal.find((v) => v.filename === name)!;

  /** A tree with a root file, a nested folder and assorted files that must be ignored. */
  const buildTree = () => {
    addDir(ROOT, [
      'Intro [dQw4w9WgXcQ].mp4', 'Intro [dQw4w9WgXcQ].jpg', 'Intro [dQw4w9WgXcQ].info.json',
      'home movie.mp4', 'folder.jpg',
      'notes.txt', 'smb.json', 'smb_thumb_s01e01.jpg', 'song.mp3', '.hidden.mp4',
      'Drawing',
    ]);
    addDir(child(ROOT, 'Drawing'), ['Lesson 1.mp4', 'Lesson 1-thumb.png', 'poster.jpg', 'Perspective']);
    addDir(child(child(ROOT, 'Drawing'), 'Perspective'), ['Vanishing Points [1080p].mkv', 'Vanishing Points [1080p].info.json']);
    mockFs.texts.set(child(ROOT, 'Intro [dQw4w9WgXcQ].info.json'), JSON.stringify({
      id: 'dQw4w9WgXcQ',
      extractor_key: 'Youtube',
      title: 'Never Gonna Give You Up',
      channel: 'Rick Astley',
      description: 'The official video.',
      upload_date: '20091025',
    }));
    mockFs.texts.set(child(child(child(ROOT, 'Drawing'), 'Perspective'), 'Vanishing Points [1080p].info.json'), JSON.stringify({
      id: 'abc123',
      extractor: 'generic',
      title: 'Vanishing Points',
      uploader: 'Art Teacher',
    }));
  };

  beforeEach(() => {
    jest.spyOn(Date, 'now').mockReturnValue(NOW);
    jest.clearAllMocks();
    mockFs.dirs.clear();
    mockFs.texts.clear();
    mockFs.existing.clear();
    mockFs.copied.length = 0;
    store = makeStore();
    setLibrarySink(store as unknown as LibrarySink);
    scanner = new FileScanner();
  });

  afterEach(() => {
    setLibrarySink(null);
    jest.restoreAllMocks();
  });

  describe('collection', () => {
    it('collects only video files, mirroring the folder tree in folderPath', async () => {
      buildTree();

      await scanner.scanAllSources([personalSource(ROOT)]);

      const byName = Object.fromEntries(lib().personal.map((v) => [v.filename, v.folderPath]));
      expect(byName).toEqual({
        'Intro [dQw4w9WgXcQ].mp4': [],
        'home movie.mp4': [],
        'Lesson 1.mp4': ['Drawing'],
        'Vanishing Points [1080p].mkv': ['Drawing', 'Perspective'],
      });
      // Nothing the scanner doesn't understand leaks into the other content types.
      expect(lib().movies).toEqual([]);
      expect(lib().audiobooks).toEqual([]);
      expect(lib().mediaLibrary).toEqual({});
    });

    it('builds the video objects like movies, with a filename-derived title and the source uri', async () => {
      buildTree();

      await scanner.scanAllSources([personalSource(ROOT)]);

      expect(video('Lesson 1.mp4')).toEqual({
        ids: { tvdb: null, imdb: null, tmdb: null },
        title: 'Lesson 1',
        scannedTitle: 'Lesson 1',
        episodeNumber: 0,
        filename: 'Lesson 1.mp4',
        path: child(child(ROOT, 'Drawing'), 'Lesson 1.mp4'),
        parsedPath: `${ROOT}/Drawing/Lesson 1.mp4`,
        isDirectory: false,
        poster: expect.stringMatching(POSTER_URI),
        folderPath: ['Drawing'],
        sourceUri: ROOT,
        firstDetected: NOW,
      });
      // "Title [id]" drops the id from the display title.
      expect(video('Intro [dQw4w9WgXcQ].mp4').title).toBe('Intro');
    });

    it('merges the videos of several personal sources and ignores other source types', async () => {
      buildTree();
      addDir(OTHER_ROOT, ['Drawing']);
      addDir(child(OTHER_ROOT, 'Drawing'), ['Lesson 2.mp4']);
      addDir('content://tree/movies', ['Heat.mkv']);

      await scanner.scanAllSources([
        personalSource(ROOT),
        personalSource(OTHER_ROOT),
        { uri: 'content://tree/movies', contentType: 'movie' },
      ]);

      expect(lib().personal.filter((v) => v.folderPath[0] === 'Drawing').map((v) => v.filename).sort())
        .toEqual(['Lesson 1.mp4', 'Lesson 2.mp4', 'Vanishing Points [1080p].mkv']);
      expect(video('Lesson 2.mp4').sourceUri).toBe(OTHER_ROOT);
      expect(lib().movies.map((m) => m.filename)).toEqual(['Heat.mkv']);
    });

    it('clears the personal list when there are no personal sources', async () => {
      store.dispatch(setPersonal([{ ...(await scanOne()), title: 'stale' }]));
      store.dispatch(setPersonalFolderPosters({ Drawing: 'file:///doc/x.jpg' }));

      await scanner.scanAllSources([]);

      expect(lib().personal).toEqual([]);
      expect(lib().personalFolderPosters).toEqual({});
    });

    async function scanOne(): Promise<IPersonalVideo> {
      addDir(ROOT, ['a.mp4']);
      await scanner.scanAllSources([personalSource(ROOT)]);
      return lib().personal[0];
    }
  });

  describe('sidecars', () => {
    it('copies the sidecar image into persistent storage as the poster', async () => {
      buildTree();

      await scanner.scanAllSources([personalSource(ROOT)]);

      const intro = video('Intro [dQw4w9WgXcQ].mp4');
      expect(intro.poster).toMatch(POSTER_URI);
      expect(mockFs.copied).toContainEqual([child(ROOT, 'Intro [dQw4w9WgXcQ].jpg'), intro.poster]);
      // The Kodi-style "<base>-thumb.png" form works too; a video with no image has no poster.
      expect(video('Lesson 1.mp4').poster).toMatch(POSTER_URI);
      expect(video('Lesson 1.mp4').poster).not.toBe(intro.poster);
      expect(video('home movie.mp4').poster).toBe('');
    });

    it('reads the yt-dlp info.json for title, channel, description, upload date and YouTube id', async () => {
      buildTree();

      await scanner.scanAllSources([personalSource(ROOT)]);

      expect(video('Intro [dQw4w9WgXcQ].mp4')).toMatchObject({
        title: 'Intro',
        resolvedTitle: 'Never Gonna Give You Up',
        channel: 'Rick Astley',
        description: 'The official video.',
        uploadDate: '20091025',
        youtubeId: 'dQw4w9WgXcQ',
      });
    });

    it('uses the info.json id as the YouTube id only for YouTube downloads', async () => {
      addDir(ROOT, ['Clip [aaaaaaaaaaa].mp4', 'Clip [aaaaaaaaaaa].info.json', 'Other.mp4', 'Other.info.json']);
      // A YouTube info.json wins over a different id in the filename.
      mockFs.texts.set(child(ROOT, 'Clip [aaaaaaaaaaa].info.json'), JSON.stringify({
        id: 'bbbbbbbbbbb', webpage_url: 'https://www.youtube.com/watch?v=bbbbbbbbbbb', title: 'Clip',
      }));
      mockFs.texts.set(child(ROOT, 'Other.info.json'), JSON.stringify({
        id: 'abc123', extractor: 'generic', title: 'Vanishing Points', uploader: 'Art Teacher',
      }));

      await scanner.scanAllSources([personalSource(ROOT)]);

      expect(video('Clip [aaaaaaaaaaa].mp4').youtubeId).toBe('bbbbbbbbbbb');
      // A non-YouTube extractor id is not a YouTube id; the title and uploader still come through.
      expect(video('Other.mp4')).toMatchObject({ resolvedTitle: 'Vanishing Points', channel: 'Art Teacher' });
      expect(video('Other.mp4').youtubeId).toBeUndefined();
    });

    it('takes the YouTube id from a trailing "[id]" in the filename, but not from other brackets', async () => {
      buildTree();

      await scanner.scanAllSources([personalSource(ROOT)]);

      expect(video('Intro [dQw4w9WgXcQ].mp4').youtubeId).toBe('dQw4w9WgXcQ');
      expect(video('Vanishing Points [1080p].mkv').youtubeId).toBeUndefined();
      expect(video('home movie.mp4').youtubeId).toBeUndefined();
    });

    it('survives an unreadable or malformed info.json and an image that cannot be copied', async () => {
      addDir(ROOT, ['A.mp4', 'A.info.json', 'B.mp4', 'B.info.json', 'B.jpg']);
      mockFs.texts.set(child(ROOT, 'B.info.json'), '{ not json');
      const copyError = jest.spyOn(Object.getPrototypeOf(new (jest.requireMock('expo-file-system').File)('x')), 'copy')
        .mockImplementation(() => { throw new Error('copy failed'); });

      await scanner.scanAllSources([personalSource(ROOT)]);

      expect(copyError).toHaveBeenCalled();
      expect(lib().personal.map((v) => v.filename).sort()).toEqual(['A.mp4', 'B.mp4']);
      expect(video('A.mp4').resolvedTitle).toBeUndefined();
      expect(video('B.mp4').resolvedTitle).toBeUndefined();
    });
  });

  describe('folder posters', () => {
    it('records folder.jpg / poster.jpg per folder key, root as the empty key', async () => {
      buildTree();

      await scanner.scanAllSources([personalSource(ROOT)]);

      expect(Object.keys(lib().personalFolderPosters).sort()).toEqual(['', 'Drawing']);
      expect(lib().personalFolderPosters['']).toMatch(POSTER_URI);
      expect(lib().personalFolderPosters.Drawing).toMatch(POSTER_URI);
      expect(mockFs.copied).toContainEqual([child(ROOT, 'folder.jpg'), lib().personalFolderPosters['']]);
      expect(mockFs.copied).toContainEqual([child(child(ROOT, 'Drawing'), 'poster.jpg'), lib().personalFolderPosters.Drawing]);
    });

    it('does not treat a video sidecar image as a folder poster', async () => {
      addDir(ROOT, ['Lesson.mp4', 'Lesson.jpg', 'Lesson-thumb.png']);

      await scanner.scanAllSources([personalSource(ROOT)]);

      expect(lib().personalFolderPosters).toEqual({});
      expect(video('Lesson.mp4').poster).toMatch(POSTER_URI);
    });

    it('keeps the first folder poster when several sources have the same folder', async () => {
      addDir(ROOT, ['Drawing']);
      addDir(child(ROOT, 'Drawing'), ['cover.jpg', 'a.mp4']);
      addDir(OTHER_ROOT, ['Drawing']);
      addDir(child(OTHER_ROOT, 'Drawing'), ['folder.jpg', 'b.mp4']);

      await scanner.scanAllSources([personalSource(ROOT), personalSource(OTHER_ROOT)]);

      expect(mockFs.copied.filter(([, dest]) => dest === lib().personalFolderPosters.Drawing)).toHaveLength(1);
      expect(mockFs.copied[0][0]).toBe(child(child(ROOT, 'Drawing'), 'cover.jpg'));
    });
  });

  describe('carry-over from the previous scan', () => {
    const CACHED = 'file:///doc/smb_posters/personal_yt_homeHOMEhom.jpg';

    const seedPrevious = (extra: Partial<IPersonalVideo> = {}) => {
      store.dispatch(setPersonal([{
        ids: { tvdb: null, imdb: null, tmdb: null },
        title: 'home movie',
        scannedTitle: 'home movie',
        episodeNumber: 0,
        filename: 'home movie.mp4',
        path: child(ROOT, 'home movie.mp4'),
        parsedPath: `${ROOT}/home movie.mp4`,
        isDirectory: false,
        poster: CACHED,
        folderPath: [],
        sourceUri: ROOT,
        firstDetected: 111,
        lastOpened: 222,
        resolvedTitle: 'Home Movie (online)',
        channel: 'Me',
        description: 'desc',
        uploadDate: '20200101',
        youtubeId: 'homeHOMEhom',
        ...extra,
      }]));
    };

    it('carries online metadata, timestamps and the cached poster over', async () => {
      buildTree();
      mockFs.existing.add(CACHED);
      seedPrevious();

      await scanner.scanAllSources([personalSource(ROOT)]);

      expect(video('home movie.mp4')).toMatchObject({
        resolvedTitle: 'Home Movie (online)',
        channel: 'Me',
        description: 'desc',
        uploadDate: '20200101',
        youtubeId: 'homeHOMEhom',
        firstDetected: 111,
        lastOpened: 222,
        poster: CACHED,
      });
    });

    it('drops the carried poster when its file is gone', async () => {
      buildTree();
      seedPrevious();

      await scanner.scanAllSources([personalSource(ROOT)]);

      expect(video('home movie.mp4').poster).toBe('');
      expect(video('home movie.mp4').resolvedTitle).toBe('Home Movie (online)');
    });

    it('prefers a freshly found sidecar image and info.json over carried data', async () => {
      buildTree();
      mockFs.existing.add(CACHED);
      store.dispatch(setPersonal([]));
      seedPrevious({
        filename: 'Intro [dQw4w9WgXcQ].mp4',
        path: child(ROOT, 'Intro [dQw4w9WgXcQ].mp4'),
        parsedPath: `${ROOT}/Intro [dQw4w9WgXcQ].mp4`,
        resolvedTitle: 'Old title',
        channel: 'Old channel',
      });

      await scanner.scanAllSources([personalSource(ROOT)]);

      const intro = video('Intro [dQw4w9WgXcQ].mp4');
      expect(intro.resolvedTitle).toBe('Never Gonna Give You Up');
      expect(intro.channel).toBe('Rick Astley');
      expect(intro.poster).toMatch(POSTER_URI);
      expect(intro.poster).not.toBe(CACHED);
      expect(intro.firstDetected).toBe(111);
    });

    it('forgets videos that are no longer on a readable source', async () => {
      buildTree();
      seedPrevious({ filename: 'gone.mp4', path: child(ROOT, 'gone.mp4'), parsedPath: `${ROOT}/gone.mp4` });

      await scanner.scanAllSources([personalSource(ROOT)]);

      expect(lib().personal.find((v) => v.filename === 'gone.mp4')).toBeUndefined();
    });
  });

  describe('unreachable sources', () => {
    const prevVideo = (name: string, sourceUri: string | undefined, folderPath: string[] = []): IPersonalVideo => ({
      ids: { tvdb: null, imdb: null, tmdb: null },
      title: name,
      scannedTitle: name,
      episodeNumber: 0,
      filename: `${name}.mp4`,
      path: `${sourceUri ?? 'content://legacy'}/${name}.mp4`,
      parsedPath: `${sourceUri ?? 'content://legacy'}/${name}.mp4`,
      isDirectory: false,
      poster: '',
      folderPath,
      ...(sourceUri ? { sourceUri } : {}),
    });

    it('carries a failed source\'s videos and folder posters forward as unavailable', async () => {
      addDir(ROOT, ['a.mp4']);
      // OTHER_ROOT is not in mockFs.dirs, so its root cannot be read.
      store.dispatch(setPersonal([
        prevVideo('old', OTHER_ROOT, ['Drawing', 'Perspective']),
        prevVideo('removed', ROOT),
      ]));
      store.dispatch(setPersonalFolderPosters({ Drawing: 'file:///doc/d.jpg', Other: 'file:///doc/o.jpg' }));

      await scanner.scanAllSources([personalSource(ROOT), personalSource(OTHER_ROOT)]);

      expect(lib().personal.map((v) => [v.filename, v.unavailable])).toEqual([
        ['a.mp4', undefined],
        ['old.mp4', true],
      ]);
      // Only the folders of the carried videos keep their poster.
      expect(lib().personalFolderPosters).toEqual({ Drawing: 'file:///doc/d.jpg' });
    });

    it('only restores videos from before sourceUri existed when every personal source failed', async () => {
      store.dispatch(setPersonal([prevVideo('legacy', undefined)]));

      addDir(ROOT, ['a.mp4']);
      await scanner.scanAllSources([personalSource(ROOT), personalSource(OTHER_ROOT)]);
      expect(lib().personal.map((v) => v.filename)).toEqual(['a.mp4']);

      store.dispatch(setPersonal([prevVideo('legacy', undefined)]));
      mockFs.dirs.clear();
      await scanner.scanAllSources([personalSource(ROOT), personalSource(OTHER_ROOT)]);
      expect(lib().personal).toEqual([expect.objectContaining({ filename: 'legacy.mp4', unavailable: true })]);
    });
  });

  describe('metadata enrichment', () => {
    it('runs enrichAll without any API key when a personal video has a YouTube id', async () => {
      buildTree();

      await scanner.scanAllSources([personalSource(ROOT)]);

      expect(mockEnrichAll).toHaveBeenCalledTimes(1);
      const personalArg = mockEnrichAll.mock.calls[0][4] as IPersonalVideo[];
      expect(personalArg.map((v) => v.filename).sort()).toEqual(lib().personal.map((v) => v.filename).sort());
    });

    it('skips enrichment when no video has a YouTube id and there is no API key or audiobook', async () => {
      addDir(ROOT, ['home movie.mp4']);

      await scanner.scanAllSources([personalSource(ROOT)]);

      expect(mockEnrichAll).not.toHaveBeenCalled();
    });

    it('still enriches personal videos alongside a provider key', async () => {
      addDir(ROOT, ['home movie.mp4']);
      store.dispatch(setTmdbApiKey('key'));

      await scanner.scanAllSources([personalSource(ROOT)]);

      expect(mockEnrichAll).toHaveBeenCalledTimes(1);
    });

    it('skips enrichment when poster fetching is disabled', async () => {
      buildTree();
      store.dispatch(setEnablePosterFetching(false));

      await scanner.scanAllSources([personalSource(ROOT)]);

      expect(mockEnrichAll).not.toHaveBeenCalled();
      expect(lib().personal).toHaveLength(4);
    });
  });

  describe('thumbnail generation', () => {
    it('includes freshly scanned personal videos, but not unavailable carried-forward ones', async () => {
      store.dispatch(setEnableThumbnailGeneration(true));
      store.dispatch(setPersonal([{
        ids: { tvdb: null, imdb: null, tmdb: null }, title: 'old', scannedTitle: 'old', episodeNumber: 0,
        filename: 'old.mp4', path: `${OTHER_ROOT}/old.mp4`, parsedPath: `${OTHER_ROOT}/old.mp4`,
        isDirectory: false, poster: '', folderPath: [], sourceUri: OTHER_ROOT,
      }]));
      addDir(ROOT, ['a.mp4', 'Sub']);
      addDir(child(ROOT, 'Sub'), ['b.mp4']);
      const generate = jest
        .spyOn(scanner as unknown as { generateThumbnailsFor: (files: { filename: string }[]) => Promise<void> }, 'generateThumbnailsFor')
        .mockResolvedValue(undefined);

      await scanner.scanAllSources([personalSource(ROOT), personalSource(OTHER_ROOT)]);

      expect(generate).toHaveBeenCalledTimes(1);
      expect(generate.mock.calls[0][0].map((f) => f.filename).sort()).toEqual(['a.mp4', 'b.mp4']);
    });
  });

  describe('refetchMetadataFor', () => {
    it('forwards the selected personal paths to the metadata service', async () => {
      await scanner.refetchMetadataFor([], [], ['content://p/a.mp4']);

      expect(mockEnrichSelection).toHaveBeenCalledWith([], [], expect.any(Function), ['content://p/a.mp4']);
    });

    it('does nothing for an empty selection', async () => {
      await scanner.refetchMetadataFor([], [], []);

      expect(mockEnrichSelection).not.toHaveBeenCalled();
    });
  });
});
