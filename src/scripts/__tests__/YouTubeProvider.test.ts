import { downloadYoutubeThumbnail, fetchYoutubeOEmbed } from '@/scripts/providers/YouTubeProvider';

/** Local uris for which `new File(uri).exists` is true. */
const mockExisting = new Set<string>();
const mockDownload = jest.fn();
jest.mock('expo-file-system', () => {
  class MockFile {
    static downloadFileAsync(url: string, dest: MockFile) {
      return mockDownload(url, dest);
    }
    uri: string;
    constructor(base: { uri: string }, name: string) {
      this.uri = `${base.uri}/${name}`;
    }
    get exists() { return mockExisting.has(this.uri); }
    delete() { mockExisting.delete(this.uri); }
  }
  class MockDirectory {
    uri: string;
    constructor(base: string, name: string) {
      this.uri = `${base}/${name}`;
    }
    get exists() { return true; }
    create() { /* always exists */ }
  }
  return { File: MockFile, Directory: MockDirectory, Paths: { document: 'file:///doc' } };
});

jest.mock('@/scripts/Logger', () => ({
  logger: { log: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

const realFetch = global.fetch;
const mockFetch = jest.fn();

const ID = 'dQw4w9WgXcQ';
const CACHED = `file:///doc/smb_posters/personal_yt_${ID}.jpg`;
const MAXRES = `https://i.ytimg.com/vi/${ID}/maxresdefault.jpg`;
const HQ = `https://i.ytimg.com/vi/${ID}/hqdefault.jpg`;

const jsonResponse = (body: unknown, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => body });

beforeEach(() => {
  jest.clearAllMocks();
  mockExisting.clear();
  mockDownload.mockReset();
  mockFetch.mockReset();
  global.fetch = mockFetch as unknown as typeof fetch;
});

afterAll(() => {
  global.fetch = realFetch;
});

describe('fetchYoutubeOEmbed', () => {
  it('looks the video up by its watch url and returns the title and channel', async () => {
    mockFetch.mockResolvedValue(jsonResponse({ title: ' Never Gonna Give You Up ', author_name: 'Rick Astley' }));

    await expect(fetchYoutubeOEmbed(ID)).resolves.toEqual({ title: 'Never Gonna Give You Up', channel: 'Rick Astley' });

    expect(mockFetch).toHaveBeenCalledWith(
      `https://www.youtube.com/oembed?url=${encodeURIComponent(`https://www.youtube.com/watch?v=${ID}`)}&format=json`,
    );
  });

  it('omits the channel when oEmbed has no author', async () => {
    mockFetch.mockResolvedValue(jsonResponse({ title: 'Untitled' }));
    await expect(fetchYoutubeOEmbed(ID)).resolves.toEqual({ title: 'Untitled' });
  });

  it.each([401, 403, 404])('returns null for HTTP %i (private, embedding disabled or removed video)', async (status) => {
    mockFetch.mockResolvedValue(jsonResponse({ title: 'ignored' }, status));
    await expect(fetchYoutubeOEmbed(ID)).resolves.toBeNull();
  });

  it('returns null for a response without a title', async () => {
    mockFetch.mockResolvedValue(jsonResponse({ author_name: 'Someone' }));
    await expect(fetchYoutubeOEmbed(ID)).resolves.toBeNull();
  });

  it('returns null when the request fails or the body is not JSON', async () => {
    mockFetch.mockRejectedValueOnce(new Error('offline'));
    await expect(fetchYoutubeOEmbed(ID)).resolves.toBeNull();

    mockFetch.mockResolvedValueOnce({ ok: true, status: 200, json: async () => { throw new Error('bad json'); } });
    await expect(fetchYoutubeOEmbed(ID)).resolves.toBeNull();
  });

  it('does not make a request for something that is not a YouTube id', async () => {
    await expect(fetchYoutubeOEmbed('short')).resolves.toBeNull();
    await expect(fetchYoutubeOEmbed('../../etc/passwd')).resolves.toBeNull();
    expect(mockFetch).not.toHaveBeenCalled();
  });
});

describe('downloadYoutubeThumbnail', () => {
  const dest = { uri: 'file:///elsewhere', exists: true, create: jest.fn() } as unknown as import('expo-file-system').Directory;

  it('downloads maxresdefault.jpg into the posters directory as personal_yt_<id>.jpg', async () => {
    mockDownload.mockResolvedValue(undefined);

    await expect(downloadYoutubeThumbnail(ID)).resolves.toBe(CACHED);

    expect(mockDownload).toHaveBeenCalledTimes(1);
    expect(mockDownload).toHaveBeenCalledWith(MAXRES, expect.objectContaining({ uri: CACHED }));
  });

  it('falls back to hqdefault.jpg when maxresdefault.jpg is missing (HTTP 404)', async () => {
    mockDownload.mockImplementation(async (url: string) => {
      if (url === MAXRES) throw new Error('response has status: 404');
    });

    await expect(downloadYoutubeThumbnail(ID)).resolves.toBe(CACHED);

    expect(mockDownload.mock.calls.map(([url]) => url)).toEqual([MAXRES, HQ]);
  });

  it('returns null and leaves no file behind when no size can be downloaded', async () => {
    mockDownload.mockImplementation(async (_url: string, file: { uri: string }) => {
      mockExisting.add(file.uri); // a failed transfer that left a partial file
      throw new Error('response has status: 404');
    });

    await expect(downloadYoutubeThumbnail(ID)).resolves.toBeNull();

    expect(mockDownload.mock.calls.map(([url]) => url)).toEqual([MAXRES, HQ]);
    expect(mockExisting.has(CACHED)).toBe(false);
  });

  it('returns an already-cached thumbnail without any network access', async () => {
    mockExisting.add(CACHED);

    await expect(downloadYoutubeThumbnail(ID)).resolves.toBe(CACHED);

    expect(mockDownload).not.toHaveBeenCalled();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('writes into the given directory', async () => {
    mockDownload.mockResolvedValue(undefined);

    await expect(downloadYoutubeThumbnail(ID, dest)).resolves.toBe(`file:///elsewhere/personal_yt_${ID}.jpg`);

    expect(mockDownload).toHaveBeenCalledWith(MAXRES, expect.objectContaining({ uri: `file:///elsewhere/personal_yt_${ID}.jpg` }));
  });

  it('rejects ids that are not 11 safe characters before touching the network or disk', async () => {
    await expect(downloadYoutubeThumbnail('../evil')).resolves.toBeNull();
    await expect(downloadYoutubeThumbnail('')).resolves.toBeNull();
    expect(mockDownload).not.toHaveBeenCalled();
  });
});
