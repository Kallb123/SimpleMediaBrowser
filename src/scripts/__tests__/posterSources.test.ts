import {
  copyPickedPoster,
  downloadProviderPoster,
  fetchPosterGallery,
  hasProviderKey,
  searchProvider,
} from '@/scripts/posterSources';
import type { ProviderCredentials, ProviderSearchResult } from '@/scripts/posterSources';

// ── Mocks ────────────────────────────────────────────────────────────────────

/** URIs for which `new File(...).exists` is true. */
const mockExistingFiles = new Set<string>();
const mockDownloads: { url: string; uri: string }[] = [];
const mockCopyFails = { value: false };
const mockWrites: { uri: string; data: string }[] = [];
const mockCreatedDirs: string[] = [];

jest.mock('expo-file-system', () => {
  class MockDirectory {
    uri: string;
    constructor(base: { uri: string } | string, name?: string) {
      const baseUri = typeof base === 'string' ? base : base.uri;
      this.uri = name ? `${baseUri}/${name}` : baseUri;
    }
    get exists() {
      return false;
    }
    create() {
      mockCreatedDirs.push(this.uri);
    }
  }
  class MockFile {
    uri: string;
    constructor(base: { uri: string } | string, name?: string) {
      const baseUri = typeof base === 'string' ? base : base.uri;
      this.uri = name ? `${baseUri}/${name}` : baseUri;
    }
    get exists() {
      return mockExistingFiles.has(this.uri);
    }
    static async downloadFileAsync(url: string, dest: { uri: string }) {
      mockDownloads.push({ url, uri: dest.uri });
    }
    async copy() {
      if (mockCopyFails.value) throw new Error('copy failed');
    }
    async base64() {
      return 'BASE64DATA';
    }
    async write(data: string) {
      mockWrites.push({ uri: this.uri, data });
    }
  }
  return {
    File: MockFile,
    Directory: MockDirectory,
    Paths: { document: { uri: 'file:///doc' } },
  };
});

