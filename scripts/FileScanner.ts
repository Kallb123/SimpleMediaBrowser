import { FileInfo, getInfoAsync, StorageAccessFramework } from "expo-file-system";
import { store } from "@/store/store";
import { setScanList, setMediaLibrary } from "@/store/libraryReducer";
import type { IMediaLibrary, IMediaShow, IMediaSeason } from "@/store/libraryReducer";
import type { viewTypes } from "@/store/settingsReducer";

export interface IMediaObject {
    ids: {
        tvdb: string | null;
        imdb: string | null;
    }
    episodeNumber: number;
    title: string;
    filename: string
    path: string
    parsedPath: string
    isDirectory: boolean
}

// Re-export library types so other modules can import them from here
export type { IMediaLibrary, IMediaShow, IMediaSeason };

const VIDEO_EXTENSIONS = new Set([
    '.mkv', '.mp4', '.avi', '.mov', '.m4v', '.wmv', '.flv',
    '.ts', '.m2ts', '.webm', '.mpg', '.mpeg', '.3gp',
]);

/** Maximum folder depth to recurse into during a scan. Protects against infinite symlink loops. */
const MAX_SCAN_DEPTH = 8;

interface ParsedMetadata {
    showName: string;
    season: number;
    episode: number;
    title: string;
}

/** A file collected during recursive scanning, carrying its relative path parts. */
interface IScannedFile extends IMediaObject {
    /** Path segments relative to the root scan directory (does not include filename). */
    relativePathParts: string[];
}

export class FileScanner {
    static myInstance: FileScanner | null = null;

    _userID = "";

    /**
     * @returns {FileScanner}
     */
    static getInstance(): FileScanner {
        if (this.myInstance == null) {
            this.myInstance = new FileScanner();
        }

        return this.myInstance;
    }

    async scanFolder(directory: string) {
        const contents = await StorageAccessFramework.readDirectoryAsync(directory);
    
        var contentInfo = await Promise.all(contents.map(async (c) => {
            try {
              const info = await getInfoAsync(c);
              return info;
            } catch (e) {
    
            }
            const info: FileInfo = {uri: c, isDirectory: true, exists: true, size: 0, modificationTime: 0};
            return info;
        }));
    
        const allContents: IMediaObject[] = contentInfo.map((c) => {
          const uri = decodeURIComponent(c.uri);
          const filename = uri.substring(uri.lastIndexOf('/') + 1, uri.length)
          return {
            ids : {tvdb: null, imdb: null},
            title: "",
            episodeNumber: 0,
            filename: filename,
            path: c.uri,
            parsedPath: uri,
            isDirectory: c.isDirectory
          }
        });
    
        const filtered = allContents.filter((c) => {
          if (c.filename.charAt(0) === '.') return null;
          return c;
        });

        store.dispatch(setScanList(filtered.map(f => f.path)));

        // Recursively collect all media files and build the library
        const allMediaFiles = await this.collectAllMediaFiles(directory);
        const viewType: viewTypes = store.getState().settingsReducer?.viewType ?? 'show/season';
        const library = this.buildLibrary(allMediaFiles, viewType);
        store.dispatch(setMediaLibrary(library));

        return filtered;
    }

    // ─── Recursive collection ────────────────────────────────────────────────

    private async collectAllMediaFiles(rootDirectory: string): Promise<IScannedFile[]> {
        const result: IScannedFile[] = [];
        await this.recursiveCollect(rootDirectory, [], result, 0);
        return result;
    }

