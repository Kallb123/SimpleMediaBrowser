import { DirectoryLink } from './DirectoryLink';
import { FileLink } from './FileLink';
export function MediaItem({ mediaObject, onPress }) {
    return mediaObject.isDirectory ? (<DirectoryLink mediaObject={mediaObject} onPress={onPress}></DirectoryLink>)
        :
            (<FileLink mediaObject={mediaObject}></FileLink>);
}
