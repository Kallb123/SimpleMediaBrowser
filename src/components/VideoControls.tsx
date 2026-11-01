import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { ActivityIndicator, PanResponder, Pressable, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { VideoPlayer } from 'expo-video';
import { clampSeek, scrubTime } from '@/scripts/VideoPlayback';
import { formatClock } from '@/utils/formatClock';

/** How long the controls stay up after the last touch while the video plays. */
const HIDE_AFTER_MS = 4000;
const SKIP_SECONDS = 10;
const THUMB_SIZE = 32;
const THUMB_SIZE_ACTIVE = 40;
const TRACK_HEIGHT = 10;

interface VideoControlsProps {
  player: VideoPlayer;
  title: string;
  /** Something else (a problem overlay, a picker) is in front: render nothing and hold the hide timer. */
  suspended: boolean;
  onBack: () => void;
  /** Extra buttons for the top right corner (speed, CC). */
  topRight?: ReactNode;
}

/** What the controls show of the player, kept here so its ticks only re-render the controls. */
function usePlayerState(player: VideoPlayer) {
  const [playing, setPlaying] = useState(player.playing);
  const [loading, setLoading] = useState(player.status === 'idle' || player.status === 'loading');
  const [ended, setEnded] = useState(false);
  const [position, setPosition] = useState(player.currentTime);
  const [duration, setDuration] = useState(player.duration);

  useEffect(() => {
    const subscriptions = [
      player.addListener('playingChange', ({ isPlaying }) => {
        setPlaying(isPlaying);
        if (isPlaying) setEnded(false);
      }),
      player.addListener('statusChange', ({ status }) => setLoading(status === 'loading')),
      player.addListener('timeUpdate', ({ currentTime }) => {
        setPosition(currentTime);
        setDuration(player.duration);
      }),
      player.addListener('sourceLoad', ({ duration: loaded }) => setDuration(loaded)),
      player.addListener('playToEnd', () => {
        setEnded(true);
        setPosition(player.duration);
      }),
    ];
    // The player starts loading when it is created, so it may be ahead of these subscriptions.
    setPlaying(player.playing);
    setLoading(player.status === 'idle' || player.status === 'loading');
    setDuration(player.duration);
    return () => subscriptions.forEach((s) => s.remove());
  }, [player]);

  return { playing, loading, ended, position, setPosition, duration };
}

/**
 * The in-app video player's own controls, in place of the native ones so they can be sized for
 * small hands: a big back arrow, a big play/pause button with 10-second skips and a thick
 * scrubber. They start hidden (so a video opens on its picture, not on a wall of buttons); a tap
 * anywhere shows them and another tap hides them. While the video plays they hide again
 * {@link HIDE_AFTER_MS} after the last touch; while it is paused they stay, and playback stopping
 * by itself (the end of the video, losing audio focus) brings them up.
 */
export function VideoControls({ player, title, suspended, onBack, topRight }: VideoControlsProps) {
  const insets = useSafeAreaInsets();
  const { playing, loading, ended, position, setPosition, duration } = usePlayerState(player);
  const [visible, setVisible] = useState(false);
  // Bumped by every touch on the controls, restarting the hide timer.
  const [activity, setActivity] = useState(0);
  // While the thumb is held, show the thumb's position; the seek happens on release.
  const [dragPosition, setDragPosition] = useState<number | null>(null);
  const wasPlaying = useRef(player.playing);

  useEffect(() => {
    const subscription = player.addListener('playingChange', ({ isPlaying }) => {
      if (wasPlaying.current && !isPlaying) setVisible(true);
      wasPlaying.current = isPlaying;
    });
    return () => subscription.remove();
  }, [player]);

  const held = dragPosition !== null;
  useEffect(() => {
    if (!visible || !playing || held || suspended) return;
    const timer = setTimeout(() => setVisible(false), HIDE_AFTER_MS);
    return () => clearTimeout(timer);
  }, [visible, playing, held, suspended, activity]);

  if (suspended) return null;

  const touched = () => setActivity((n) => n + 1);
  const seekTo = (time: number) => {
    const target = clampSeek(time, duration);
    player.currentTime = target;
    setPosition(target);
    touched();
  };
  const togglePlay = () => {
    if (ended) player.replay();
    else if (playing) player.pause();
    else player.play();
    touched();
  };

  const shown = Math.min(dragPosition ?? position, duration > 0 ? duration : 0);
  const playIcon = ended ? 'refresh' : playing ? 'pause' : 'play';
  const playLabel = ended ? 'Play again' : playing ? 'Pause' : 'Play';

  return (
    <View style={StyleSheet.absoluteFill}>
      <Pressable
        style={[StyleSheet.absoluteFill, visible && styles.scrim]}
        onPress={() => setVisible((v) => !v)}
        accessibilityRole="button"
        accessibilityLabel={visible ? 'Hide controls' : 'Show controls'}
      />
      {loading && (
        <View style={[StyleSheet.absoluteFill, styles.center]} pointerEvents="none">
          <ActivityIndicator size="large" color="#fff" />
        </View>
      )}
      {visible && (
        <View
          style={[StyleSheet.absoluteFill, styles.layout, {
            paddingTop: insets.top + 16,
            paddingBottom: insets.bottom + 16,
            paddingLeft: insets.left + 16,
            paddingRight: insets.right + 16,
          }]}
          pointerEvents="box-none"
        >
          <View style={styles.topBar} pointerEvents="box-none">
            <TouchableOpacity style={styles.backButton} onPress={onBack} accessibilityRole="button" accessibilityLabel="Back">
              <Ionicons name="arrow-back" size={44} color="#fff" />
            </TouchableOpacity>
            <Text style={styles.title} numberOfLines={1}>{title}</Text>
            <View style={styles.topRight} pointerEvents="box-none">{topRight}</View>
          </View>

          {!loading && (
            <View style={styles.middle} pointerEvents="box-none">
              <TouchableOpacity
                style={styles.skipButton}
                onPress={() => seekTo(position - SKIP_SECONDS)}
                disabled={!(duration > 0)}
                accessibilityRole="button"
                accessibilityLabel={`Back ${SKIP_SECONDS} seconds`}
              >
                <MaterialIcons name="replay-10" size={48} color="#fff" />
              </TouchableOpacity>
              <TouchableOpacity style={styles.playButton} onPress={togglePlay} accessibilityRole="button" accessibilityLabel={playLabel}>
                <Ionicons name={playIcon} size={60} color="#fff" style={playIcon === 'play' && styles.playIconNudge} />
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.skipButton}
                onPress={() => seekTo(position + SKIP_SECONDS)}
                disabled={!(duration > 0)}
                accessibilityRole="button"
                accessibilityLabel={`Forward ${SKIP_SECONDS} seconds`}
              >
                <MaterialIcons name="forward-10" size={48} color="#fff" />
              </TouchableOpacity>
            </View>
          )}

          <View style={styles.bottomBar} pointerEvents="box-none">
            <Text style={styles.time}>{formatClock(shown)}</Text>
            <Scrubber
              value={shown}
              duration={duration > 0 ? duration : 0}
              onStart={setDragPosition}
              onMove={setDragPosition}
              onEnd={(time) => {
                setDragPosition(null);
                seekTo(time);
              }}
            />
            <Text style={styles.time}>{formatClock(duration)}</Text>
          </View>
        </View>
      )}
    </View>
  );
}

