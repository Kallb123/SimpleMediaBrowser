import type { dataSources } from '@/store/settingsReducer';

/** A candidate show match returned by a metadata provider's search. */
export interface ProviderShowResult {
    /** Provider-specific string ID for this show. */
    id: string;
    /** Canonical display title from the provider. */
    title: string;
    /** First-aired year, or 0 if unknown. */
    year: number;
    /** Full-resolution URL of the show poster, or null if unavailable. */
    posterUrl: string | null;
    /** Thumbnail-sized URL suitable for display in search results. Equal to posterUrl when the provider doesn't offer separate thumbnails. */
    posterThumbUrl: string | null;
}

/** A candidate movie match returned by a metadata provider's search. */
export interface ProviderMovieResult {
    /** Provider-specific string ID for this movie. */
    id: string;
    /** Canonical display title from the provider. */
    title: string;
    /** Release year, or 0 if unknown. */
    year: number;
    /** Full-resolution URL of the movie poster, or null if unavailable. */
    posterUrl: string | null;
    /** Thumbnail-sized URL suitable for display in search results. */
    posterThumbUrl: string | null;
}

/** A single episode's metadata as returned by a metadata provider. */
export interface ProviderEpisode {
    /** 1-based episode number within its season. */
    episodeNumber: number;
    /** Episode title from the provider, or undefined if unavailable. */
    title?: string;
    /** Full URL of the episode still image, or null if unavailable. */
    stillUrl: string | null;
}

/**
 * Common interface that every metadata provider (TMDB, TVDB, …) must implement.
 * All methods return provider-agnostic result types so callers can be written
 * once and work with any configured provider.
 */
export interface IMetadataProvider {
    /** Identifies which data source this provider represents. */
    readonly source: dataSources;

    /**
     * Search for TV shows matching the given name.
     * @param name  Normalised show name (year suffix already stripped).
     * @param year  Optional year hint for disambiguation.
     */
    searchShow(name: string, year?: number): Promise<ProviderShowResult[]>;

    /**
     * Search for movies matching the given title.
     * @param title  Normalised movie title.
     * @param year   Optional year hint for disambiguation.
     */
    searchMovie(title: string, year?: number): Promise<ProviderMovieResult[]>;

    /**
     * Download a show poster and persist it locally.
     * @param providerId  The provider-specific show ID (used to name the cache file).
     * @param posterUrl   Full URL of the poster to download.
     * @returns Local `file://` URI of the cached poster.
     */
    downloadShowPoster(providerId: string, posterUrl: string): Promise<string>;

    /**
     * Download a movie poster and persist it locally.
     * @param providerId  The provider-specific movie ID.
     * @param posterUrl   Full URL of the poster to download.
     * @returns Local `file://` URI of the cached poster.
     */
    downloadMoviePoster(providerId: string, posterUrl: string): Promise<string>;

    /**
     * Fetch all episodes for a specific season of a show.
     * @param showProviderId  The provider-specific show ID.
     * @param seasonNumber    Season number (1-based; use 0 for specials).
     */
    fetchSeasonEpisodes(showProviderId: string, seasonNumber: number): Promise<ProviderEpisode[]>;

    /**
     * Download an episode still image and persist it locally.
     * @param key      A unique string key (e.g. "12345_S01_E03") used as the cache filename.
     * @param stillUrl Full URL of the still image.
     * @returns Local `file://` URI of the cached thumbnail.
     */
    downloadEpisodeThumbnail(key: string, stillUrl: string): Promise<string>;
}
