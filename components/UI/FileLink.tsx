import { IMediaObject } from '@/scripts/FileScanner';
import { ThemedText } from '../ThemedText';
import { Linking, TouchableOpacity } from 'react-native';

export type MediaItemProps =  {
  mediaObject: IMediaObject
};

export function FileLink({ mediaObject }: MediaItemProps) {
  const handlePress = () => {
    Linking.openURL(mediaObject.path).catch(() => {});
  };
  return (
    <TouchableOpacity onPress={handlePress}>
      <ThemedText>{mediaObject.filename}</ThemedText>
    </TouchableOpacity>
  );
}
