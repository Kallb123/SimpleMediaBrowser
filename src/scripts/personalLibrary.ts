/**
 * Pure helpers and shared types for the "Personal" library (art tutorials, home videos,
 * YouTube downloads): filename / sidecar parsing, folder grouping and next-video ordering.
 *
 * Like `libraryUtils.ts` this module must stay free of runtime imports (type-only imports
 * only) so the scanner, enrichment, reducers and UI can all use it without require cycles,
 * and so it can be unit-tested without mocking anything.
 */
import type { IMediaObject } from '@/scripts/libraryUtils';
import type { IMediaOverride } from '@/store/libraryReducer';

/**
 * A video in a Personal source. Reuses `IMediaObject` the way movies do: `title` /
 * `scannedTitle` come from {@link personalTitleFromFilename}, `resolvedTitle` from a
 * yt-dlp `.info.json` or YouTube oEmbed, `poster` is the cached `file://` URI of a sidecar
 * image or downloaded YouTube thumbnail ('' when none), `episodeNumber` is 0 and the ids are null.
 */
export interface IPersonalVideo extends IMediaObject {
  /** Folder names from the source root down to the file's folder; [] = file sits at the root. */
  folderPath: string[];
  /** 11-character YouTube video id, from the filename (`Title [id].mp4`) or the yt-dlp info.json. */
  youtubeId?: string;
  /** Channel / uploader (info.json `channel` ?? `uploader`, or oEmbed `author_name`). */
  channel?: string;
  description?: string;
  /** yt-dlp `upload_date`, "YYYYMMDD". */
  uploadDate?: string;
}

/** Key of a folder in `personalFolderPosters` and the browse location: `folderPath.join('/')`, '' = root. */
export const personalFolderKey = (folderPath: readonly string[]): string => folderPath.join('/');

/** Override namespace for a Personal video (see `mediaOverrides` in `libraryReducer.ts`). */
export const personalOverrideKey = (parsedPath: string): string => `personal:${parsedPath}`;

const YOUTUBE_ID_PATTERN = '[A-Za-z0-9_-]{11}';
/** An 11-character YouTube id in square brackets at the very end (yt-dlp's default `Title [id]`). */
const TRAILING_YOUTUBE_ID = new RegExp(`\\s*\\[(${YOUTUBE_ID_PATTERN})\\]$`);
const YOUTUBE_ID_ONLY = new RegExp(`^${YOUTUBE_ID_PATTERN}$`);
const EXTENSION = /\.[A-Za-z0-9]{1,5}$/;

/** The filename without its extension. */
function baseName(filename: string): string {
  return filename.replace(EXTENSION, '');
}

/**
 * The YouTube id yt-dlp puts in its default filename: 11 `[A-Za-z0-9_-]` characters in square
 * brackets at the end of the base name ("Title [dQw4w9WgXcQ].mp4"). Brackets of any other length
 * ("[1080p]", a 10- or 12-character tag) and brackets that are not last do not match.
 */
export function extractYoutubeId(filename: string): string | null {
  const match = TRAILING_YOUTUBE_ID.exec(baseName(filename).trimEnd());
  return match ? match[1] : null;
}

/**
 * Display title derived from the filename: the extension and a trailing " [youtubeId]" are
 * dropped and the result trimmed. Falls back to the bare base name if nothing else is left.
 */
export function personalTitleFromFilename(filename: string): string {
  const base = baseName(filename).trim();
  const title = base.replace(TRAILING_YOUTUBE_ID, '').trim();
  return title || base;
}

const SIDECAR_IMAGE_EXTENSIONS = ['jpg', 'jpeg', 'png', 'webp'];

/**
 * Finds the sidecar files that sit next to a video among the folder's sibling names: an image
 * named `<base>.jpg|jpeg|png|webp` or Kodi-style `<base>-thumb.<ext>` (the plain form wins), and
 * the yt-dlp `<base>.info.json`. Matching ignores case; the sibling's real name is returned.
 */