    private async recursiveCollect(
        directory: string,
        relativePathParts: string[],
        result: IScannedFile[],
        depth: number,
    ): Promise<void> {
        if (depth > MAX_SCAN_DEPTH) return; // Safety guard against deeply nested structures

        let contents: string[];
        try {
            contents = await StorageAccessFramework.readDirectoryAsync(directory);
        } catch {
            return; // Directory not accessible
        }

        const infoList = await Promise.all(
            contents.map(async (c) => {
                try {
                    return await getInfoAsync(c);
                } catch {
                    // SAF directories sometimes fail getInfoAsync; treat as directory
                    const info: FileInfo = { uri: c, isDirectory: true, exists: true, size: 0, modificationTime: 0 };
                    return info;
                }
            }),
        );

        for (const info of infoList) {
            const uri = decodeURIComponent(info.uri);
            const filename = uri.substring(uri.lastIndexOf('/') + 1);

            if (filename.charAt(0) === '.') continue; // Skip hidden entries

            if (info.isDirectory) {
                await this.recursiveCollect(info.uri, [...relativePathParts, filename], result, depth + 1);
            } else if (this.isMediaFile(filename)) {
                result.push({
                    ids: { tvdb: null, imdb: null },
                    title: '',
                    episodeNumber: 0,
                    filename,
                    path: info.uri,
                    parsedPath: uri,
                    isDirectory: false,
                    relativePathParts,
                });
            }
        }
    }

    private isMediaFile(filename: string): boolean {
        const dotIndex = filename.lastIndexOf('.');
        if (dotIndex === -1) return false;
        const ext = filename.substring(dotIndex).toLowerCase();
        return VIDEO_EXTENSIONS.has(ext);
    }

    // ─── Library building ────────────────────────────────────────────────────

    buildLibrary(files: IScannedFile[], viewType: viewTypes): IMediaLibrary {
        const library: IMediaLibrary = {};

        for (const file of files) {
            const metadata = this.parseMediaFile(file, viewType);
            if (!metadata) continue;

            const { showName, season, episode, title } = metadata;

            if (!library[showName]) {
                library[showName] = {
                    ids: { tvdb: null, imdb: null },
                    title: showName,
                    year: 0,
                    poster: '',
                    seasons: {},
                };
            }

            const seasonKey = `s${String(season).padStart(2, '0')}`;
            if (!library[showName].seasons[seasonKey]) {
                library[showName].seasons[seasonKey] = {
                    ids: { tvdb: null, imdb: null },
                    seasonNumber: season,
                    episodes: {},
                };
            }

            const episodeKey = `e${String(episode).padStart(2, '0')}`;
            // Avoid overwriting an existing entry with the same key
            if (!library[showName].seasons[seasonKey].episodes[episodeKey]) {
                // Strip the internal relativePathParts field before storing
                const { relativePathParts, ...mediaObj } = file;
                library[showName].seasons[seasonKey].episodes[episodeKey] = {
                    ...mediaObj,
                    title: title || file.filename,
                    episodeNumber: episode,
                };
            }
        }

        return library;
    }

    private parseMediaFile(file: IScannedFile, viewType: viewTypes): ParsedMetadata | null {
        // Filename-based parsing takes priority (e.g. ShowName.S01E05.mkv)
        const fromFilename = this.parseFilename(file.filename);
        if (fromFilename) return fromFilename;

        // Fall back to inferring from the directory structure
        return this.parseFromPath(file, viewType);
    }

    // ─── Filename parser ─────────────────────────────────────────────────────

    /**
     * Parse common TV filename patterns:
     *   Show.Name.S01E05.Episode.Title.mkv   (SxxExx)
     *   Show.Name.1x05.Episode.Title.mkv     (NxNN)
     */
    parseFilename(filename: string): ParsedMetadata | null {
        // Remove extension for easier matching
        const withoutExt = filename.replace(/\.[^.]+$/, '');

        // SxxExx pattern — requires a separator before [Ss] so numeric show names don't false-match.
        // Season: up to 2 digits (realistic max ~99); episode: up to 3 digits (e.g. anime ep 100+).
        const sxxMatch = withoutExt.match(
            /^(.*?)[\.\s_-]+\b[Ss](\d{1,2})[Ee](\d{1,3})\b(?:[\.\s_-]+(.*))?$/,
        );
        if (sxxMatch) {
            return {
                showName: this.cleanName(sxxMatch[1]),
                season: parseInt(sxxMatch[2], 10),
                episode: parseInt(sxxMatch[3], 10),
                title: sxxMatch[4] ? this.cleanName(sxxMatch[4]) : '',
            };
        }

        // NxNN pattern — requires a separator before the season digit so numbers inside show names
        // don't false-match. Season: up to 2 digits; episode: up to 3 digits.
        const nxnnMatch = withoutExt.match(
            /^(.*?)[\.\s_-]+\b(\d{1,2})x(\d{1,3})\b(?:[\.\s_-]+(.*))?$/,
        );
        if (nxnnMatch) {
            return {
                showName: this.cleanName(nxnnMatch[1]),
                season: parseInt(nxnnMatch[2], 10),
                episode: parseInt(nxnnMatch[3], 10),
                title: nxnnMatch[4] ? this.cleanName(nxnnMatch[4]) : '',
            };
        }

        return null;
    }

