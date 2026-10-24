import type { IMediaObject } from '@/scripts/libraryUtils';
import { ThemedText } from '../ThemedText';
import { TouchableOpacity } from 'react-native';

export type DirectoryLinkProps = {
  mediaObject: IMediaObject;
  onPress?: () => void;
};

export function DirectoryLink({ mediaObject, onPress }: DirectoryLinkProps) {
  return (
    <TouchableOpacity onPress={onPress}>
      <ThemedText>📁 {mediaObject.filename}</ThemedText>
    </TouchableOpacity>
  );
}
