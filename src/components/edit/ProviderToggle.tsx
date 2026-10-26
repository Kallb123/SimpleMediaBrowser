import { StyleSheet, TouchableOpacity, View } from 'react-native';
import { ThemedText } from '@/components/ThemedText';
import type { dataSources } from '@/scripts/libraryUtils';

interface ProviderToggleProps {
  value: dataSources;
  onChange: (provider: dataSources) => void;
  disabled?: boolean;
}

/** TMDB / TheTVDB segmented pill buttons; render only when both API keys are set. */
export function ProviderToggle({ value, onChange, disabled }: ProviderToggleProps) {
  return (
    <View style={styles.row}>
      <TouchableOpacity
        style={[styles.button, value === 'tmdb' && styles.buttonActive]}
        onPress={() => onChange('tmdb')}
        disabled={disabled}
      >
        <ThemedText style={[styles.buttonText, value === 'tmdb' && styles.buttonTextActive]}>TMDB</ThemedText>
      </TouchableOpacity>
      <TouchableOpacity
        style={[styles.button, value === 'tvdb' && styles.buttonActive]}
        onPress={() => onChange('tvdb')}
        disabled={disabled}
      >
        <ThemedText style={[styles.buttonText, value === 'tvdb' && styles.buttonTextActive]}>TheTVDB</ThemedText>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    gap: 8,
  },
  button: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#0a7ea4',
  },
  buttonActive: {
    backgroundColor: '#0a7ea4',
  },
  buttonText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#0a7ea4',
  },
  buttonTextActive: {
    color: '#fff',
  },
});
