/**
 * Pure helpers behind the Personal browse screen: which videos are shown, how they are grouped
 * for the current layout and level, and the aggregate timestamps of a folder tile. Kept free of
 * runtime imports besides `personalLibrary` so it can be unit-tested without the store.
 */
import {
  personalDisplayTitle,
  personalFolderLevel,
  personalOverrideKey,
  type IPersonalVideo,
  type PersonalFolderEntry,
} from '@/scripts/personalLibrary';
import type { IMediaOverride } from '@/store/libraryReducer';
import type { personalLayouts } from '@/store/settingsReducer';

type Overrides = { [key: string]: IMediaOverride };

/** A folder tile at one level: the subtree's videos plus the timestamps the folder inherits from them. */
export interface PersonalBrowseFolder extends PersonalFolderEntry {
  /** Latest `lastOpened` among the subtree's videos. */
  lastOpened?: number;
  /** Latest `firstDetected` among the subtree's videos. */
  firstDetected?: number;
}

export interface PersonalBrowseLevel {
  folders: PersonalBrowseFolder[];
  videos: IPersonalVideo[];
}

/** Sort key of a Personal video: the user's sort title, else its display title. */
export function personalSortKey(video: IPersonalVideo, overrides: Overrides = {}): string {
  return overrides[personalOverrideKey(video.parsedPath)]?.sortTitle || personalDisplayTitle(video, overrides);
}

/** The videos that may be shown: not hidden by the user and not on an unreachable source. */
export function visiblePersonalVideos(videos: readonly IPersonalVideo[], overrides: Overrides = {}): IPersonalVideo[] {
  return videos.filter((v) => !v.unavailable && !overrides[personalOverrideKey(v.parsedPath)]?.hidden);
}

function latest(values: (number | undefined)[]): number | undefined {
  let result: number | undefined;
  for (const value of values) {
    if (value !== undefined && (result === undefined || value > result)) result = value;
  }
  return result;
}

/**
 * What one screen of the Personal section lists. `flat` puts every visible video in one list;
 * `folders` shows the child folders and direct videos at `folderKey` ('' or undefined = the
 * top level). Folders with nothing visible below them do not appear.
 */
export function personalBrowseLevel(
  videos: readonly IPersonalVideo[],
  layout: personalLayouts,
  folderKey: string | undefined,
  overrides: Overrides = {},
): PersonalBrowseLevel {
  const visible = visiblePersonalVideos(videos, overrides);
  if (layout === 'flat') return { folders: [], videos: visible };
  const folderPath = folderKey ? folderKey.split('/') : [];
  const level = personalFolderLevel(visible, folderPath);
  return {
    folders: level.folders.map((folder) => ({
      ...folder,
      lastOpened: latest(folder.videos.map((v) => v.lastOpened)),
      firstDetected: latest(folder.videos.map((v) => v.firstDetected)),
    })),
    videos: level.videos,
  };
}
