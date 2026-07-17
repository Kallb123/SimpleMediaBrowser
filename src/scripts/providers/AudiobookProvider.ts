import { File, Directory, Paths } from 'expo-file-system';
import { logger } from '@/scripts/Logger';

/**
 * Local directory where downloaded audiobook cover art is persisted for offline use.
 * Kept separate from the TV/movie poster directories.
 */
const AUDIOBOOK_COVERS_DIR = new Directory(Paths.document, 'smb_audiobook_covers');

/** Base URL of the public iTunes Search API. */
const ITUNES_SEARCH_URL = 'https://itunes.apple.com/search';

/** Milliseconds to wait between successive iTunes API requests to stay well under rate limits. */
const REQUEST_DELAY_MS = 200;

function delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

async function ensureDir(dir: Directory): Promise<void> {
    if (!dir.exists) {
        dir.create({ intermediates: true, idempotent: true });
    }
}

/** A candidate audiobook match returned by the metadata provider. */
export interface AudiobookResult {
    /** Provider-specific ID (iTunes collectionId). */
    id: string;
    /** Canonical audiobook title. */
    title: string;
    /** Author / narrator, or undefined when unavailable. */
    author?: string;
    /** Release year, or 0 if unknown. */
    year: number;
    /** Full-resolution cover-art URL, or null if unavailable. */
    coverUrl: string | null;
    /** Thumbnail-sized cover URL suitable for previews. */
    coverThumbUrl: string | null;
}

interface ItunesAudiobookEntry {
    collectionId?: number;
    artistId?: number;
    collectionName?: string;
    artistName?: string;
    releaseDate?: string;
    artworkUrl100?: string;
    artworkUrl60?: string;
}

/**
 * Upgrades an iTunes artwork URL (which ends in e.g. `/100x100bb.jpg`) to a
 * higher-resolution variant by swapping the size segment.
 */
function upscaleArtworkUrl(url: string, size: number): string {
    return url.replace(/\/\d+x\d+bb\.(jpg|png)$/i, `/${size}x${size}bb.$1`);
}

function extractYear(dateString?: string): number {
    return dateString ? parseInt(dateString.substring(0, 4), 10) : 0;
}

/**
 * Metadata provider for audiobooks, backed by the public iTunes Search API.
 *
 * The iTunes Search API supports an `audiobook` media type and returns cover
 * artwork without requiring an API key, which makes it a good fit for looking
 * up audiobook cover art out of the box.
 */
export class AudiobookProvider {
    /**
     * Search for audiobooks matching the given title (and optional author).
     * Returns an ordered list of candidate matches.
     */
    async searchAudiobook(title: string, author?: string): Promise<AudiobookResult[]> {
        try {
            const term = author ? `${title} ${author}` : title;
            const url =
                `${ITUNES_SEARCH_URL}` +
                `?media=audiobook&entity=audiobook&limit=8` +
                `&term=${encodeURIComponent(term)}`;
            const response = await fetch(url);
            await delay(REQUEST_DELAY_MS);
            if (!response.ok) {
                logger.warn('AudiobookProvider', `Audiobook search failed for "${title}": HTTP ${response.status}`);
                return [];
            }
            const data = await response.json();
            const results: ItunesAudiobookEntry[] = data.results ?? [];
            return results
                .filter((r) => r.collectionId !== undefined)
                .map((r) => {
                    const artwork = r.artworkUrl100 ?? r.artworkUrl60 ?? null;
                    return {
                        id: String(r.collectionId),
                        title: r.collectionName ?? title,
                        author: r.artistName,
                        year: extractYear(r.releaseDate),
                        coverUrl: artwork ? upscaleArtworkUrl(artwork, 600) : null,
                        coverThumbUrl: artwork,
                    };
                });
        } catch (e) {
            logger.warn('AudiobookProvider', `searchAudiobook error for "${title}"`, e);
            return [];
        }
    }

    /**
     * Download an audiobook cover image and persist it locally.
     * @param id       The provider-specific audiobook ID (used to name the cache file).
     * @param coverUrl Full URL of the cover to download.
     * @returns Local `file://` URI of the cached cover.
     */
    async downloadCover(id: string, coverUrl: string): Promise<string> {
        await ensureDir(AUDIOBOOK_COVERS_DIR);
        const safeName = id.replace(/[^a-zA-Z0-9_-]/g, '_');
        const localFile = new File(AUDIOBOOK_COVERS_DIR, `${safeName}.jpg`);
        if (localFile.exists) {
            logger.log('AudiobookProvider', `Cover already cached for audiobook ID ${id}`);
            return localFile.uri;
        }
        logger.log('AudiobookProvider', `Downloading audiobook cover: ${coverUrl} → ${localFile.uri}`);
        await File.downloadFileAsync(coverUrl, localFile);
        return localFile.uri;
    }
}
