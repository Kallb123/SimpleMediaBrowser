import { useEffect, useState, useSyncExternalStore } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, TouchableOpacity, View, useWindowDimensions } from 'react-native';
import { Image } from 'expo-image';
import { useAudioPlayerStatus } from 'expo-audio';
import Slider from '@react-native-community/slider';
import Ionicons from '@expo/vector-icons/Ionicons';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { OptionSheet } from '@/components/OptionSheet';
import { ThemedText } from '@/components/ThemedText';
import { ThemedView } from '@/components/ThemedView';
import { useTheme } from '@/hooks/use-theme';
import { useAppSelector } from '@/hooks/useRedux';
import { useThemeColor } from '@/hooks/useThemeColor';
import { AudiobookPlayer, PLAYBACK_RATES, SKIP_INTERVAL_SECONDS, SLEEP_TIMER_MINUTES } from '@/scripts/AudiobookPlayer';
import { audioPartFiles } from '@/scripts/libraryUtils';
import { selectAudiobookPlaybackRate } from '@/store/settingsReducer';
import { formatClock } from '@/utils/formatClock';

const COVER_MAX_SIZE = 360;
const ERROR_COLOR = '#d9534f';

/** 1 -> "1×", 1.5 -> "1.5×", 0.75 -> "0.75×". */
const formatRate = (rate: number) => `${parseFloat(rate.toFixed(2))}×`;

/**
 * The in-app audiobook player. It only observes the `AudiobookPlayer` service, which owns the
 * playback, so leaving this screen does not stop anything.
 */
