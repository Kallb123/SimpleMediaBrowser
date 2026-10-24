import { configureStore } from '@reduxjs/toolkit';
import libraryReducer, {
  setAudiobooks,
  setMediaLibrary,
  setMediaOverride,
  setMovies,
} from '@/store/libraryReducer';
import type { IMediaAudiobook, IMediaLibrary, IMediaShow } from '@/store/libraryReducer';
import settingsReducer, { setDataSource, setTmdbApiKey, setTvdbApiKey } from '@/store/settingsReducer';
import { setLibrarySink } from '@/scripts/librarySink';
import type { LibrarySink } from '@/scripts/librarySink';
import type { IMediaObject } from '@/scripts/libraryUtils';
import type { IMetadataProvider } from '@/scripts/providers/IMetadataProvider';
import { logger } from '@/scripts/Logger';
import { MetadataService } from '@/scripts/MetadataService';

// ── Mocks ────────────────────────────────────────────────────────────────────

/** URIs for which `new File(uri).exists` is true. */
const mockExistingFiles = new Set<string>();
jest.mock('expo-file-system', () => ({
  ...jest.requireActual('expo-file-system'),
  File: class {
    uri: string;
    constructor(uri: string) {
      this.uri = uri;
    }
    get exists() {
      return mockExistingFiles.has(this.uri);
    }
  },
}));

