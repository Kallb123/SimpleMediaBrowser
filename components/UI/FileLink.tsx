import { IMediaObject } from '@/scripts/FileScanner';
import { ThemedText } from '../ThemedText';
import { Href, Link } from 'expo-router';

export type MediaItemProps =  {
  mediaObject: IMediaObject
};

export function FileLink({ mediaObject }: MediaItemProps) {
  return (
    <ThemedText><Link href={mediaObject.path as Href}>{mediaObject.filename}</Link></ThemedText>
  );
}
