import { useSyncExternalStore } from 'react';
import { ActivityIndicator, StyleSheet, TouchableOpacity, View } from 'react-native';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { useAudioPlayerStatus } from 'expo-audio';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ThemedText } from '@/components/ThemedText';
import { useTheme } from '@/hooks/use-theme';
import { useThemeColor } from '@/hooks/useThemeColor';
import { AudiobookPlayer } from '@/scripts/AudiobookPlayer';
import { audioPartFiles } from '@/scripts/libraryUtils';

const ERROR_COLOR = '#d9534f';
const COVER_SIZE = 44;

/** Whether the mini-player is showing, i.e. the in-app player has a book loaded. */
export function useMiniPlayerVisible(): boolean {
  const service = AudiobookPlayer.getInstance();
  return useSyncExternalStore(service.subscribe, service.getSnapshot) !== null;
}

/**
 * Compact "now playing" bar for the bottom of the browse screens; tapping it opens the full player.
 * Renders nothing until something has been played.
 */
export function MiniPlayer() {
  return useMiniPlayerVisible() ? <MiniPlayerBar /> : null;
}

// Separate component so `useAudioPlayerStatus(service.getPlayer())` (which creates the native
// player) only runs once something has been played.
function MiniPlayerBar() {
  const service = AudiobookPlayer.getInstance();
  const nowPlaying = useSyncExternalStore(service.subscribe, service.getSnapshot);
  const status = useAudioPlayerStatus(service.getPlayer());
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const theme = useTheme();
  const tint = useThemeColor({}, 'tint');
  const text = useThemeColor({}, 'text');

  if (!nowPlaying) return null;

  const { audiobook, partIndex, title, poster, finished, error } = nowPlaying;
  const partCount = audioPartFiles(audiobook.files).length;
  const loading = !error && !finished && !status.isLoaded && !status.playing;
  const progress = status.duration > 0 ? Math.min(Math.max(status.currentTime / status.duration, 0), 1) : 0;
  const secondary = error ?? (finished ? 'Finished' : partCount > 1 ? `Part ${partIndex + 1} of ${partCount}` : audiobook.author || null);

  return (
    <View style={[styles.container, { backgroundColor: theme.backgroundElement, paddingBottom: insets.bottom }]}>
      <View style={[styles.progressTrack, { backgroundColor: theme.backgroundSelected }]}>
        <View style={[styles.progressFill, { backgroundColor: tint, width: `${progress * 100}%` }]} />
      </View>
      <View style={styles.row}>
        <TouchableOpacity
          style={styles.info}
          onPress={() => router.push('/player')}
          accessibilityRole="button"
          accessibilityLabel={`Open player, ${title}`}
        >
          <View style={[styles.cover, { backgroundColor: theme.backgroundSelected }]}>
            {poster ? (
              <Image source={{ uri: poster }} style={styles.coverImage} contentFit="cover" accessibilityLabel="Cover" />
            ) : (
              <Ionicons name="headset" size={COVER_SIZE / 2} color={theme.textSecondary} />
            )}
          </View>
          <View style={styles.texts}>
            <ThemedText style={styles.title} numberOfLines={1}>{title}</ThemedText>
            {secondary ? (
              <ThemedText style={[styles.secondary, { color: error ? ERROR_COLOR : theme.textSecondary }]} numberOfLines={1}>
                {secondary}
              </ThemedText>
            ) : null}
          </View>
        </TouchableOpacity>
        <TouchableOpacity
          onPress={() => service.togglePlayPause()}
          style={styles.playButton}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={status.playing ? 'Pause' : 'Play'}
        >
          {loading ? (
            <ActivityIndicator color={text} />
          ) : (
            <Ionicons name={status.playing ? 'pause' : 'play'} size={28} color={text} />
          )}
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    width: '100%',
  },
  progressTrack: {
    height: 2,
  },
  progressFill: {
    height: '100%',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    gap: 8,
  },
  info: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  cover: {
    width: COVER_SIZE,
    height: COVER_SIZE,
    borderRadius: 6,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  coverImage: {
    width: '100%',
    height: '100%',
  },
  texts: {
    flex: 1,
  },
  title: {
    fontSize: 15,
    fontWeight: '600',
  },
  secondary: {
    fontSize: 13,
  },
  playButton: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
