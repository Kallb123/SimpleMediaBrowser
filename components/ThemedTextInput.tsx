import { TextInput, type TextInputProps, StyleSheet } from 'react-native';
import { useThemeColor } from '@/hooks/useThemeColor';

export type ThemedTextInputProps = TextInputProps & {
  lightColor?: string;
  darkColor?: string;
};

export function ThemedTextInput({
  style,
  lightColor,
  darkColor,
  ...rest
}: ThemedTextInputProps) {
  const color = useThemeColor({ light: lightColor, dark: darkColor }, 'text');
  const backgroundColor = useThemeColor({}, 'background');
  const placeholderTextColor = useThemeColor({ light: '#687076', dark: '#9BA1A6' }, 'icon');
  const borderColor = useThemeColor({ light: '#687076', dark: '#9BA1A6' }, 'icon');

  return (
    <TextInput
      style={[styles.input, { color, backgroundColor, borderColor }, style]}
      placeholderTextColor={placeholderTextColor}
      {...rest}
    />
  );
}

const styles = StyleSheet.create({
  input: {
    flex: 1,
    fontSize: 16,
    lineHeight: 24,
    borderWidth: 1,
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
});
