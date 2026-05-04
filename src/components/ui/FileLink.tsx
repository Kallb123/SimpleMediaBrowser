import { IMediaObject } from '@/scripts/FileScanner';
import { ThemedText } from '../ThemedText';
import { TouchableOpacity } from 'react-native';
import { openMediaInExternalApp } from '@/scripts/openMedia';

export type MediaItemProps =  {
  mediaObject: IMediaObject
};

export function FileLink({ mediaObject }: MediaItemProps) {
  const handlePress = () => {
    openMediaInExternalApp(mediaObject.path, mediaObject.filename).catch((e) => console.error('Failed to open file:', e));
  };
  return (
    <TouchableOpacity onPress={handlePress}>
      <ThemedText>{mediaObject.filename}</ThemedText>
    </TouchableOpacity>
  );
}
