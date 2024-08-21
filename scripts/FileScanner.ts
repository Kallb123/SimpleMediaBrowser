import { FileInfo, getInfoAsync, StorageAccessFramework } from "expo-file-system";

export interface IMediaLibrary {
    [show: string] : IMediaShow;
}

export interface IMediaShow {
    ids: {
        tvdb: string | null;
        imdb: string | null;
    }
    title: string;
    year: number;
    poster: string;
    seasons: { [season: string] : IMediaSeason; };
}

export interface IMediaSeason {
    ids: {
        tvdb: string | null;
        imdb: string | null;
    }
    seasonNumber: number;
    episodes: { [episode: string] : IMediaObject; };
}

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

export class FileScanner {
    static myInstance: FileScanner | null = null;

    _userID = "";

    /**
     * @returns {CommonDataManager}
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

         return filtered;
    }

    getUserID() {
        return this._userID;
    }

    setUserID(id: string) {
        this._userID = id;
    }
}