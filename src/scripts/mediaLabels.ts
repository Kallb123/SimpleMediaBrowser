// Type-only imports on purpose: this module stays free of runtime imports, so both the browse
// screen and the video player scripts can use it without pulling in the store.
import type { IMediaObject } from '@/scripts/libraryUtils';
import type { IMediaOverride } from '@/store/libraryReducer';

/** Returns the effective display label for a show, applying overrides if present. */
export function showDisplayLabel(showName: string, overrides: { [key: string]: IMediaOverride }): string {
  return overrides[`show:${showName}`]?.title ?? showName;
}

/** Returns the effective display label for an episode, applying overrides to the title portion. */
export function episodeDisplayLabel(ep: IMediaObject, overrides: { [key: string]: IMediaOverride }, prefix: string): string {
  const override = overrides[`episode:${ep.parsedPath}`];
  // Priority: user override > provider-resolved title > scanned (local) title
  const title = override?.title ?? ep.resolvedTitle ?? ep.title;
  if (prefix) {
    return title ? `${prefix} - ${title}` : prefix;
  }
  return title || ep.filename;
}

/** Returns the effective display label for a movie, applying overrides if present. */
export function movieDisplayLabel(movie: IMediaObject, overrides: { [key: string]: IMediaOverride }): string {
  return overrides[`movie:${movie.parsedPath}`]?.title ?? movie.title ?? movie.filename;
}
