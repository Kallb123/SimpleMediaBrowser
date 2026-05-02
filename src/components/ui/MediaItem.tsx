import { IMediaObject } from '@/scripts/FileScanner';
import { DirectoryLink } from './DirectoryLink';
import { FileLink } from './FileLink';

export type MediaItemProps =  {
  mediaObject: IMediaObject;
  onPress?: () => void;
};

export function MediaItem({ mediaObject, onPress }: MediaItemProps) {
  return mediaObject.isDirectory ? (
    <DirectoryLink mediaObject={mediaObject} onPress={onPress}></DirectoryLink>
  )
  :
  (
    <FileLink mediaObject={mediaObject}></FileLink>
  )
}