export function matchPersonalSidecars(
  videoFilename: string,
  siblingNames: readonly string[],
): { image?: string; infoJson?: string } {
  const base = baseName(videoFilename).toLowerCase();
  const byLowerName = new Map<string, string>();
  for (const name of siblingNames) {
    const lower = name.toLowerCase();
    if (!byLowerName.has(lower)) byLowerName.set(lower, name);
  }

  const result: { image?: string; infoJson?: string } = {};
  const imageCandidates = [
    ...SIDECAR_IMAGE_EXTENSIONS.map((ext) => `${base}.${ext}`),
    ...SIDECAR_IMAGE_EXTENSIONS.map((ext) => `${base}-thumb.${ext}`),
  ];
  for (const candidate of imageCandidates) {
    const found = byLowerName.get(candidate);
    if (found !== undefined) {
      result.image = found;
      break;
    }
  }
  const infoJson = byLowerName.get(`${base}.info.json`);
  if (infoJson !== undefined) result.infoJson = infoJson;
  return result;
}

/** What {@link parseYtDlpInfoJson} reads from a yt-dlp `.info.json`. */
export interface YtDlpInfo {
  /** The extractor's video id (only a valid 11-character id when `isYoutube`). */
  id?: string;
  /** True when the download came from YouTube (extractor, or `webpage_url`) and `id` is a YouTube id. */
  isYoutube: boolean;
  title?: string;
  /** `channel` ?? `uploader`. */
  channel?: string;
  description?: string;
  /** "YYYYMMDD". */
  uploadDate?: string;
}

const nonEmptyString = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() ? value.trim() : undefined;

