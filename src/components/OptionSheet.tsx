import { Modal, Pressable, ScrollView, StyleSheet, TouchableOpacity, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { ThemedText } from '@/components/ThemedText';
import { useTheme } from '@/hooks/use-theme';
import { useThemeColor } from '@/hooks/useThemeColor';

export interface OptionSheetOption {
  key: string;
  label: string;
  selected?: boolean;
}

interface OptionSheetProps {
  visible: boolean;
  title: string;
  options: readonly OptionSheetOption[];
  /** Called with the tapped option's key. The sheet does not close itself; the caller decides. */
  onSelect: (key: string) => void;
  onDismiss: () => void;
}

/**
 * A small pick-one-of-N dialog: dimmed backdrop (tap to dismiss), a title and a list of options
 * with the current one ticked.
 */
export function OptionSheet({ visible, title, options, onSelect, onDismiss }: OptionSheetProps) {
  const theme = useTheme();
  const tint = useThemeColor({}, 'tint');

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onDismiss} statusBarTranslucent>
      <View style={styles.overlay}>
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={onDismiss}
          accessibilityRole="button"
          accessibilityLabel="Close"
        />
        <View style={[styles.box, { backgroundColor: theme.backgroundElement }]}>
          <ThemedText type="subtitle" style={styles.title} accessibilityRole="header">{title}</ThemedText>
          <ScrollView>
            {options.map((option) => (
              <TouchableOpacity
                key={option.key}
                onPress={() => onSelect(option.key)}
                style={styles.option}
                accessibilityRole="radio"
                accessibilityState={{ selected: !!option.selected }}
                accessibilityLabel={option.label}
              >
                <ThemedText style={[styles.optionLabel, option.selected && { color: tint, fontWeight: '600' }]}>
                  {option.label}
                </ThemedText>
                {option.selected ? <Ionicons name="checkmark" size={22} color={tint} /> : null}
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  box: {
    borderRadius: 12,
    paddingVertical: 16,
    paddingHorizontal: 8,
    width: '80%',
    maxWidth: 360,
    maxHeight: '80%',
    gap: 8,
  },
  title: {
    textAlign: 'center',
    paddingHorizontal: 16,
  },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 48,
    paddingHorizontal: 16,
    borderRadius: 8,
  },
  optionLabel: {
    fontSize: 16,
  },
});