export default function PlayerScreen() {
  const service = AudiobookPlayer.getInstance();
  const nowPlaying = useSyncExternalStore(service.subscribe, service.getSnapshot);
  const status = useAudioPlayerStatus(service.getPlayer());
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const theme = useTheme();
  const tint = useThemeColor({}, 'tint');
  const background = useThemeColor({}, 'background');
  const text = useThemeColor({}, 'text');

  // While the thumb is held, show the thumb's position rather than the playing one; the seek
  // happens on release, so a drag is never fought by live position updates.
  const [dragPosition, setDragPosition] = useState<number | null>(null);
  const [picker, setPicker] = useState<'speed' | 'sleep' | null>(null);
  const playbackRate = useAppSelector(selectAudiobookPlaybackRate);

  // Re-render each second while a duration sleep timer is counting down. The screen is in the
  // foreground here, so a JS interval is fine; the service itself enforces the timer.
  const sleepTimer = nowPlaying?.sleepTimer ?? null;
  const countingDown = sleepTimer?.kind === 'duration';
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!countingDown) return;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [countingDown]);

  if (!nowPlaying) {
    return (
      <ThemedView style={styles.empty}>
        <ThemedText style={{ color: theme.textSecondary }}>Nothing playing</ThemedText>
      </ThemedView>
    );
  }

  const { audiobook, partIndex, title, poster, finished, error } = nowPlaying;
  const partCount = audioPartFiles(audiobook.files).length;
  const isLastPart = partIndex + 1 >= partCount;
  const loading = !error && !finished && !status.isLoaded && !status.playing;

  const duration = status.duration > 0 ? status.duration : 0;
  const position = Math.min(dragPosition ?? status.currentTime, duration);
  const landscape = width > height;
  const coverSize = landscape
    ? Math.max(120, Math.min(height - insets.top - insets.bottom - 80, width * 0.4, COVER_MAX_SIZE))
    : Math.min(width - 48, COVER_MAX_SIZE);

  const handleSeekComplete = async (value: number) => {
    setDragPosition(value);
    await service.seekTo(value);
    setDragPosition(null);
  };

  const canSkip = !error && !loading && duration > 0;
  const sleepLabel =
    sleepTimer?.kind === 'duration'
      ? formatClock(Math.ceil((sleepTimer.endsAt - now) / 1000))
      : sleepTimer?.kind === 'endOfPart'
        ? 'End of part'
        : 'Sleep';
  const rateLabel = formatRate(playbackRate);

  const speedOptions = PLAYBACK_RATES.map((rate) => ({
    key: String(rate),
    label: formatRate(rate),
    selected: rate === playbackRate,
  }));
  const sleepOptions = [
    { key: 'off', label: 'Off', selected: !sleepTimer },
    ...SLEEP_TIMER_MINUTES.map((minutes) => ({ key: String(minutes), label: `${minutes} min` })),
    { key: 'endOfPart', label: 'End of part', selected: sleepTimer?.kind === 'endOfPart' },
  ];
  const handleSelectSleep = (key: string) => {
    setPicker(null);
    if (key === 'off') service.setSleepTimer(null);
    else if (key === 'endOfPart') service.setSleepTimer('endOfPart');
    else service.setSleepTimer({ minutes: Number(key) });
  };
  const handleSelectSpeed = (key: string) => {
    setPicker(null);
    service.setPlaybackRate(Number(key));
  };

  const statusLine = error ?? (finished ? 'Finished' : partCount > 1 ? `Part ${partIndex + 1} of ${partCount}` : null);

  return (
    <ThemedView style={styles.container}>
      <ScrollView
        contentContainerStyle={[
          styles.content,
          landscape && styles.contentLandscape,
          { paddingBottom: Math.max(insets.bottom, 16), paddingLeft: Math.max(insets.left, 24), paddingRight: Math.max(insets.right, 24) },
        ]}
      >
        <View style={[styles.cover, { width: coverSize, height: coverSize, backgroundColor: theme.backgroundElement }]}>
          {poster ? (
            <Image source={{ uri: poster }} style={styles.coverImage} contentFit="contain" accessibilityLabel="Cover" />
          ) : (
            <Ionicons name="headset" size={coverSize / 3} color={theme.textSecondary} />
          )}
        </View>

        <View style={[styles.controls, landscape && styles.controlsLandscape]}>
          <ThemedText type="subtitle" style={styles.centered} numberOfLines={3}>{title}</ThemedText>
          {audiobook.author ? (
            <ThemedText style={[styles.centered, { color: theme.textSecondary }]} numberOfLines={1}>{audiobook.author}</ThemedText>
          ) : null}
          {statusLine ? (
            <ThemedText style={[styles.centered, styles.statusLine, { color: error ? ERROR_COLOR : theme.textSecondary }]}>
              {statusLine}
            </ThemedText>
          ) : null}

          <Slider
            style={styles.slider}
            minimumValue={0}
            maximumValue={Math.max(duration, 1)}
            value={position}
            disabled={duration === 0 || !!error}
            minimumTrackTintColor={tint}
            maximumTrackTintColor={theme.backgroundSelected}
            thumbTintColor={tint}
            onSlidingStart={setDragPosition}
            onValueChange={setDragPosition}
            onSlidingComplete={handleSeekComplete}
            accessibilityLabel="Seek"
          />
          <View style={styles.times}>
            <ThemedText style={[styles.time, { color: theme.textSecondary }]}>{formatClock(position)}</ThemedText>
            <ThemedText style={[styles.time, { color: theme.textSecondary }]}>{`-${formatClock(duration - position)}`}</ThemedText>
          </View>

          <View style={styles.buttons}>
            <TouchableOpacity
              onPress={() => service.previousPart()}
              hitSlop={12}
              accessibilityRole="button"
              accessibilityLabel="Previous part"
            >
              <Ionicons name="play-skip-back" size={30} color={text} />
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => service.skipBy(-SKIP_INTERVAL_SECONDS)}
              disabled={!canSkip}
              hitSlop={8}
              style={!canSkip && styles.disabled}
              accessibilityRole="button"
              accessibilityLabel={`Back ${SKIP_INTERVAL_SECONDS} seconds`}
            >
              <MaterialIcons name="replay-30" size={34} color={text} />
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => service.togglePlayPause()}
              style={[styles.playButton, { backgroundColor: tint }]}
              accessibilityRole="button"
              accessibilityLabel={status.playing ? 'Pause' : 'Play'}
            >
              {loading ? (
                <ActivityIndicator color={background} />
              ) : (
                <Ionicons name={status.playing ? 'pause' : 'play'} size={40} color={background} />
              )}
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => service.skipBy(SKIP_INTERVAL_SECONDS)}
              disabled={!canSkip}
              hitSlop={8}
              style={!canSkip && styles.disabled}
              accessibilityRole="button"
              accessibilityLabel={`Forward ${SKIP_INTERVAL_SECONDS} seconds`}
            >
              <MaterialIcons name="forward-30" size={34} color={text} />
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => service.nextPart()}
              disabled={isLastPart}
              hitSlop={12}
              style={isLastPart && styles.disabled}
              accessibilityRole="button"
              accessibilityLabel="Next part"
            >
              <Ionicons name="play-skip-forward" size={30} color={text} />
            </TouchableOpacity>
          </View>

          <View style={styles.secondaryButtons}>
            <TouchableOpacity
              onPress={() => setPicker('speed')}
              style={[styles.pill, { backgroundColor: theme.backgroundElement }]}
              accessibilityRole="button"
              accessibilityLabel={`Playback speed, ${rateLabel}`}
            >
              <Ionicons name="speedometer-outline" size={18} color={text} />
              <ThemedText style={styles.pillText}>{rateLabel}</ThemedText>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => setPicker('sleep')}
              style={[styles.pill, { backgroundColor: theme.backgroundElement }]}
              accessibilityRole="button"
              accessibilityLabel={sleepTimer ? `Sleep timer, ${sleepLabel}` : 'Sleep timer, off'}
            >
              <Ionicons name={sleepTimer ? 'moon' : 'moon-outline'} size={18} color={sleepTimer ? tint : text} />
              <ThemedText style={[styles.pillText, countingDown && styles.pillTextClock]}>{sleepLabel}</ThemedText>
            </TouchableOpacity>
          </View>
        </View>
      </ScrollView>

      <OptionSheet
        visible={picker === 'speed'}
        title="Playback speed"
        options={speedOptions}
        onSelect={handleSelectSpeed}
        onDismiss={() => setPicker(null)}
      />
      <OptionSheet
        visible={picker === 'sleep'}
        title="Sleep timer"
        options={sleepOptions}
        onSelect={handleSelectSleep}
        onDismiss={() => setPicker(null)}
      />
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  empty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  content: {
    flexGrow: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 24,
    paddingTop: 16,
  },
  contentLandscape: {
    flexDirection: 'row',
    gap: 32,
  },
  cover: {
    borderRadius: 12,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  coverImage: {
    width: '100%',
    height: '100%',
  },
  controls: {
    width: '100%',
    maxWidth: 480,
    gap: 4,
  },
  controlsLandscape: {
    flex: 1,
  },
  centered: {
    textAlign: 'center',
  },
  statusLine: {
    fontSize: 14,
  },
  slider: {
    width: '100%',
    height: 40,
    marginTop: 12,
  },
  times: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 8,
  },
  time: {
    fontSize: 13,
    fontVariant: ['tabular-nums'],
  },
  buttons: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 20,
    marginTop: 16,
  },
  secondaryButtons: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 16,
    marginTop: 20,
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    minHeight: 40,
    paddingHorizontal: 16,
    borderRadius: 20,
  },
  pillText: {
    fontSize: 15,
  },
  pillTextClock: {
    fontVariant: ['tabular-nums'],
  },
  playButton: {
    width: 72,
    height: 72,
    borderRadius: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  disabled: {
    opacity: 0.3,
  },
});