function isYoutubeUrl(url: string | undefined): boolean {
  return url !== undefined && /^https?:\/\/(?:[\w-]+\.)*(?:youtube\.com|youtu\.be)(?:[/:?#]|$)/i.test(url);
}

/**
 * Parses a yt-dlp `.info.json`. Returns null when the text is not a JSON object. Only the
 * fields the library uses are read; absent or wrongly-typed ones are left undefined.
 */
export function parseYtDlpInfoJson(text: string): YtDlpInfo | null {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof data !== 'object' || data === null || Array.isArray(data)) return null;
  const json = data as Record<string, unknown>;

  const id = nonEmptyString(json.id);
  const extractor = nonEmptyString(json.extractor_key) ?? nonEmptyString(json.extractor);
  const fromYoutube = (extractor !== undefined && extractor.toLowerCase() === 'youtube') || isYoutubeUrl(nonEmptyString(json.webpage_url));
  const isYoutube = fromYoutube && id !== undefined && YOUTUBE_ID_ONLY.test(id);
  const uploadDate = nonEmptyString(json.upload_date);

  const info: YtDlpInfo = { isYoutube };
  if (id !== undefined) info.id = id;
  const title = nonEmptyString(json.title);
  if (title !== undefined) info.title = title;
  const channel = nonEmptyString(json.channel) ?? nonEmptyString(json.uploader);
  if (channel !== undefined) info.channel = channel;
  const description = nonEmptyString(json.description);
  if (description !== undefined) info.description = description;
  if (uploadDate !== undefined && /^\d{8}$/.test(uploadDate)) info.uploadDate = uploadDate;
  return info;
}

/** A sub-folder shown at one level of the Personal folder tree. */
export interface PersonalFolderEntry {
  name: string;
  folderKey: string;
  folderPath: string[];
  /** Every video in the folder's subtree (not just its direct children). */
  videos: IPersonalVideo[];
}

/** Natural (numeric-aware, case-insensitive) string order, as the browse screen sorts titles. */
const NATURAL_SORT_OPTS: Intl.CollatorOptions = { numeric: true, sensitivity: 'base' };
const naturalCompare = (a: string, b: string): number => a.localeCompare(b, undefined, NATURAL_SORT_OPTS);

/** True when `folderPath` starts with all of `prefix`. */
function isUnder(folderPath: readonly string[], prefix: readonly string[]): boolean {
  return prefix.length <= folderPath.length && prefix.every((name, i) => folderPath[i] === name);
}

/**
 * The immediate child folders of `folderPath` and the videos sitting directly in it. Videos from
 * different sources whose folders have the same names land in the same folder (the tree is built
 * from names alone). Folders are ordered by natural name; videos keep the order they were given.
 */
export function personalFolderLevel(
  videos: readonly IPersonalVideo[],
  folderPath: readonly string[],
): { folders: PersonalFolderEntry[]; videos: IPersonalVideo[] } {
  const direct: IPersonalVideo[] = [];
  const children = new Map<string, PersonalFolderEntry>();
  for (const video of videos) {
    if (!isUnder(video.folderPath, folderPath)) continue;
    if (video.folderPath.length === folderPath.length) {
      direct.push(video);
      continue;
    }
    const name = video.folderPath[folderPath.length];
    let entry = children.get(name);
    if (!entry) {
      const childPath = [...folderPath, name];
      entry = { name, folderKey: personalFolderKey(childPath), folderPath: childPath, videos: [] };
      children.set(name, entry);
    }
    entry.videos.push(video);
  }
  const folders = [...children.values()].sort((a, b) => naturalCompare(a.name, b.name));
  return { folders, videos: direct };
}

/**
 * `parsedPath` of every non-hidden video under `folderKey` ('' = all of them), i.e. the keys the
 * watched badge and progress bar of a folder tile are computed from.
 */
export function personalWatchKeys(
  videos: readonly IPersonalVideo[],
  folderKey: string,
  overrides: { [key: string]: IMediaOverride } = {},
): string[] {
  return videos
    .filter((v) => {
      if (overrides[personalOverrideKey(v.parsedPath)]?.hidden) return false;
      if (folderKey === '') return true;
      const key = personalFolderKey(v.folderPath);
      return key === folderKey || key.startsWith(`${folderKey}/`);
    })
    .map((v) => v.parsedPath);
}

/** Title shown for a Personal video: the user's override, else the info.json / oEmbed title, else the filename title. */
export function personalDisplayTitle(
  video: IPersonalVideo,
  overrides: { [key: string]: IMediaOverride } = {},
): string {
  return overrides[personalOverrideKey(video.parsedPath)]?.title ?? video.resolvedTitle ?? video.title;
}

/**
 * The video that plays after `currentParsedPath`: the next non-hidden one in the same folder,
 * ordered by `sortTitle` override (else display title) in natural order. Null for the last video,
 * or when the current one is not in `videos`. The current video is found even if it is hidden.
 */
export function nextPersonalVideo(
  videos: readonly IPersonalVideo[],
  currentParsedPath: string,
  overrides: { [key: string]: IMediaOverride } = {},
): IPersonalVideo | null {
  const current = videos.find((v) => v.parsedPath === currentParsedPath);
  if (!current) return null;
  const folderKey = personalFolderKey(current.folderPath);
  const sortKey = (v: IPersonalVideo) => overrides[personalOverrideKey(v.parsedPath)]?.sortTitle || personalDisplayTitle(v, overrides);
  const ordered = videos
    .filter((v) => personalFolderKey(v.folderPath) === folderKey)
    .sort((a, b) =>
      naturalCompare(sortKey(a), sortKey(b))
      || naturalCompare(a.filename, b.filename)
      || (a.parsedPath < b.parsedPath ? -1 : a.parsedPath > b.parsedPath ? 1 : 0));
  const index = ordered.findIndex((v) => v.parsedPath === currentParsedPath);
  return ordered.slice(index + 1).find((v) => !overrides[personalOverrideKey(v.parsedPath)]?.hidden) ?? null;
}
