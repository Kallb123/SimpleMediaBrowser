import { File, Directory, Paths } from 'expo-file-system';
import { logger } from '@/scripts/Logger';

/**
 * Keyless YouTube lookups for Personal videos: the title/channel from the public oEmbed
 * endpoint and the video's thumbnail from i.ytimg.com.  Unlike the TMDB/TVDB/iTunes providers
 * this is not an `IMetadataProvider` (it searches nothing and is not a selectable data source);
 * `MetadataService.enrichPersonal` calls it for videos whose YouTube id is already known.
 */

/** Same persistent poster directory the other providers and `copyLocalPoster` use. */
const POSTERS_DIR = new Directory(Paths.document, 'smb_posters');

/** A YouTube video id; also keeps anything path-like out of the cache filename. */
const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/;

/** Thumbnail names tried in order: the full-size frame (missing for many videos), then the always-present 480x360 one. */
const THUMBNAIL_NAMES = ['maxresdefault.jpg', 'hqdefault.jpg'];

export interface YoutubeOEmbed {
    title: string;
    /** oEmbed `author_name`, the uploading channel. */
    channel?: string;
}

/**
 * Looks up a video's title and channel via YouTube's oEmbed endpoint (no API key).
 * Returns null when the video is private/removed/unknown (HTTP 4xx), the response has no
 * title, or the request fails.
 */
export async function fetchYoutubeOEmbed(id: string): Promise<YoutubeOEmbed | null> {
    if (!YOUTUBE_ID.test(id)) return null;
    try {
        const watchUrl = `https://www.youtube.com/watch?v=${id}`;
        const response = await fetch(`https://www.youtube.com/oembed?url=${encodeURIComponent(watchUrl)}&format=json`);
        if (!response.ok) {
            logger.warn('YouTubeProvider', `oEmbed lookup failed for ${id}: HTTP ${response.status}`);
            return null;
        }
        const data = await response.json();
        const title = typeof data?.title === 'string' ? data.title.trim() : '';
        if (!title) {
            logger.warn('YouTubeProvider', `oEmbed response for ${id} has no title`);
            return null;
        }
        const channel = typeof data.author_name === 'string' ? data.author_name.trim() : '';
        return channel ? { title, channel } : { title };
    } catch (e) {
        logger.warn('YouTubeProvider', `oEmbed lookup error for ${id}`, e);
        return null;
    }
}

/**
 * Downloads a video's thumbnail (`maxresdefault.jpg`, falling back to `hqdefault.jpg`) into
 * `destDir` as `personal_yt_<id>.jpg` and returns its local `file://` URI, or null when no
 * thumbnail could be fetched.  An already-cached file is returned without any network access.
 *
 * i.ytimg.com answers 404 for a missing size.  `File.downloadFileAsync` rejects on any
 * non-2xx status before it writes anything, so an error page is never saved as an image; a
 * file left behind by a download that failed part-way is deleted before the next attempt.
 */
export async function downloadYoutubeThumbnail(id: string, destDir: Directory = POSTERS_DIR): Promise<string | null> {
    if (!YOUTUBE_ID.test(id)) return null;
    try {
        if (!destDir.exists) {
            destDir.create({ intermediates: true, idempotent: true });
        }
        const localFile = new File(destDir, `personal_yt_${id}.jpg`);
        if (localFile.exists) {
            logger.log('YouTubeProvider', `Thumbnail already cached for ${id}`);
            return localFile.uri;
        }
        for (const name of THUMBNAIL_NAMES) {
            const url = `https://i.ytimg.com/vi/${id}/${name}`;
            try {
                await File.downloadFileAsync(url, localFile);
                logger.log('YouTubeProvider', `Downloaded ${name} for ${id} → ${localFile.uri}`);
                return localFile.uri;
            } catch (e) {
                logger.log('YouTubeProvider', `No usable ${name} for ${id}`, e);
                try {
                    if (localFile.exists) localFile.delete();
                } catch {
                    // Nothing more to do; the next attempt or scan will overwrite or ignore it.
                }
            }
        }
        logger.warn('YouTubeProvider', `No thumbnail could be downloaded for ${id}`);
        return null;
    } catch (e) {
        logger.warn('YouTubeProvider', `downloadYoutubeThumbnail error for ${id}`, e);
        return null;
    }
}