interface ScrubberProps {
  value: number;
  /** 0 while unknown, which disables the scrubber. */
  duration: number;
  onStart: (time: number) => void;
  onMove: (time: number) => void;
  onEnd: (time: number) => void;
}

/**
 * A thick seek bar with a big thumb. The slider component cannot be resized on Android, so this
 * is drawn here. A touch anywhere on it (not just on the thumb) grabs the thumb there; it seeks on
 * release. Its children ignore touches, so `locationX` is always relative to the bar itself.
 */
function Scrubber({ value, duration, onStart, onMove, onEnd }: ScrubberProps) {
  const [active, setActive] = useState(false);
  const trackWidth = useRef(0);
  const startX = useRef(0);
  const latest = useRef({ duration, onStart, onMove, onEnd });
  latest.current = { duration, onStart, onMove, onEnd };

  const [responder] = useState(() => {
    // The track is inset by half a thumb on each side, so the thumb's centre can reach both ends.
    const timeAt = (x: number) => scrubTime(x - THUMB_SIZE / 2, trackWidth.current, latest.current.duration);
    const release = (dx: number) => {
      setActive(false);
      latest.current.onEnd(timeAt(startX.current + dx));
    };
    return PanResponder.create({
      onStartShouldSetPanResponder: () => latest.current.duration > 0,
      onMoveShouldSetPanResponder: () => latest.current.duration > 0,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: (event) => {
        startX.current = event.nativeEvent.locationX;
        setActive(true);
        latest.current.onStart(timeAt(startX.current));
      },
      onPanResponderMove: (_, gesture) => latest.current.onMove(timeAt(startX.current + gesture.dx)),
      onPanResponderRelease: (_, gesture) => release(gesture.dx),
      onPanResponderTerminate: (_, gesture) => release(gesture.dx),
    });
  });

  const fraction = duration > 0 ? Math.min(Math.max(value / duration, 0), 1) : 0;
  const thumbSize = active ? THUMB_SIZE_ACTIVE : THUMB_SIZE;

  return (
    <View
      style={styles.scrubber}
      onLayout={(e) => { trackWidth.current = e.nativeEvent.layout.width - THUMB_SIZE; }}
      {...responder.panHandlers}
      accessible
      accessibilityRole="adjustable"
      accessibilityLabel="Seek"
      accessibilityValue={{ text: `${formatClock(value)} of ${formatClock(duration)}` }}
      accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
      onAccessibilityAction={(e) => onEnd(value + (e.nativeEvent.actionName === 'increment' ? SKIP_SECONDS : -SKIP_SECONDS))}
    >
      <View style={styles.track} pointerEvents="none">
        <View style={[styles.trackFill, { width: `${fraction * 100}%` }]} />
        <View
          style={[styles.thumb, {
            left: `${fraction * 100}%`,
            width: thumbSize,
            height: thumbSize,
            borderRadius: thumbSize / 2,
            marginLeft: -thumbSize / 2,
            top: (TRACK_HEIGHT - thumbSize) / 2,
          }]}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  scrim: { backgroundColor: 'rgba(0, 0, 0, 0.45)' },
  center: { alignItems: 'center', justifyContent: 'center' },
  layout: { justifyContent: 'space-between' },
  topBar: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  backButton: { width: 72, height: 72, borderRadius: 36, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0, 0, 0, 0.6)' },
  title: { flex: 1, color: '#fff', fontSize: 20, fontWeight: '600' },
  topRight: { flexDirection: 'row', gap: 8 },
  middle: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 40 },
  skipButton: { width: 72, height: 72, alignItems: 'center', justifyContent: 'center' },
  playButton: { width: 104, height: 104, borderRadius: 52, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0, 0, 0, 0.6)' },
  // The play triangle's visual centre sits left of its box's centre.
  playIconNudge: { marginLeft: 6 },
  bottomBar: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  time: { color: '#fff', fontSize: 16, fontVariant: ['tabular-nums'], minWidth: 48, textAlign: 'center' },
  scrubber: { flex: 1, height: 56, justifyContent: 'center', paddingHorizontal: THUMB_SIZE / 2 },
  track: { height: TRACK_HEIGHT, borderRadius: TRACK_HEIGHT / 2, backgroundColor: 'rgba(255, 255, 255, 0.35)' },
  trackFill: { height: TRACK_HEIGHT, borderRadius: TRACK_HEIGHT / 2, backgroundColor: '#fff' },
  thumb: { position: 'absolute', backgroundColor: '#fff', elevation: 4 },
});
