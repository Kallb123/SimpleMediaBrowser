import { FileInfo, getInfoAsync, StorageAccessFramework } from "expo-file-system";
import { store } from "@/store/store";
import { setScanList, setMediaLibrary, setMovies, setIsScanning } from "@/store/libraryReducer";
import type { IMediaLibrary, IMediaShow, IMediaSeason } from "@/store/libraryReducer";
import type { IMediaSource } from "@/store/settingsReducer";

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

    /** Scan all configured sources and update the Redux store with merged results. */
    async scanAllSources(sources: IMediaSource[]) {
        store.dispatch(setIsScanning(true));
        try {
        const tvSources = sources.filter((s) => s.contentType === 'tv');
        const movieSources = sources.filter((s) => s.contentType === 'movie');

        // Collect TV files from all TV sources and merge into one library
        const allTvFiles: IScannedFile[] = [];
        for (const src of tvSources) {
            const files = await this.collectAllMediaFiles(src.uri);
            allTvFiles.push(...files);
        }
        const mergedLibrary = this.buildLibrary(allTvFiles);

        // Collect movie files from all movie sources
        const allMovieFiles: IScannedFile[] = [];
        for (const src of movieSources) {
            const files = await this.collectAllMediaFiles(src.uri);
            allMovieFiles.push(...files);
        }
        const movies = this.buildMovieList(allMovieFiles);

        // Build a combined scan list for diagnostic purposes
        const allScanUris: string[] = [
            ...allTvFiles.map((f) => f.path),
            ...allMovieFiles.map((f) => f.path),
        ];
        store.dispatch(setScanList(allScanUris));
        store.dispatch(setMediaLibrary(mergedLibrary));
        store.dispatch(setMovies(movies));
        } finally {
            store.dispatch(setIsScanning(false));
        }
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
        const library = this.buildLibrary(allMediaFiles);
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

    // ─── Movie list building ─────────────────────────────────────────────────

    buildMovieList(files: IScannedFile[]): IMediaObject[] {
        return files.map((file) => {
            // Destructure out relativePathParts so it is not included in the stored IMediaObject
            const { relativePathParts, ...mediaObj } = file;
            const title = file.filename.replace(/\.[^.]+$/, '').replace(/[\._-]+/g, ' ').trim();
            return { ...mediaObj, title };
        });
    }

    // ─── Library building ────────────────────────────────────────────────────

    buildLibrary(files: IScannedFile[]): IMediaLibrary {
        const library: IMediaLibrary = {};

        for (const file of files) {
            const metadata = this.parseMediaFile(file);
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

    private parseMediaFile(file: IScannedFile): ParsedMetadata | null {
        // Filename-based parsing takes priority (e.g. ShowName.S01E05.mkv)
        const fromFilename = this.parseFilename(file.filename);
        if (fromFilename) return fromFilename;

        // Fall back to inferring from the directory structure
        return this.parseFromPath(file);
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
     * Infer show/season/episode from the directory hierarchy without relying on
     * any user-configured view/organisation mode.  The scanner always recurses
     * all directories; the display layer (viewType) decides how the resulting
     * library data is presented to the user.
     *
     * Heuristics applied in order of directory depth:
     *   2+ parts – parts[0] = show name, parts[1] = season folder
     *   1 part   – parts[0] = show name, season defaults to 1
     *   0 parts  – file sits directly in the root; no folder context, skip
     */
    private parseFromPath(file: IScannedFile): ParsedMetadata | null {
        const parts = file.relativePathParts;
        const baseTitle = file.filename.replace(/\.[^.]+$/, '').replace(/[\._-]+/g, ' ').trim();

        // Try to extract an episode number from the filename.
        // Word boundary (\b) prevents matching digits inside unrelated words.
        // [Ee][Pp]? optionally matches 'p/P', covering 'e5', 'E5', 'ep5', 'EP5', etc.
        const epMatch = file.filename.match(/\b[Ee][Pp]?(\d{1,3})\b/);
        const episode = epMatch ? parseInt(epMatch[1], 10) : 0;

        if (parts.length >= 2) {
            // rootDir/ShowName/SeasonFolder/episode.mkv  (or deeper)
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
            // rootDir/ShowName/episode.mkv
            return { showName: parts[0], season: 1, episode, title: baseTitle };
        }

        // File is directly in the root scan directory with no enclosing folder;
        // there is no structural context from which to derive a show name.
        return null;
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
