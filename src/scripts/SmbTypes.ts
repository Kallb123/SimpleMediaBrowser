/**
 * Types for the smb.json file format written alongside media files.
 * These are read by FileScanner during library scanning and written by
 * ImportExportService during filesystem metadata export.
 *
 * Kept in a separate file to avoid circular imports between FileScanner and
 * ImportExportService.
 */

export interface SmbJsonEpisodeData {
    /** Display title for the episode (from the metadata provider). */
    title?: string;
    /** Relative filename of the episode thumbnail image in the same directory. */
    thumbnailFile?: string;
}

export interface SmbJsonSeasonData {
    /** Episode entries keyed by episode key (e.g. "e01", "e02"). */
    episodes: Record<string, SmbJsonEpisodeData>;
}

/** smb.json file written to a TV show folder. */
export interface SmbJsonShowData {
    smbVersion: 1;
    type: 'show';
    /** Canonical title from the metadata provider. */
    title?: string;
    /** Release year. */
    year?: number;
    /** Provider IDs fetched during metadata enrichment. */
    ids: { tmdb: string | null; tvdb: string | null; imdb: string | null };
    /** Metadata provider used to enrich this show. */
    metadataSource?: 'tmdb' | 'tvdb';
    /** User-supplied overrides for title, sort key, visibility, etc. */
    overrides?: {
        title?: string;
        sortTitle?: string;
        year?: number;
        hidden?: boolean;
    };
    /** Season/episode metadata keyed by season key (e.g. "s01"). */
    seasons?: Record<string, SmbJsonSeasonData>;
}

/** smb.json file written to a movie folder. */
export interface SmbJsonMovieData {
    smbVersion: 1;
    type: 'movie';
    /** Canonical title from the metadata provider. */
    title?: string;
    /** Release year. */
    year?: number;
    /** Provider IDs fetched during metadata enrichment. */
    ids: { tmdb: string | null; tvdb: string | null; imdb: string | null };
    /** Metadata provider used to enrich this movie. */
    metadataSource?: 'tmdb' | 'tvdb';
    /** User-supplied overrides for title, sort key, visibility, etc. */
    overrides?: {
        title?: string;
        sortTitle?: string;
        year?: number;
        hidden?: boolean;
    };
}

export type SmbJsonData = SmbJsonShowData | SmbJsonMovieData;