jest.mock('@/scripts/Logger', () => ({
  logger: { log: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

/**
 * The service constructs providers from the API keys in settings. Replace them with fakes
 * that delegate to shared jest.fn()s so no test can reach the network and each test can
 * script the provider behaviour. (The real providers' HTTP code is not under test here.)
 */
const mockTmdb = {
  searchShow: jest.fn(),
  searchMovie: jest.fn(),
  downloadShowPoster: jest.fn(),
  downloadMoviePoster: jest.fn(),
  fetchSeasonEpisodes: jest.fn(),
  downloadEpisodeThumbnail: jest.fn(),
};
const mockTvdbAuthenticate = jest.fn();
const mockAudiobook = {
  searchAudiobook: jest.fn(),
  downloadCover: jest.fn(),
};
jest.mock('@/scripts/providers/TmdbProvider', () => ({
  TmdbProvider: class {
    readonly source = 'tmdb' as const;
    searchShow(...a: unknown[]) { return mockTmdb.searchShow(...a); }
    searchMovie(...a: unknown[]) { return mockTmdb.searchMovie(...a); }
    downloadShowPoster(...a: unknown[]) { return mockTmdb.downloadShowPoster(...a); }
    downloadMoviePoster(...a: unknown[]) { return mockTmdb.downloadMoviePoster(...a); }
    fetchSeasonEpisodes(...a: unknown[]) { return mockTmdb.fetchSeasonEpisodes(...a); }
    downloadEpisodeThumbnail(...a: unknown[]) { return mockTmdb.downloadEpisodeThumbnail(...a); }
  },
}));
jest.mock('@/scripts/providers/TvdbProvider', () => ({
  TvdbProvider: class {
    readonly source = 'tvdb' as const;
    authenticate() { return mockTvdbAuthenticate(); }
  },
}));
jest.mock('@/scripts/providers/AudiobookProvider', () => ({
  AudiobookProvider: class {
    searchAudiobook(...a: unknown[]) {
      return mockAudiobook.searchAudiobook(...a);
    }
    downloadCover(...a: unknown[]) {
      return mockAudiobook.downloadCover(...a);
    }
  },
}));

const realFetch = global.fetch;

// ── Fixtures ─────────────────────────────────────────────────────────────────

const NO_IDS = () => ({ tvdb: null, imdb: null, tmdb: null });

const makeEpisode = (path: string, episodeNumber: number, extra: Partial<IMediaObject> = {}): IMediaObject => ({
  ids: NO_IDS(),
  episodeNumber,
  title: `Episode ${episodeNumber}`,
  filename: `${path}.mkv`,
  path: `content://x/${path}.mkv`,
  parsedPath: `x/${path}.mkv`,
  isDirectory: false,
  poster: '',
  ...extra,
});

const makeShow = (title: string, extra: Partial<IMediaShow> = {}, episodeKeys: string[] = ['e01']): IMediaShow => ({
  ids: NO_IDS(),
  title,
  year: 0,
  poster: '',
  seasons: {
    s01: {
      ids: NO_IDS(),
      seasonNumber: 1,
      episodes: Object.fromEntries(
        episodeKeys.map((k) => [k, makeEpisode(`${title}/${k}`, parseInt(k.slice(1), 10))]),
      ),
    },
  },
  ...extra,
});

const makeMovie = (name: string, extra: Partial<IMediaObject> = {}): IMediaObject =>
  makeEpisode(name, 0, { title: name, filename: `${name}.mkv`, path: `content://m/${name}.mkv`, parsedPath: `m/${name}.mkv`, ...extra });

const makeAudiobook = (folderKey: string, extra: Partial<IMediaAudiobook> = {}): IMediaAudiobook => ({
  ids: { itunes: null },
  title: folderKey,
  folderKey,
  path: `content://a/${folderKey}/1.mp3`,
  files: [],
  poster: '',
  ...extra,
});

const makeStore = () => configureStore({
  reducer: { libraryReducer, settingsReducer },
  // Fixtures are plain data; skip the dev-only checks to keep the tests fast.
  middleware: (getDefault) => getDefault({ serializableCheck: false, immutableCheck: false }),
});

describe('MetadataService', () => {
  let store: ReturnType<typeof makeStore>;
  let service: MetadataService;
  const lib = () => store.getState().libraryReducer;

  const seedLibrary = (library: IMediaLibrary) => store.dispatch(setMediaLibrary(library));

  beforeEach(() => {
    jest.clearAllMocks();
    mockExistingFiles.clear();
    // Any accidental network access fails loudly.
    global.fetch = jest.fn(() => {
      throw new Error('network access is not allowed in MetadataService tests');
    }) as unknown as typeof fetch;

    store = makeStore();
    setLibrarySink(store as unknown as LibrarySink);
    (MetadataService as any)._instance = null;
    service = MetadataService.getInstance();
  });

  afterEach(() => {
    setLibrarySink(null);
    global.fetch = realFetch;
  });

  it('is a singleton that can be reset between tests', () => {
    expect(MetadataService.getInstance()).toBe(service);
    (MetadataService as any)._instance = null;
    expect(MetadataService.getInstance()).not.toBe(service);
  });

  // ── deduplicateByFuzzyName ─────────────────────────────────────────────────

  describe('deduplicateByFuzzyName', () => {
    const dedupe = () => (service as any).deduplicateByFuzzyName();

    it("merges \"Grey's Anatomy\" and \"Greys Anatomy\", keeping the alphabetically first key when neither has an id", () => {
      seedLibrary({
        'Greys Anatomy': makeShow('Greys Anatomy', {}, ['e02']),
        "Grey's Anatomy": makeShow("Grey's Anatomy", {}, ['e01']),
      });

      dedupe();

      // "'" sorts before "s", so "Grey's Anatomy" is the canonical entry.
      expect(Object.keys(lib().mediaLibrary)).toEqual(["Grey's Anatomy"]);
      const kept = lib().mediaLibrary["Grey's Anatomy"];
      expect(Object.keys(kept.seasons.s01.episodes).sort()).toEqual(['e01', 'e02']);
      expect(kept.rawNames).toEqual(['Greys Anatomy']);
    });

    it('prefers the entry that already has a provider id over the alphabetically first one', () => {
      seedLibrary({
        "Grey's Anatomy": makeShow("Grey's Anatomy", {}, ['e01']),
        'Greys Anatomy': makeShow('Greys Anatomy', { ids: { tvdb: null, imdb: null, tmdb: '1416' }, poster: 'file:///p.jpg' }, ['e02']),
      });

      dedupe();

      expect(Object.keys(lib().mediaLibrary)).toEqual(['Greys Anatomy']);
      const kept = lib().mediaLibrary['Greys Anatomy'];
      expect(kept.ids.tmdb).toBe('1416');
      expect(kept.poster).toBe('file:///p.jpg');
      expect(Object.keys(kept.seasons.s01.episodes).sort()).toEqual(['e01', 'e02']);
      expect(kept.rawNames).toEqual(["Grey's Anatomy"]);
    });

    it('uses a tvdb id as a reason to keep an entry too', () => {
      seedLibrary({
        'Alpha Show': makeShow('Alpha Show'),
        'alpha show': makeShow('alpha show', { ids: { tvdb: '5', imdb: null, tmdb: null } }),
      });
      dedupe();
      expect(Object.keys(lib().mediaLibrary)).toEqual(['alpha show']);
    });

    it('merges "Tom & Jerry" with "Tom and Jerry" (keeping "Tom & Jerry", which sorts first)', () => {
      seedLibrary({
        'Tom and Jerry': makeShow('Tom and Jerry', {}, ['e03']),
        'Tom & Jerry': makeShow('Tom & Jerry', {}, ['e01']),
      });

      dedupe();

      expect(Object.keys(lib().mediaLibrary)).toEqual(['Tom & Jerry']);
      expect(Object.keys(lib().mediaLibrary['Tom & Jerry'].seasons.s01.episodes).sort()).toEqual(['e01', 'e03']);
    });

    it('collapses a year-suffixed key into the bare one and handles several groups in one pass', () => {
      seedLibrary({
        Bluey: makeShow('Bluey'),
        'Bluey (2018)': makeShow('Bluey (2018)'),
        "Grey's Anatomy": makeShow("Grey's Anatomy"),
        'Greys Anatomy': makeShow('Greys Anatomy'),
        'Lost': makeShow('Lost'),
      });

      dedupe();

      expect(Object.keys(lib().mediaLibrary).sort()).toEqual(["Grey's Anatomy", 'Bluey', 'Lost'].sort());
    });

    it('does not overwrite an episode that exists under the kept key', () => {
      const keep = makeShow('Greys Anatomy', { ids: { tvdb: null, imdb: null, tmdb: '1' } }, ['e01']);
      const drop = makeShow("Grey's Anatomy", {}, ['e01']);
      drop.seasons.s01.episodes.e01.title = 'from the duplicate';
      seedLibrary({ 'Greys Anatomy': keep, "Grey's Anatomy": drop });

      dedupe();

      expect(lib().mediaLibrary['Greys Anatomy'].seasons.s01.episodes.e01.title).toBe('Episode 1');
    });

    it('is a no-op when no two keys collide', () => {
      const library = { Bluey: makeShow('Bluey'), Lost: makeShow('Lost') };
      seedLibrary(library);
      dedupe();
      expect(lib().mediaLibrary).toEqual(library);
    });
  });

  // ── deduplicateByProviderIds ───────────────────────────────────────────────

  describe('deduplicateByProviderIds', () => {
    const dedupe = () => (service as any).deduplicateByProviderIds();

    it('merges shows that share a TMDB id, keeping the alphabetically first key', () => {
      const ids = { tvdb: null, imdb: null, tmdb: '42' };
      seedLibrary({
        'The Office (US)': makeShow('The Office (US)', { ids }, ['e02']),
        'Office': makeShow('Office', { ids: { ...ids } }, ['e01']),
        Unrelated: makeShow('Unrelated', { ids: { tvdb: null, imdb: null, tmdb: '7' } }),
      });

      dedupe();

      expect(Object.keys(lib().mediaLibrary).sort()).toEqual(['Office', 'Unrelated']);
      expect(Object.keys(lib().mediaLibrary.Office.seasons.s01.episodes).sort()).toEqual(['e01', 'e02']);
      expect(lib().mediaLibrary.Office.rawNames).toEqual(['The Office (US)']);
    });

    it('also merges on shared TVDB ids, and ignores shows without ids', () => {
      seedLibrary({
        B: makeShow('B', { ids: { tvdb: '9', imdb: null, tmdb: null } }),
        A: makeShow('A', { ids: { tvdb: '9', imdb: null, tmdb: null } }),
        N1: makeShow('N1'),
        N2: makeShow('N2'),
      });

      dedupe();

      expect(Object.keys(lib().mediaLibrary).sort()).toEqual(['A', 'N1', 'N2']);
    });
  });

  // ── buildProviders / provider resolution ───────────────────────────────────

  describe('provider resolution (buildProviders)', () => {
    const build = () => (service as any).buildProviders() as Promise<{
      resolveShowProvider: (name: string, show: IMediaShow) => IMetadataProvider | null;
      resolveMovieProvider: (movie: IMediaObject) => IMetadataProvider | null;
    }>;

    it('returns no provider when no API keys are configured', async () => {
      const { resolveShowProvider, resolveMovieProvider } = await build();
      expect(resolveShowProvider('Bluey', makeShow('Bluey'))).toBeNull();
      expect(resolveMovieProvider(makeMovie('M'))).toBeNull();
      expect(mockTvdbAuthenticate).not.toHaveBeenCalled();
    });

    it('uses the global data source by default and only authenticates TVDB when it has a key', async () => {
      store.dispatch(setTmdbApiKey('tmdb-key'));
      store.dispatch(setTvdbApiKey('tvdb-key'));
      store.dispatch(setDataSource('tvdb'));

      const { resolveShowProvider } = await build();

      expect(mockTvdbAuthenticate).toHaveBeenCalledTimes(1);
      expect(resolveShowProvider('Bluey', makeShow('Bluey'))?.source).toBe('tvdb');

      store.dispatch(setDataSource('tmdb'));
      const rebuilt = await build();
      expect(rebuilt.resolveShowProvider('Bluey', makeShow('Bluey'))?.source).toBe('tmdb');
    });

    it('prefers the per-item override, then the item/source metadataSource, then the global setting', async () => {
      store.dispatch(setTmdbApiKey('tmdb-key'));
      store.dispatch(setTvdbApiKey('tvdb-key'));
      store.dispatch(setDataSource('tmdb'));
      store.dispatch(setMediaOverride({ key: 'show:Overridden', override: { metadataSourceOverride: 'tvdb' } }));
      store.dispatch(setMediaOverride({ key: 'show:Both', override: { metadataSourceOverride: 'tmdb' } }));
      store.dispatch(setMediaOverride({ key: 'movie:m/over.mkv', override: { metadataSourceOverride: 'tvdb' } }));

      const { resolveShowProvider, resolveMovieProvider } = await build();

      // global (tmdb)
      expect(resolveShowProvider('Plain', makeShow('Plain'))?.source).toBe('tmdb');
      // the show's own metadataSource beats global
      expect(resolveShowProvider('FromSource', makeShow('FromSource', { metadataSource: 'tvdb' }))?.source).toBe('tvdb');
      // override beats global
      expect(resolveShowProvider('Overridden', makeShow('Overridden'))?.source).toBe('tvdb');
      // override beats the show's metadataSource
      expect(resolveShowProvider('Both', makeShow('Both', { metadataSource: 'tvdb' }))?.source).toBe('tmdb');

      // movies resolve the same way, keyed on parsedPath
      expect(resolveMovieProvider(makeMovie('plain'))?.source).toBe('tmdb');
      expect(resolveMovieProvider(makeMovie('src', { metadataSource: 'tvdb' }))?.source).toBe('tvdb');
      expect(resolveMovieProvider(makeMovie('over'))?.source).toBe('tvdb');
    });

    it('yields null (not another provider) when the preferred provider has no key', async () => {
      store.dispatch(setTmdbApiKey('tmdb-key')); // no TVDB key
      store.dispatch(setMediaOverride({ key: 'show:Overridden', override: { metadataSourceOverride: 'tvdb' } }));

      const { resolveShowProvider } = await build();

      expect(resolveShowProvider('Overridden', makeShow('Overridden'))).toBeNull();
      expect(resolveShowProvider('Plain', makeShow('Plain'))?.source).toBe('tmdb');
    });
  });

  // ── enrichLibrary ──────────────────────────────────────────────────────────

  describe('enrichLibrary', () => {
    const makeProvider = (source: 'tmdb' | 'tvdb' = 'tmdb') => ({
      source,
      searchShow: jest.fn(),
      searchMovie: jest.fn(),
      downloadShowPoster: jest.fn(),
      downloadMoviePoster: jest.fn(),
      fetchSeasonEpisodes: jest.fn(),
      downloadEpisodeThumbnail: jest.fn(),
    });

    const run = async (
      provider: ReturnType<typeof makeProvider> | null,
      opts: { isCancelled?: () => boolean } = {},
    ) => {
      const progress = { done: 0 };
      const dispatchProgress = jest.fn();
      const resolve = jest.fn(() => provider as unknown as IMetadataProvider | null);
      await service.enrichLibrary(lib().mediaLibrary, resolve, progress, dispatchProgress, opts.isCancelled);
      return { progress, dispatchProgress, resolve };
    };

    it('writes provider id, title, year and the downloaded poster into state', async () => {
      seedLibrary({ Bluey: makeShow('Bluey') });
      const provider = makeProvider('tmdb');
      provider.searchShow.mockResolvedValue([
        { id: '82728', title: 'Bluey', year: 2018, posterUrl: 'https://img/p.jpg', posterThumbUrl: null },
      ]);
      provider.downloadShowPoster.mockResolvedValue('file:///posters/82728.jpg');

      const { progress, dispatchProgress } = await run(provider);

      expect(provider.searchShow).toHaveBeenCalledWith('Bluey', undefined);
      expect(provider.downloadShowPoster).toHaveBeenCalledWith('82728', 'https://img/p.jpg');
      const show = lib().mediaLibrary.Bluey;
      expect(show.ids).toEqual({ tvdb: null, imdb: null, tmdb: '82728' });
      expect(show.poster).toBe('file:///posters/82728.jpg');
      expect(show.title).toBe('Bluey');
      expect(show.year).toBe(2018);
      expect(progress.done).toBe(1);
      expect(dispatchProgress).toHaveBeenCalledTimes(1);
    });

    it('stores a TVDB provider result under ids.tvdb (and clears ids.tmdb)', async () => {
      seedLibrary({ Bluey: makeShow('Bluey', { ids: { tvdb: null, imdb: null, tmdb: 'stale' } }) });
      const provider = makeProvider('tvdb');
      provider.searchShow.mockResolvedValue([{ id: '353546', title: 'Bluey', year: 2018, posterUrl: 'u', posterThumbUrl: null }]);
      provider.downloadShowPoster.mockResolvedValue('file:///posters/tvdb.jpg');

      await run(provider);

      expect(lib().mediaLibrary.Bluey.ids).toEqual({ tvdb: '353546', imdb: null, tmdb: null });
    });

    it('passes the folder year to the search and prefers the result with that year', async () => {
      seedLibrary({ Doctor: makeShow('Doctor', { year: 2005 }) });
      const provider = makeProvider();
      provider.searchShow.mockResolvedValue([
        { id: '1', title: 'Doctor (1963)', year: 1963, posterUrl: 'u1', posterThumbUrl: null },
        { id: '2', title: 'Doctor (2005)', year: 2005, posterUrl: 'u2', posterThumbUrl: null },
      ]);
      provider.downloadShowPoster.mockResolvedValue('file:///p2.jpg');

      await run(provider);

      expect(provider.searchShow).toHaveBeenCalledWith('Doctor', 2005);
      expect(lib().mediaLibrary.Doctor.ids.tmdb).toBe('2');
      expect(lib().mediaLibrary.Doctor.title).toBe('Doctor (2005)');
    });

    it('falls back to the first result when none matches the folder year', async () => {
      seedLibrary({ Doctor: makeShow('Doctor', { year: 1999 }) });
      const provider = makeProvider();
      provider.searchShow.mockResolvedValue([
        { id: '1', title: 'A', year: 1963, posterUrl: 'u1', posterThumbUrl: null },
        { id: '2', title: 'B', year: 2005, posterUrl: 'u2', posterThumbUrl: null },
      ]);
      provider.downloadShowPoster.mockResolvedValue('file:///p1.jpg');

      await run(provider);

      expect(lib().mediaLibrary.Doctor.ids.tmdb).toBe('1');
    });

    it('leaves a show untouched (but still counts it) when there are no results or no poster url', async () => {
      seedLibrary({ None: makeShow('None'), NoPoster: makeShow('NoPoster') });
      const before = lib().mediaLibrary;
      const provider = makeProvider();
      provider.searchShow.mockImplementation(async (name: string) =>
        name === 'None' ? [] : [{ id: '3', title: 'NoPoster', year: 2000, posterUrl: null, posterThumbUrl: null }]);

      const { progress } = await run(provider);

      expect(provider.downloadShowPoster).not.toHaveBeenCalled();
      expect(lib().mediaLibrary).toEqual(before);
      expect(progress.done).toBe(2);
    });

    it('logs and continues past a provider error for one show', async () => {
      seedLibrary({ Boom: makeShow('Boom'), Fine: makeShow('Fine') });
      const provider = makeProvider();
      provider.searchShow.mockImplementation(async (name: string) => {
        if (name === 'Boom') throw new Error('search failed');
        return [{ id: '9', title: 'Fine', year: 2001, posterUrl: 'u', posterThumbUrl: null }];
      });
      provider.downloadShowPoster.mockResolvedValue('file:///fine.jpg');

      const { progress } = await run(provider);

      expect(lib().mediaLibrary.Boom.ids.tmdb).toBeNull();
      expect(lib().mediaLibrary.Fine.ids.tmdb).toBe('9');
      expect(logger.warn).toHaveBeenCalledWith('MetadataService', expect.stringContaining('"Boom"'), expect.any(Error));
      expect(progress.done).toBe(2);
    });

    it('skips (but still counts) shows when no provider is available', async () => {
      seedLibrary({ Bluey: makeShow('Bluey') });
      const { progress, resolve } = await run(null);
      expect(resolve).toHaveBeenCalledWith('Bluey', expect.anything());
      expect(lib().mediaLibrary.Bluey.ids.tmdb).toBeNull();
      expect(progress.done).toBe(1); // skipped items still count towards progress
    });

    it('stops processing when cancelled', async () => {
      seedLibrary({ A: makeShow('A'), B: makeShow('B') });
      const provider = makeProvider();
      provider.searchShow.mockResolvedValue([]);
      let calls = 0;

      const { progress } = await run(provider, { isCancelled: () => ++calls > 1 });

      expect(provider.searchShow).toHaveBeenCalledTimes(1);
      expect(progress.done).toBe(1);
    });

    describe('poster override', () => {
      it('applies an existing override poster without calling the provider', async () => {
        seedLibrary({ Bluey: makeShow('Bluey', { ids: { tvdb: null, imdb: null, tmdb: '82728' } }) });
        store.dispatch(setMediaOverride({ key: 'show:Bluey', override: { poster: 'file:///mine.jpg' } }));
        mockExistingFiles.add('file:///mine.jpg');
        const provider = makeProvider();

        const { progress, resolve } = await run(provider);

        expect(resolve).not.toHaveBeenCalled();
        expect(provider.searchShow).not.toHaveBeenCalled();
        expect(provider.downloadShowPoster).not.toHaveBeenCalled();
        expect(lib().mediaLibrary.Bluey.poster).toBe('file:///mine.jpg');
        expect(lib().mediaLibrary.Bluey.ids.tmdb).toBe('82728');
        expect(progress.done).toBe(1);
      });

      it('overrides the poster of a show that has no provider id without inventing one', async () => {
        seedLibrary({ Bluey: makeShow('Bluey') });
        store.dispatch(setMediaOverride({ key: 'show:Bluey', override: { poster: 'file:///mine.jpg' } }));
        mockExistingFiles.add('file:///mine.jpg');

        await run(makeProvider());

        expect(lib().mediaLibrary.Bluey.poster).toBe('file:///mine.jpg');
        expect(lib().mediaLibrary.Bluey.ids).toEqual({ tvdb: null, imdb: null, tmdb: null });
      });

      it('ignores an override whose file no longer exists and falls through to the provider', async () => {
        seedLibrary({ Bluey: makeShow('Bluey') });
        store.dispatch(setMediaOverride({ key: 'show:Bluey', override: { poster: 'file:///gone.jpg' } }));
        const provider = makeProvider();
        provider.searchShow.mockResolvedValue([{ id: '1', title: 'Bluey', year: 2018, posterUrl: 'u', posterThumbUrl: null }]);
        provider.downloadShowPoster.mockResolvedValue('file:///fresh.jpg');

        await run(provider);

        expect(provider.searchShow).toHaveBeenCalledTimes(1);
        expect(lib().mediaLibrary.Bluey.poster).toBe('file:///fresh.jpg');
      });

      it.each([
        ['TMDB-only', { tvdb: null, imdb: null, tmdb: '82728' }],
        ['TVDB-only', { tvdb: '353546', imdb: null, tmdb: null }],
        ['both ids (e.g. from an smb.json sidecar)', { tvdb: '353546', imdb: 'tt7678620', tmdb: '82728' }],
        ['no ids', { tvdb: null, imdb: null, tmdb: null }],
      ])('leaves ids untouched when applying a poster override: %s', async (_label, ids) => {
        seedLibrary({ Bluey: makeShow('Bluey', { ids: { ...ids }, title: 'Bluey', year: 2018 }) });
        store.dispatch(setMediaOverride({ key: 'show:Bluey', override: { poster: 'file:///mine.jpg' } }));
        mockExistingFiles.add('file:///mine.jpg');

        await run(makeProvider(ids.tvdb && !ids.tmdb ? 'tvdb' : 'tmdb'));

        const show = lib().mediaLibrary.Bluey;
        expect(show.ids).toEqual(ids);
        expect(show.poster).toBe('file:///mine.jpg');
        expect(show.title).toBe('Bluey');
        expect(show.year).toBe(2018);
      });

      it('still fetches episode data from the TVDB id after a poster override on a TVDB show', async () => {
        seedLibrary({ Bluey: makeShow('Bluey', { ids: { tvdb: '353546', imdb: null, tmdb: null } }) });
        store.dispatch(setMediaOverride({ key: 'show:Bluey', override: { poster: 'file:///mine.jpg' } }));
        mockExistingFiles.add('file:///mine.jpg');
        const provider = makeProvider('tvdb');
        provider.fetchSeasonEpisodes.mockResolvedValue([{ episodeNumber: 1, title: 'Magic Xylophone', stillUrl: null }]);

        await run(provider);
        await service.enrichEpisodes(lib().mediaLibrary, () => provider as unknown as IMetadataProvider, true, false, { done: 0 }, jest.fn());

        expect(provider.fetchSeasonEpisodes).toHaveBeenCalledWith('353546', 1);
        expect(lib().mediaLibrary.Bluey.seasons.s01.episodes.e01.resolvedTitle).toBe('Magic Xylophone');
      });
    });

    it('skips a show whose poster is already cached on disk', async () => {
      seedLibrary({ Bluey: makeShow('Bluey', { poster: 'file:///cached.jpg' }) });
      mockExistingFiles.add('file:///cached.jpg');
      const provider = makeProvider();

      const { progress, resolve } = await run(provider);

      expect(resolve).not.toHaveBeenCalled();
      expect(provider.searchShow).not.toHaveBeenCalled();
      expect(progress.done).toBe(1);
    });

    it('re-fetches when the cached poster file has disappeared', async () => {
      seedLibrary({ Bluey: makeShow('Bluey', { poster: 'file:///missing.jpg' }) });
      const provider = makeProvider();
      provider.searchShow.mockResolvedValue([{ id: '1', title: 'Bluey', year: 2018, posterUrl: 'u', posterThumbUrl: null }]);
      provider.downloadShowPoster.mockResolvedValue('file:///new.jpg');

      await run(provider);

      expect(lib().mediaLibrary.Bluey.poster).toBe('file:///new.jpg');
    });
  });

  // ── enrichMovies ───────────────────────────────────────────────────────────

  describe('enrichMovies', () => {
    const makeProvider = () => ({
      source: 'tmdb' as const,
      searchMovie: jest.fn(),
      downloadMoviePoster: jest.fn(),
    });

    const run = async (provider: ReturnType<typeof makeProvider>) => {
      const progress = { done: 0 };
      const resolve = jest.fn(() => provider as unknown as IMetadataProvider);
      await service.enrichMovies(lib().movies as IMediaObject[], resolve, progress, jest.fn());
      return { progress, resolve };
    };

    it('fetches the poster and id for a movie via the provider', async () => {
      store.dispatch(setMovies([makeMovie('Heat')]));
      const provider = makeProvider();
      provider.searchMovie.mockResolvedValue([{ id: '949', title: 'Heat', year: 1995, posterUrl: 'u', posterThumbUrl: null }]);
      provider.downloadMoviePoster.mockResolvedValue('file:///heat.jpg');

      await run(provider);

      expect(provider.searchMovie).toHaveBeenCalledWith('Heat');
      expect(lib().movies[0].ids.tmdb).toBe('949');
      expect(lib().movies[0].poster).toBe('file:///heat.jpg');
    });

    it('applies an existing poster override without calling the provider', async () => {
      store.dispatch(setMovies([makeMovie('Heat', { ids: { tvdb: null, imdb: null, tmdb: '949' } })]));
      store.dispatch(setMediaOverride({ key: 'movie:m/Heat.mkv', override: { poster: 'file:///mine.jpg' } }));
      mockExistingFiles.add('file:///mine.jpg');
      const provider = makeProvider();

      const { progress, resolve } = await run(provider);

      expect(resolve).not.toHaveBeenCalled();
      expect(provider.searchMovie).not.toHaveBeenCalled();
      expect(lib().movies[0].poster).toBe('file:///mine.jpg');
      expect(lib().movies[0].ids.tmdb).toBe('949');
      expect(progress.done).toBe(1);
    });

    it.each([
      ['TMDB-only', { tvdb: null, imdb: null, tmdb: '949' }],
      ['TVDB-only', { tvdb: '55', imdb: null, tmdb: null }],
      ['both ids (e.g. from an smb.json sidecar)', { tvdb: '55', imdb: 'tt0113277', tmdb: '949' }],
      ['no ids', { tvdb: null, imdb: null, tmdb: null }],
    ])('leaves ids untouched when applying a poster override: %s', async (_label, ids) => {
      store.dispatch(setMovies([makeMovie('Heat', { ids: { ...ids } })]));
      store.dispatch(setMediaOverride({ key: 'movie:m/Heat.mkv', override: { poster: 'file:///mine.jpg' } }));
      mockExistingFiles.add('file:///mine.jpg');

      await run(makeProvider());

      expect(lib().movies[0].ids).toEqual(ids);
      expect(lib().movies[0].poster).toBe('file:///mine.jpg');
    });

    it('does not touch a movie with no search results', async () => {
      store.dispatch(setMovies([makeMovie('Obscure')]));
      const provider = makeProvider();
      provider.searchMovie.mockResolvedValue([]);

      const { progress } = await run(provider);

      expect(lib().movies[0].poster).toBe('');
      expect(progress.done).toBe(1);
    });
  });

  // ── enrichAudiobooks ───────────────────────────────────────────────────────

  describe('enrichAudiobooks', () => {
    const provider = () => mockAudiobook as unknown as import('@/scripts/providers/AudiobookProvider').AudiobookProvider;

    it('looks up cover art and author via the audiobook provider', async () => {
      store.dispatch(setAudiobooks([makeAudiobook('Dune', { title: 'Dune', author: undefined })]));
      mockAudiobook.searchAudiobook.mockResolvedValue([{ id: 'it1', title: 'Dune', author: 'Frank Herbert', coverUrl: 'https://c' }]);
      mockAudiobook.downloadCover.mockResolvedValue('file:///dune.jpg');

      await service.enrichAudiobooks(lib().audiobooks as IMediaAudiobook[], provider(), { done: 0 }, jest.fn());

      expect(mockAudiobook.searchAudiobook).toHaveBeenCalledWith('Dune', undefined);
      expect(lib().audiobooks[0]).toMatchObject({ poster: 'file:///dune.jpg', author: 'Frank Herbert', ids: { itunes: 'it1' } });
    });

    it('applies a cover override without searching', async () => {
      store.dispatch(setAudiobooks([makeAudiobook('Dune')]));
      store.dispatch(setMediaOverride({ key: 'audiobook:Dune', override: { poster: 'file:///mine.jpg' } }));
      mockExistingFiles.add('file:///mine.jpg');
      const progress = { done: 0 };

      await service.enrichAudiobooks(lib().audiobooks as IMediaAudiobook[], provider(), progress, jest.fn());

      expect(mockAudiobook.searchAudiobook).not.toHaveBeenCalled();
      expect(lib().audiobooks[0].poster).toBe('file:///mine.jpg');
      expect(progress.done).toBe(1);
    });

    it('keeps the iTunes id when applying a cover override', async () => {
      store.dispatch(setAudiobooks([makeAudiobook('Dune', { ids: { itunes: 'it1' } })]));
      store.dispatch(setMediaOverride({ key: 'audiobook:Dune', override: { poster: 'file:///mine.jpg' } }));
      mockExistingFiles.add('file:///mine.jpg');

      await service.enrichAudiobooks(lib().audiobooks as IMediaAudiobook[], provider(), { done: 0 }, jest.fn());

      expect(lib().audiobooks[0].ids.itunes).toBe('it1');
      expect(lib().audiobooks[0].poster).toBe('file:///mine.jpg');
    });

    it('skips audiobooks with an empty title', async () => {
      store.dispatch(setAudiobooks([makeAudiobook('x', { title: '   ' })]));

      await service.enrichAudiobooks(lib().audiobooks as IMediaAudiobook[], provider(), { done: 0 }, jest.fn());

      expect(mockAudiobook.searchAudiobook).not.toHaveBeenCalled();
    });
  });

  // ── enrichAll (end to end with fake providers) ─────────────────────────────

  describe('enrichAll', () => {
    it('dedupes by name, enriches through the configured provider, fills in episode titles and ends with a progress update', async () => {
      store.dispatch(setTmdbApiKey('tmdb-key'));
      seedLibrary({
        "Grey's Anatomy": makeShow("Grey's Anatomy", {}, ['e01']),
        'Greys Anatomy': makeShow('Greys Anatomy', {}, ['e02']),
      });
      mockTmdb.searchShow.mockResolvedValue([{ id: '1416', title: "Grey's Anatomy", year: 2005, posterUrl: 'u', posterThumbUrl: null }]);
      mockTmdb.downloadShowPoster.mockResolvedValue('file:///grey.jpg');
      mockTmdb.fetchSeasonEpisodes.mockResolvedValue([
        { episodeNumber: 1, title: 'A Hard Day\'s Night', stillUrl: null },
        { episodeNumber: 2, title: 'The First Cut Is the Deepest', stillUrl: null },
        { episodeNumber: 3, title: 'not in library', stillUrl: null },
      ]);

      await service.enrichAll(lib().mediaLibrary, [], []);

      // One merged show, searched exactly once.
      expect(Object.keys(lib().mediaLibrary)).toEqual(["Grey's Anatomy"]);
      expect(mockTmdb.searchShow).toHaveBeenCalledTimes(1);
      expect(mockTmdb.searchShow).toHaveBeenCalledWith("Grey's Anatomy", undefined);

      const show = lib().mediaLibrary["Grey's Anatomy"];
      expect(show.ids.tmdb).toBe('1416');
      expect(show.poster).toBe('file:///grey.jpg');
      expect(show.year).toBe(2005);

      // Episode enrichment used the resolved id and only touched episodes that exist.
      expect(mockTmdb.fetchSeasonEpisodes).toHaveBeenCalledWith('1416', 1);
      expect(show.seasons.s01.episodes.e01.resolvedTitle).toBe("A Hard Day's Night");
      expect(show.seasons.s01.episodes.e02.resolvedTitle).toBe('The First Cut Is the Deepest');
      expect(show.seasons.s01.episodes.e03).toBeUndefined();

      // The last progress update reflects completed work (1 show + 1 season).
      expect(lib().scanProgress).toMatchObject({ phase: 'enriching', metadataDone: 2, metadataTotal: 2 });
      expect(global.fetch).not.toHaveBeenCalled();
    });

    it('does nothing to the library but still finishes when no provider keys are configured', async () => {
      seedLibrary({ Bluey: makeShow('Bluey') });
      const before = lib().mediaLibrary;

      await service.enrichAll(lib().mediaLibrary, [], []);

      expect(lib().mediaLibrary).toEqual(before);
      expect(mockTmdb.searchShow).not.toHaveBeenCalled();
    });

    it('returns early without enriching when already cancelled', async () => {
      store.dispatch(setTmdbApiKey('tmdb-key'));
      seedLibrary({ Bluey: makeShow('Bluey') });

      await service.enrichAll(lib().mediaLibrary, [], [], () => true);

      expect(mockTmdb.searchShow).not.toHaveBeenCalled();
    });
  });
});