    // ─── Path-based parser ───────────────────────────────────────────────────

    /**
     * Infer show/season/episode from the directory hierarchy.
     *
     * viewType meanings (as set in settings):
     *   flat        – all files are siblings, no folder hierarchy
     *   show        – rootDir/ShowName/episode.mkv
     *   show+season – rootDir/ShowName Season N/episode.mkv
     *   show/season – rootDir/ShowName/Season N/episode.mkv
     */
    private parseFromPath(file: IScannedFile, viewType: viewTypes): ParsedMetadata | null {
        const parts = file.relativePathParts;
        const baseTitle = file.filename.replace(/\.[^.]+$/, '').replace(/[\._-]+/g, ' ').trim();

        // Try to extract an episode number from the filename.
        // Word boundary (\b) prevents matching digits inside unrelated words.
        // [Ee][Pp]? optionally matches 'p/P', covering 'e5', 'E5', 'ep5', 'EP5', etc.
        const epMatch = file.filename.match(/\b[Ee][Pp]?(\d{1,3})\b/);
        const episode = epMatch ? parseInt(epMatch[1], 10) : 0;

        switch (viewType) {
            case 'flat':
                // No usable folder structure; cannot infer show/season
                return null;

            case 'show':
                // rootDir/ShowName/episode.mkv
                if (parts.length >= 1) {
                    return { showName: parts[0], season: 1, episode, title: baseTitle };
                }
                return null;

            case 'show+season': {
                // rootDir/ShowName Season N/episode.mkv
                if (parts.length >= 1) {
                    const folderName = parts[0];
                    // Single capture group via non-capturing alternatives:
                    // matches 'Season N' (word) or a word-bounded 'SN' abbreviation at end.
                    const seasonMatch = folderName.match(
                        /(?:[Ss]eason\s*|\b[Ss])(\d+)$/,
                    );
                    const season = seasonMatch ? parseInt(seasonMatch[1], 10) : 1;
                    const showName = seasonMatch
                        ? folderName.slice(0, folderName.lastIndexOf(seasonMatch[0])).trim()
                        : folderName;
                    return { showName: showName || folderName, season, episode, title: baseTitle };
                }
                return null;
            }

            case 'show/season':
                // rootDir/ShowName/Season N/episode.mkv
                if (parts.length >= 2) {
                    const showName = parts[0];
                    const seasonFolder = parts[1];
                    // Prefer an explicit 'Season N' word; otherwise take the first digit run.
                    const namedSeasonMatch = seasonFolder.match(/[Ss]eason\s*(\d+)/i);
                    const rawNumberMatch = seasonFolder.match(/(\d+)/);
                    const seasonStr = namedSeasonMatch
                        ? namedSeasonMatch[1]
                        : rawNumberMatch?.[1] ?? '1';
                    const season = parseInt(seasonStr, 10);
                    return { showName, season, episode, title: baseTitle };
                }
                if (parts.length === 1) {
                    // File sits directly in show folder (no season subfolder)
                    return { showName: parts[0], season: 1, episode, title: baseTitle };
                }
                return null;

            default:
                return null;
        }
    }

    // ─── Utilities ───────────────────────────────────────────────────────────

    /** Replace dots/underscores with spaces and trim the string. */
    private cleanName(raw: string): string {
        return raw.replace(/[\._]+/g, ' ').trim();
    }

    getUserID() {
        return this._userID;
    }

    setUserID(id: string) {
        this._userID = id;
    }
}