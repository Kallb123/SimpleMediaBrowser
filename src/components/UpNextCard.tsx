import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';

interface UpNextCardProps {
  /** Display label of the episode that follows. */
  title: string;
  /** Seconds until it starts by itself, or null when it waits for a tap. */
  secondsLeft: number | null;
  onPlay: () => void;
  onDismiss: () => void;
}

/**
 * The "Up next" prompt over the video player: the next episode's title, a "Play now" button and a
 * dismiss button. Semi-transparent like the player's other overlays, and kept clear of the bottom
 * edge so the native seek bar stays usable. The countdown itself is run by the screen.
 */
export function UpNextCard({ title, secondsLeft, onPlay, onDismiss }: UpNextCardProps) {
  return (
    <View style={styles.card}>
      <View style={styles.text}>
        <Text style={styles.label}>{secondsLeft !== null ? `Playing in ${secondsLeft}s` : 'Up next'}</Text>
        <Text style={styles.title} numberOfLines={2}>{title}</Text>
      </View>
      <TouchableOpacity style={styles.play} onPress={onPlay} accessibilityRole="button">
        <Text style={styles.buttonText}>Play now</Text>
      </TouchableOpacity>
      <TouchableOpacity style={styles.dismiss} onPress={onDismiss} accessibilityRole="button" accessibilityLabel="Dismiss">
        <Text style={styles.buttonText}>✕</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { position: 'absolute', right: 16, bottom: 80, maxWidth: '70%', flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, borderRadius: 8, backgroundColor: 'rgba(0, 0, 0, 0.75)' },
  text: { flexShrink: 1, gap: 2 },
  label: { color: '#ccc', fontSize: 13 },
  title: { color: '#fff', fontSize: 15, fontWeight: '600' },
  play: { paddingVertical: 8, paddingHorizontal: 14, borderRadius: 8, backgroundColor: '#333' },
  dismiss: { paddingVertical: 8, paddingHorizontal: 10 },
  buttonText: { color: '#fff', fontSize: 16 },
});
