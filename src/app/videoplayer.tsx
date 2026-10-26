import { useEffect, useLayoutEffect, useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useNavigation } from 'expo-router';
import { StackActions } from '@react-navigation/native';
import { StatusBar } from 'expo-status-bar';
import { VideoView, useVideoPlayer } from 'expo-video';
import { AudiobookPlayer } from '@/scripts/AudiobookPlayer';
import { logger } from '@/scripts/Logger';
import { openMediaInExternalApp } from '@/scripts/openMedia';
import { getVideoRequest } from '@/scripts/VideoPlayback';
import type { VideoRequest } from '@/scripts/VideoPlayback';
import { VideoProgressTracker } from '@/scripts/VideoProgressTracker';

const TAG = 'VideoPlayerScreen';

const ERROR_MESSAGE = 'This file could not be played.';

/**
 * Closes the player, or goes home when it was opened without anything under it. "Home" is the
 * drawer by name: "/" is a route the root stack guards off, and the drawer picks its own initial
 * section (the default page, or the first one bedtime allows).
 */
function useCloseScreen() {
  const navigation = useNavigation();
  return () => {
    if (navigation.canGoBack()) navigation.goBack();
    else navigation.dispatch(StackActions.replace('(drawer)'));
  };
}

/**
 * The in-app video player: a full-screen modal playing what `MediaBrowserScreen` queued with
 * `setVideoRequest`. Unlike the audiobook player it owns its player, so closing the screen stops
 * playback (no background playback or Picture-in-Picture yet).
 */
export default function VideoPlayerScreen() {
  // Read once: a later request is for the next screen instance.
  const [request] = useState(getVideoRequest);
  if (!request) return <NothingPlaying />;
  return <VideoPlayback request={request} />;
}

function NothingPlaying() {
  const closeScreen = useCloseScreen();
  return (
    <View style={styles.center}>
      <StatusBar hidden />
      <Text style={styles.message}>Nothing playing</Text>
      <OverlayButton label="Close" onPress={closeScreen} />
    </View>
  );
}

function VideoPlayback({ request }: { request: VideoRequest }) {
  const { path, parsedPath, filename, title, startAt } = request;
  const [failed, setFailed] = useState(false);
  const closeScreen = useCloseScreen();

  const player = useVideoPlayer(path, (p) => {
    // One tick a second is plenty for the progress tracker.
    p.timeUpdateEventInterval = 1;
    p.keepScreenOnWhilePlaying = true;
  });

  // A layout effect on purpose: on unmount its cleanup runs before the passive cleanup in which
  // `useVideoPlayer` releases the player, so the tracker can still read the final position.
  useLayoutEffect(() => {
    const tracker = new VideoProgressTracker(player, parsedPath);
    return () => tracker.dispose();
  }, [player, parsedPath]);

  // Once the video is ready, jump to the resume point and start. Not on later `readyToPlay`s
  // (those follow every rebuffer), which must not pull the position back.
  useEffect(() => {
    let started = false;
    const onReady = () => {
      if (started) return;
      started = true;
      // A video must not play over an audiobook that was still going.
      AudiobookPlayer.getInstance().pause();
      if (startAt > 0 && !(player.duration > 0 && startAt >= player.duration)) player.currentTime = startAt;
      logger.log(TAG, `Playing "${title}" (${parsedPath}) from ${Math.round(startAt)}s`);
      player.play();
    };
    const onError = (error?: { message?: string }) => {
      logger.error(TAG, `Failed to play ${path}`, error?.message ?? error);
      setFailed(true);
    };

    const subscription = player.addListener('statusChange', ({ status, error }) => {
      if (status === 'readyToPlay') onReady();
      else if (status === 'error') onError(error);
    });
    // The player starts loading when it is created, so it may be ahead of this subscription.
    if (player.status === 'readyToPlay') onReady();
    else if (player.status === 'error') onError();
    return () => subscription.remove();
  }, [player, path, parsedPath, title, startAt]);

  const openExternally = () => {
    logger.log(TAG, `Falling back to the external player for ${path}`);
    openMediaInExternalApp(path, filename).catch((e: unknown) => {
      logger.error(TAG, `Failed to open file: ${path}`, e);
    });
    closeScreen();
  };

  return (
    <View style={styles.container}>
      <StatusBar hidden />
      <VideoView
        style={StyleSheet.absoluteFill}
        player={player}
        nativeControls
        contentFit="contain"
        fullscreenOptions={{ enable: false }}
      />
      {failed && (
        <View style={[StyleSheet.absoluteFill, styles.center, styles.overlay]}>
          <Text style={styles.title} numberOfLines={2}>{title}</Text>
          <Text style={styles.message}>{ERROR_MESSAGE}</Text>
          <OverlayButton label="Open in external player" onPress={openExternally} />
          <OverlayButton label="Close" onPress={closeScreen} />
        </View>
      )}
    </View>
  );
}

function OverlayButton({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <TouchableOpacity style={styles.button} onPress={onPress} accessibilityRole="button">
      <Text style={styles.buttonText}>{label}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  center: { flex: 1, backgroundColor: '#000', alignItems: 'center', justifyContent: 'center', padding: 24, gap: 12 },
  overlay: { backgroundColor: 'rgba(0, 0, 0, 0.85)' },
  title: { color: '#fff', fontSize: 18, fontWeight: '600', textAlign: 'center' },
  message: { color: '#ccc', fontSize: 16, textAlign: 'center' },
  button: { minWidth: 220, paddingVertical: 12, paddingHorizontal: 20, borderRadius: 8, backgroundColor: '#333', alignItems: 'center' },
  buttonText: { color: '#fff', fontSize: 16 },
});
