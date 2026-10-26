import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import SelectDropdown from 'react-native-select-dropdown';
import { Colors } from '@/constants/Colors';
import { useColorScheme } from '@/hooks/useColorScheme';

export interface DropdownOption<T> {
  id: T;
  label: string;
}

interface DropdownProps<T> {
  options: readonly DropdownOption<T>[];
  value: T;
  onChange: (value: T) => void;
  disabled?: boolean;
  /** Smaller button and text, for dropdowns that sit inside a list row. */
  compact?: boolean;
  /** Overrides the button's size (e.g. a full-width button). */
  buttonStyle?: StyleProp<ViewStyle>;
  placeholder?: string;
  accessibilityLabel?: string;
}

/**
 * A pick-one dropdown. It follows `value`: the library re-selects whenever `defaultValue` changes,
 * so the button keeps up when the value is reset or changed elsewhere. In the open menu every
 * option has the same background and the current one is marked with the tint colour and a tick,
 * like OptionSheet, rather than a shaded row that reads as a styling glitch.
 */
export function Dropdown<T extends string | number>({
  options,
  value,
  onChange,
  disabled,
  compact,
  buttonStyle,
  placeholder = 'Please select...',
  accessibilityLabel,
}: DropdownProps<T>) {
  const colorScheme = useColorScheme() === 'dark' ? 'dark' : 'light';
  const textColor = Colors[colorScheme].text;
  // The light tint is a blue; the dark one is plain white, which the bolder text and tick carry.
  const selectedColor = Colors[colorScheme].tint;
  const dropdownBg = colorScheme === 'dark' ? '#353636' : '#E9ECEF';
  const textStyle = compact ? styles.compactText : styles.text;

  return (
    <SelectDropdown
      data={options as DropdownOption<T>[]}
      defaultValue={options.find(o => o.id === value)}
      disabled={disabled}
      onSelect={(selectedItem: DropdownOption<T>) => onChange(selectedItem.id)}
      renderButton={(selectedItem: DropdownOption<T> | null, isOpened: boolean) => (
        <View
          style={[compact ? styles.compactButton : styles.button, { backgroundColor: dropdownBg }, buttonStyle, disabled && styles.disabled]}
          accessibilityRole="button"
          accessibilityLabel={accessibilityLabel}
          accessibilityState={{ disabled: !!disabled, expanded: isOpened }}
        >
          <Text style={[styles.buttonText, textStyle, { color: textColor }]} numberOfLines={1}>
            {selectedItem?.label ?? placeholder}
          </Text>
          <Ionicons name={isOpened ? 'chevron-up' : 'chevron-down'} size={16} color={textColor} />
        </View>
      )}
      renderItem={(item: DropdownOption<T>, _index: number, isSelected: boolean) => (
        <View
          style={[compact ? styles.compactItem : styles.item, { backgroundColor: dropdownBg }]}
          accessibilityRole="radio"
          accessibilityState={{ selected: isSelected }}
        >
          <Text style={[styles.itemText, textStyle, { color: isSelected ? selectedColor : textColor }, isSelected && styles.selectedText]}>
            {item.label}
          </Text>
          {isSelected ? <Ionicons name="checkmark" size={compact ? 16 : 20} color={selectedColor} /> : null}
        </View>
      )}
      showsVerticalScrollIndicator={false}
      // Must be a plain object: the library spreads it into the menu's style, which drops an array.
      dropdownStyle={{ ...styles.menu, backgroundColor: dropdownBg }}
    />
  );
}

const styles = StyleSheet.create({
  button: {
    width: 150,
    height: 44,
    borderRadius: 10,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    gap: 6,
  },
  compactButton: {
    // The open menu is as wide as its button, so this keeps labels like "🎧 Audiobooks" on one line.
    minWidth: 124,
    height: 36,
    borderRadius: 8,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    gap: 4,
  },
  buttonText: {
    flexShrink: 1,
    flexGrow: 1,
  },
  text: {
    fontSize: 16,
    fontWeight: '500',
  },
  compactText: {
    fontSize: 13,
    fontWeight: '500',
  },
  menu: {
    borderRadius: 8,
  },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 12,
    gap: 8,
  },
  compactItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 9,
    gap: 6,
  },
  itemText: {
    flex: 1,
  },
  selectedText: {
    fontWeight: '700',
  },
  disabled: {
    opacity: 0.4,
  },
});
