import { IMediaObject } from '@/scripts/FileScanner';
import { ThemedText } from '../ThemedText';
import { DirectoryLink } from './DirectoryLink';
import { FileLink } from './FileLink';

export type MediaItemProps =  {
  mediaObject: IMediaObject
};

export function MediaItem({ mediaObject, ...rest }: MediaItemProps) {
  return mediaObject.isDirectory ? (
    <DirectoryLink mediaObject={mediaObject}></DirectoryLink>
  )
  :
  (
    <FileLink mediaObject={mediaObject}></FileLink>
  )
}
