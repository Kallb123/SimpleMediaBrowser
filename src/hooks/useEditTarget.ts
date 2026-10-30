import { useDispatch, useSelector } from 'react-redux';
import {
  selectAudiobooks,
  selectMediaLibrary,
  selectMediaOverrides,
  selectMovies,
  selectPersonal,
  setAudiobookPoster,
  setMediaOverride,
  setMoviePoster,
  updatePersonalMetadata,
  updateShowPoster,
} from '@/store/libraryReducer';
import type { IMediaOverride, dataSources } from '@/store/libraryReducer';
import { selectDataSource, selectTmdbApiKey, selectTvdbApiKey, selectTvdbPin } from '@/store/settingsReducer';
import type { ProviderCredentials } from '@/scripts/posterSources';

export type EditItemType = 'show' | 'movie' | 'episode' | 'audiobook' | 'personal';

/** Human-readable label for an item type, used in Edit Item screen headers. */
export function itemTypeLabel(itemType: EditItemType): string {
  return itemType === 'show' ? 'TV Show'
    : itemType === 'movie' ? 'Movie'
      : itemType === 'audiobook' ? 'Audiobook'
        : itemType === 'personal' ? 'Personal Video'
          : 'Episode';
}

/**
 * Live store-derived state and poster-apply action for the item being edited
 * (shared by the Edit Item, Choose Poster and Re-match screens).
 * `itemKey` is the mediaOverrides key, e.g. "show:<name>", "movie:<parsedPath>",
 * "personal:<parsedPath>" or "audiobook:<folderKey>".
 */
export function useEditTarget(itemType: EditItemType, itemKey: string) {
  const dispatch = useDispatch();
  const mediaOverrides = useSelector(selectMediaOverrides);
  const mediaLibrary = useSelector(selectMediaLibrary);
  const movies = useSelector(selectMovies);
  const audiobooks = useSelector(selectAudiobooks);
  const personal = useSelector(selectPersonal);
  const tmdbApiKey = useSelector(selectTmdbApiKey);
  const tvdbApiKey = useSelector(selectTvdbApiKey);
  const tvdbPin = useSelector(selectTvdbPin);
  const globalDataSource = useSelector(selectDataSource);

  const override: IMediaOverride = mediaOverrides[itemKey] ?? {};

  const showName = itemType === 'show' ? itemKey.replace(/^show:/, '') : '';
  const moviePath = itemType === 'movie' ? itemKey.replace(/^movie:/, '') : '';
  const personalPath = itemType === 'personal' ? itemKey.replace(/^personal:/, '') : '';
  // Folder key for audiobook items (itemKey is "audiobook:<folderKey>").
  const audiobookFolderKey = itemType === 'audiobook' ? itemKey.replace(/^audiobook:/, '') : '';
  const show = itemType === 'show' ? mediaLibrary[showName] : undefined;
  const movie = itemType === 'movie' ? movies.find((m) => m.parsedPath === moviePath) : undefined;
  const personalVideo = itemType === 'personal' ? personal.find((v) => v.parsedPath === personalPath) : undefined;

  // Current poster URI: prefer the override poster, then the library poster.
  const libraryPoster = itemType === 'show' ? show?.poster ?? ''
    : itemType === 'movie' ? movie?.poster ?? ''
      : itemType === 'audiobook' ? audiobooks.find((a) => a.folderKey === audiobookFolderKey)?.poster ?? ''
        : itemType === 'personal' ? personalVideo?.poster ?? ''
          : '';
  const currentPoster = override.poster || libraryPoster || '';

  // Current provider IDs (override takes priority, then library data).
  const currentTmdbId: string | null = override.tmdbId || (show ?? movie)?.ids.tmdb || null;
  const currentTvdbId: string | null = override.tvdbId || (show ?? movie)?.ids.tvdb || null;

  const resolvedProvider: dataSources = override.metadataSourceOverride
    ?? (itemType === 'show' ? show?.metadataSource : undefined)
    ?? globalDataSource;

  const hasProviderSupport = (itemType === 'show' || itemType === 'movie') && (!!tmdbApiKey || !!tvdbApiKey);

  const credentials: ProviderCredentials = { tmdbApiKey, tvdbApiKey, tvdbPin };

  /** Apply a chosen poster URI to the library and persist it in overrides. */
  const applyPoster = (localUri: string) => {
    if (itemType === 'show') {
      dispatch(updateShowPoster({ showName, poster: localUri }));
    } else if (itemType === 'movie') {
      if (movie) {
        dispatch(setMoviePoster({ path: movie.path, poster: localUri }));
      }
    } else if (itemType === 'personal') {
      if (personalVideo) {
        dispatch(updatePersonalMetadata({ path: personalVideo.path, poster: localUri }));
      }
    } else if (itemType === 'audiobook') {
      dispatch(setAudiobookPoster({ folderKey: audiobookFolderKey, poster: localUri }));
    }
    // Persist the poster URI in mediaOverrides so it survives rescans.
    dispatch(setMediaOverride({ key: itemKey, override: { poster: localUri } }));
  };

  return {
    override,
    currentPoster,
    /** The Personal video's YouTube id from its filename or info.json, if any. */
    personalYoutubeId: personalVideo?.youtubeId,
    currentTmdbId,
    currentTvdbId,
    resolvedProvider,
    hasProviderSupport,
    credentials,
    applyPoster,
  };
}
