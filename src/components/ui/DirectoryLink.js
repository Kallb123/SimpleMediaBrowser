import { ThemedText } from '../ThemedText';
import { TouchableOpacity } from 'react-native';
export function DirectoryLink({ mediaObject, onPress }) {
    return (<TouchableOpacity onPress={onPress}>
      <ThemedText>📁 {mediaObject.filename}</ThemedText>
    </TouchableOpacity>);
}