jest.mock('@/scripts/Logger', () => ({
  logger: { log: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

const mockTvdb = {
  authenticate: jest.fn(),
  searchShow: jest.fn(),
  fetchSeriesPosters: jest.fn(),
};
const mockTvdbCtor = jest.fn();
jest.mock('@/scripts/providers/TvdbProvider', () => ({
  TvdbProvider: class {
    constructor(...args: unknown[]) {
      mockTvdbCtor(...args);
    }
    authenticate() { return mockTvdb.authenticate(); }
    searchShow(...a: unknown[]) { return mockTvdb.searchShow(...a); }
    fetchSeriesPosters(...a: unknown[]) { return mockTvdb.fetchSeriesPosters(...a); }
  },
}));

const mockFetch = jest.fn();
const realFetch = global.fetch;

function jsonResponse(body: unknown, ok = true, status = 200) {
  return { ok, status, json: async () => body };
}

const creds: ProviderCredentials = { tmdbApiKey: 'tmdb key', tvdbApiKey: 'tvdbkey', tvdbPin: 'pin1' };

beforeEach(() => {
  mockFetch.mockReset();
  mockFetch.mockImplementation(() => {
    throw new Error('unexpected fetch');
  });
  global.fetch = mockFetch as unknown as typeof fetch;
  mockExistingFiles.clear();
  mockDownloads.length = 0;
  mockWrites.length = 0;
  mockCreatedDirs.length = 0;
  mockCopyFails.value = false;
  mockTvdb.authenticate.mockReset();
  mockTvdb.searchShow.mockReset();
  mockTvdb.fetchSeriesPosters.mockReset();
  mockTvdbCtor.mockReset();
});

afterAll(() => {
  global.fetch = realFetch;
});

// ── Tests ────────────────────────────────────────────────────────────────────

describe('hasProviderKey', () => {
  it('checks the key belonging to the given provider', () => {
    expect(hasProviderKey('tmdb', { tmdbApiKey: 'k', tvdbApiKey: null, tvdbPin: null })).toBe(true);
    expect(hasProviderKey('tvdb', { tmdbApiKey: 'k', tvdbApiKey: null, tvdbPin: null })).toBe(false);
    expect(hasProviderKey('tvdb', { tmdbApiKey: undefined, tvdbApiKey: 'k', tvdbPin: undefined })).toBe(true);
    expect(hasProviderKey('tmdb', { tmdbApiKey: '', tvdbApiKey: 'k', tvdbPin: null })).toBe(false);
  });
});

describe('searchProvider (TMDB)', () => {
  it('builds the search URL and normalises tv and movie results', async () => {
    mockFetch.mockResolvedValue(jsonResponse({
      results: [
        { id: 1, name: 'Show Name', poster_path: '/abc.jpg', first_air_date: '2011-04-17' },
        { id: 2, title: 'Movie Title', poster_path: null, release_date: '1999-03-31' },
        { id: 3, name: 'No Date', poster_path: '/z.jpg' },
        { id: 4, title: 'Empty Date', poster_path: null, release_date: '' },
      ],
    }));

    const results = await searchProvider('tmdb', 'The Show (2011)', 'tv', creds);

    const url = mockFetch.mock.calls[0][0] as string;
    expect(url).toContain('https://api.themoviedb.org/3/search/tv?');
    expect(url).toContain('api_key=tmdb%20key');
    expect(url).toContain('&language=en-US&page=1');
    expect(url).toContain('query=');
    expect(results).toEqual([
      { provider: 'tmdb', id: '1', title: 'Show Name', year: 2011, thumbUrl: 'https://image.tmdb.org/t/p/w185/abc.jpg', posterRef: '/abc.jpg' },
      { provider: 'tmdb', id: '2', title: 'Movie Title', year: 1999, thumbUrl: null, posterRef: null },
      { provider: 'tmdb', id: '3', title: 'No Date', year: undefined, thumbUrl: 'https://image.tmdb.org/t/p/w185/z.jpg', posterRef: '/z.jpg' },
      { provider: 'tmdb', id: '4', title: 'Empty Date', year: undefined, thumbUrl: null, posterRef: null },
    ]);
  });

  it('uses the movie endpoint for movie searches', async () => {
    mockFetch.mockResolvedValue(jsonResponse({ results: [] }));
    await searchProvider('tmdb', 'x', 'movie', creds);
    expect(mockFetch.mock.calls[0][0]).toContain('/search/movie?');
  });

  it('returns an empty array when the response has no results field', async () => {
    mockFetch.mockResolvedValue(jsonResponse({}));
    expect(await searchProvider('tmdb', 'x', 'tv', creds)).toEqual([]);
  });

  it('throws on a non-OK response', async () => {
    mockFetch.mockResolvedValue(jsonResponse({}, false, 401));
    await expect(searchProvider('tmdb', 'x', 'tv', creds)).rejects.toThrow('HTTP 401');
  });

  it('throws when the TMDB key is missing', async () => {
    await expect(
      searchProvider('tmdb', 'x', 'tv', { ...creds, tmdbApiKey: null }),
    ).rejects.toThrow();
    expect(mockFetch).not.toHaveBeenCalled();
  });
});

describe('searchProvider (TVDB)', () => {
  it('authenticates, searches, and normalises results', async () => {
    mockTvdb.searchShow.mockResolvedValue([
      { id: '81189', title: 'Breaking Bad', year: 2008, posterUrl: 'https://art/full.jpg', posterThumbUrl: 'https://art/thumb.jpg' },
      { id: '2', title: 'Unknown Year', year: 0, posterUrl: null, posterThumbUrl: null },
    ]);

    const results = await searchProvider('tvdb', 'Breaking Bad', 'movie', creds);

    expect(mockTvdbCtor).toHaveBeenCalledWith('tvdbkey', 'pin1');
    expect(mockTvdb.authenticate).toHaveBeenCalled();
    expect(mockTvdb.searchShow).toHaveBeenCalledWith('Breaking Bad');
    expect(mockFetch).not.toHaveBeenCalled();
    expect(results).toEqual([
      { provider: 'tvdb', id: '81189', title: 'Breaking Bad', year: 2008, thumbUrl: 'https://art/thumb.jpg', posterRef: 'https://art/full.jpg' },
      { provider: 'tvdb', id: '2', title: 'Unknown Year', year: undefined, thumbUrl: null, posterRef: null },
    ]);
  });

  it('passes an undefined pin when none is set', async () => {
    mockTvdb.searchShow.mockResolvedValue([]);
    await searchProvider('tvdb', 'x', 'tv', { ...creds, tvdbPin: null });
    expect(mockTvdbCtor).toHaveBeenCalledWith('tvdbkey', undefined);
  });

  it('throws when the TVDB key is missing', async () => {
    await expect(
      searchProvider('tvdb', 'x', 'tv', { ...creds, tvdbApiKey: undefined }),
    ).rejects.toThrow();
  });
});

describe('fetchPosterGallery', () => {
  const tmdbResult: ProviderSearchResult = {
    provider: 'tmdb', id: '55', title: 'T', thumbUrl: null, posterRef: '/own.jpg',
  };
  const tvdbResult: ProviderSearchResult = {
    provider: 'tvdb', id: '77', title: 'T', thumbUrl: null, posterRef: 'https://art/own.jpg',
  };

  it('fetches TMDB images using the requested content type', async () => {
    mockFetch.mockResolvedValue(jsonResponse({ posters: [{ file_path: '/a.jpg' }, { file_path: '/b.jpg' }] }));

    const gallery = await fetchPosterGallery(tmdbResult, 'movie', creds);

    expect(mockFetch.mock.calls[0][0]).toBe(
      'https://api.themoviedb.org/3/movie/55/images?api_key=tmdb%20key&include_image_language=en,null',
    );
    expect(gallery).toEqual([
      { ref: '/a.jpg', thumbUrl: 'https://image.tmdb.org/t/p/w185/a.jpg' },
      { ref: '/b.jpg', thumbUrl: 'https://image.tmdb.org/t/p/w185/b.jpg' },
    ]);
  });

  it('falls back to the result poster when TMDB returns none', async () => {
    mockFetch.mockResolvedValue(jsonResponse({ posters: [] }));
    expect(await fetchPosterGallery(tmdbResult, 'tv', creds)).toEqual([
      { ref: '/own.jpg', thumbUrl: 'https://image.tmdb.org/t/p/w185/own.jpg' },
    ]);
  });

  it('returns an empty gallery when there is nothing and no fallback', async () => {
    mockFetch.mockResolvedValue(jsonResponse({}));
    expect(await fetchPosterGallery({ ...tmdbResult, posterRef: null }, 'tv', creds)).toEqual([]);
  });

  it('throws on a non-OK TMDB response', async () => {
    mockFetch.mockResolvedValue(jsonResponse({}, false, 500));
    await expect(fetchPosterGallery(tmdbResult, 'tv', creds)).rejects.toThrow('HTTP 500');
  });

  it('returns TVDB posters using the full URL as the thumbnail', async () => {
    mockTvdb.fetchSeriesPosters.mockResolvedValue(['https://art/1.jpg', 'https://art/2.jpg']);

    const gallery = await fetchPosterGallery(tvdbResult, 'tv', creds);

    expect(mockTvdb.fetchSeriesPosters).toHaveBeenCalledWith('77');
    expect(gallery).toEqual([
      { ref: 'https://art/1.jpg', thumbUrl: 'https://art/1.jpg' },
      { ref: 'https://art/2.jpg', thumbUrl: 'https://art/2.jpg' },
    ]);
  });

  it('falls back to the result poster when TVDB returns none', async () => {
    mockTvdb.fetchSeriesPosters.mockResolvedValue([]);
    expect(await fetchPosterGallery(tvdbResult, 'tv', creds)).toEqual([
      { ref: 'https://art/own.jpg', thumbUrl: 'https://art/own.jpg' },
    ]);
  });
});

describe('downloadProviderPoster', () => {
  it('downloads a TMDB poster into smb_posters keyed by the poster path basename', async () => {
    const uri = await downloadProviderPoster('tmdb', '55', '/aBc-De_1.jpg');
    expect(uri).toBe('file:///doc/smb_posters/aBc-De_1.jpg');
    expect(mockDownloads).toEqual([
      { url: 'https://image.tmdb.org/t/p/w500/aBc-De_1.jpg', uri: 'file:///doc/smb_posters/aBc-De_1.jpg' },
    ]);
    expect(mockCreatedDirs).toContain('file:///doc/smb_posters');
  });

  it('returns the cached TMDB file without downloading again', async () => {
    mockExistingFiles.add('file:///doc/smb_posters/cached.jpg');
    const uri = await downloadProviderPoster('tmdb', '1', '/cached.jpg');
    expect(uri).toBe('file:///doc/smb_posters/cached.jpg');
    expect(mockDownloads).toHaveLength(0);
  });

  it('downloads a TVDB poster into smb_posters_tvdb keyed by id and URL basename', async () => {
    const uri = await downloadProviderPoster('tvdb', '81189', 'https://artworks.thetvdb.com/banners/posters/81189-1.jpg');
    expect(uri).toBe('file:///doc/smb_posters_tvdb/81189_81189-1.jpg');
    expect(mockDownloads).toEqual([
      { url: 'https://artworks.thetvdb.com/banners/posters/81189-1.jpg', uri: 'file:///doc/smb_posters_tvdb/81189_81189-1.jpg' },
    ]);
    expect(mockCreatedDirs).toContain('file:///doc/smb_posters_tvdb');
  });

  it('returns the cached TVDB file without downloading again', async () => {
    mockExistingFiles.add('file:///doc/smb_posters_tvdb/9_p.jpg');
    const uri = await downloadProviderPoster('tvdb', '9', 'https://x/y/p.png');
    expect(uri).toBe('file:///doc/smb_posters_tvdb/9_p.jpg');
    expect(mockDownloads).toHaveLength(0);
  });
});

describe('copyPickedPoster', () => {
  it('copies into smb_posters using a sanitised key', async () => {
    const uri = await copyPickedPoster('content://picked/1', 'show:My Show');
    expect(uri).toBe('file:///doc/smb_posters/show_My_Show_custom.jpg');
    expect(mockWrites).toHaveLength(0);
  });

  it('falls back to base64 when a direct copy fails', async () => {
    mockCopyFails.value = true;
    const uri = await copyPickedPoster('content://picked/1', 'movie:a/b.mkv');
    expect(uri).toBe('file:///doc/smb_posters/movie_a_b_mkv_custom.jpg');
    expect(mockWrites).toEqual([{ uri, data: 'BASE64DATA' }]);
  });
});
