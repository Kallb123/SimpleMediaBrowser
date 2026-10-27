import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { router, useLocalSearchParams, useNavigation } from 'expo-router';
import { StackActions } from '@react-navigation/native';
import { StatusBar } from 'expo-status-bar';
import { VideoView, useVideoPlayer } from 'expo-video';
import type { VideoPlayer } from 'expo-video';
import { AudiobookPlayer, PLAYBACK_RATES } from '@/scripts/AudiobookPlayer';
import { logger } from '@/scripts/Logger';
import { openMediaInExternalApp } from '@/scripts/openMedia';
import { nextEpisode, resolveVideoRequest, unsupportedVideoTrack } from '@/scripts/VideoPlayback';
import type { NextEpisode, VideoRequest } from '@/scripts/VideoPlayback';
import { VideoProgressTracker } from '@/scripts/VideoProgressTracker';
import { isWatchedPosition, resumePosition } from '@/scripts/videoProgress';
import { setEpisodeLastOpened, setPersonalLastOpened } from '@/store/libraryReducer';
import {
  selectVideoAutoPlayNext,
  selectVideoPlaybackRate,
  selectVideoSpeedControlEnabled,
  selectVideoTrackPickerEnabled,
  setVideoPlaybackRate,
} from '@/store/settingsReducer';
import type { videoAutoPlayNextModes } from '@/store/settingsReducer';
import { useBedtime } from '@/contexts/BedtimeContext';
import { useAppDispatch, useAppStore } from '@/hooks/useRedux';
import { useControlsVisible, useVideoTracks } from '@/hooks/useVideoTracks';
import { OptionSheet } from '@/components/OptionSheet';
import { UpNextCard } from '@/components/UpNextCard';
import { VideoTrackPicker } from '@/components/VideoTrackPicker';

const TAG = 'VideoPlayerScreen';

/** How long the "Up next" card counts down after the video ends, in `countdown` mode. */
const COUNTDOWN_SECONDS = 10;

/** Speeds the picker offers: the audiobook player's, plus 0.5× for slowing a video down. */
const VIDEO_PLAYBACK_RATES: readonly number[] = [0.5, ...PLAYBACK_RATES];

const formatRate = (rate: number) => `${parseFloat(rate.toFixed(2))}×`;

/** How long the player may take to become ready before the user is offered the external player. */
const LOAD_TIMEOUT_MS = 30_000;

/**
 * Why playback is not (or may not be) working, shown as an overlay. `error` is the player's own
 * error status; the others are failures it never reports: a video track the device cannot decode
 * (the sound plays over a black screen) and a load that never finishes.
 */
type Problem = { kind: 'error' } | { kind: 'unsupported'; mimeType: string } | { kind: 'slow' };

const problemMessage = (problem: Problem) => {
  switch (problem.kind) {
    case 'error': return 'This file could not be played.';
    case 'unsupported': return `This device can't show the picture in this file (${problem.mimeType}).`;
    case 'slow': return 'This file is taking a long time to load.';
  }
};

/** The button that dismisses the overlay and carries on; the error has none. */
const DISMISS_LABELS = { unsupported: 'Play anyway', slow: 'Keep waiting' } as const;

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
 * The in-app video player: a full-screen modal playing the file its route params name. The params
 * carry only the library key (`parsedPath`) and the start time; the file URI, filename and title
 * are looked up in the library, so the screen depends on nothing but its params. Unlike the
 * audiobook player it owns its player, so closing the screen stops playback (no background
 * playback or Picture-in-Picture yet).
 */
export default function VideoPlayerScreen() {
  const { parsedPath, startAt } = useLocalSearchParams<{ parsedPath?: string; startAt?: string }>();
  const store = useAppStore();
  // Resolved once: a rescan while playing must not reload the player.
  const [request] = useState(() => {
    const resolved = resolveVideoRequest(store.getState().libraryReducer, parsedPath, startAt);
    if (!resolved) logger.warn(TAG, `Nothing to play for parsedPath=${parsedPath} startAt=${startAt}`);
    return resolved;
  });
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

/**
 * Drives the "Up next" card for `next` (null = nothing to offer). It is offered once playback is
 * past the watched threshold or has ended, unless dismissed, which lasts for this video. Seeking
 * back before the threshold hides it again. In `countdown` mode a video that has played to its end
 * also counts down and then calls `onAutoPlay`. `suspended` (an overlay is up) hides the card and
 * holds the countdown where it is.
 */
function useUpNext(player: VideoPlayer, next: NextEpisode | null, mode: videoAutoPlayNextModes, suspended: boolean, onAutoPlay: () => void) {
  const [pastThreshold, setPastThreshold] = useState(false);
  const [ended, setEnded] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState(COUNTDOWN_SECONDS);
  // After `playToEnd` a player may rewind to 0 and tick; that must not hide the card.
  const endedRef = useRef(false);
  const autoPlayFired = useRef(false);
  const latestAutoPlay = useRef(onAutoPlay);
  latestAutoPlay.current = onAutoPlay;

  useEffect(() => {
    if (!next) return;
    const subscriptions = [
      player.addListener('timeUpdate', ({ currentTime }) => {
        if (!endedRef.current) setPastThreshold(isWatchedPosition(currentTime, player.duration));
      }),
      player.addListener('playToEnd', () => {
        endedRef.current = true;
        setPastThreshold(true);
        setEnded(true);
      }),
      // Playing again after the end (a replay) cancels the countdown.
      player.addListener('playingChange', ({ isPlaying }) => {
        if (!isPlaying || !endedRef.current) return;
        endedRef.current = false;
        setEnded(false);
        setSecondsLeft(COUNTDOWN_SECONDS);
      }),
    ];
    return () => subscriptions.forEach((s) => s.remove());
  }, [player, next]);

  const offered = next !== null && !dismissed && (pastThreshold || ended);
  const counting = offered && ended && mode === 'countdown' && !suspended;

  useEffect(() => {
    if (offered && next) logger.log(TAG, `Offering next episode "${next.title}" (${mode})`);
  }, [offered, next, mode]);

  useEffect(() => {
    if (!counting) return;
    const timer = setInterval(() => setSecondsLeft((s) => s - 1), 1000);
    return () => clearInterval(timer);
  }, [counting]);

  useEffect(() => {
    if (!counting || secondsLeft > 0 || autoPlayFired.current) return;
    autoPlayFired.current = true;
    latestAutoPlay.current();
  }, [counting, secondsLeft]);

  return {
    visible: offered && !suspended,
    /** Null while the card waits for a tap. */
    secondsLeft: offered && ended && mode === 'countdown' ? Math.max(0, secondsLeft) : null,
    dismiss: () => setDismissed(true),
  };
}

function VideoPlayback({ request }: { request: VideoRequest }) {
  const { path, parsedPath, filename, title, startAt } = request;
  const store = useAppStore();
  const dispatch = useAppDispatch();
  // Read once, like the request: changing a setting mid-video does not rearrange the player.
  const [settings] = useState(() => {
    const state = store.getState();
    const autoPlayNext = selectVideoAutoPlayNext(state);
    const speedControl = selectVideoSpeedControlEnabled(state);
    return {
      trackPicker: selectVideoTrackPickerEnabled(state),
      speedControl,
      // With the control off the video always plays at normal speed, whatever was remembered.
      playbackRate: speedControl ? selectVideoPlaybackRate(state) : 1,
      autoPlayNext,
      next: autoPlayNext === 'off' ? null : nextEpisode(state.libraryReducer, parsedPath),
    };
  });
  const [problem, setProblem] = useState<Problem | null>(null);
  // Set while the unsupported-picture overlay is up, so a late `readyToPlay` does not start the sound.
  const holdPlayback = useRef(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [speedOpen, setSpeedOpen] = useState(false);
  const [playbackRate, setPlaybackRate] = useState(settings.playbackRate);
  const closeScreen = useCloseScreen();
  // Bedtime locking TV (or Personal) must also stop the player from chaining into the next video.
  const { restrictedSections } = useBedtime();
  const next = settings.next && !restrictedSections.has(settings.next.isPersonal ? 'personal' : 'tv') ? settings.next : null;

  const player = useVideoPlayer(path, (p) => {
    // One tick a second is plenty for the progress tracker.
    p.timeUpdateEventInterval = 1;
    p.keepScreenOnWhilePlaying = true;
  });
  const tracks = useVideoTracks(player, settings.trackPicker);
  const controlsVisible = useControlsVisible(player);

  // Replaces this screen with the next episode's: the new route key remounts the screen, so
  // `VideoPlayback` resolves a fresh request, and this tracker's cleanup still saves this one.
  const playNext = () => {
    if (!next) return;
    logger.log(TAG, `Playing next episode "${next.title}" (${next.parsedPath})`);
    const openedAction = next.isPersonal ? setPersonalLastOpened : setEpisodeLastOpened;
    dispatch(openedAction({ path: next.path, lastOpened: Date.now() }));
    const nextStart = resumePosition(store.getState().libraryReducer.watchProgress[next.parsedPath]);
    router.replace({ pathname: '/videoplayer', params: { parsedPath: next.parsedPath, startAt: String(nextStart) } });
  };
  const upNext = useUpNext(player, next, settings.autoPlayNext, !!problem || pickerOpen || speedOpen, playNext);

  const selectRate = (key: string) => {
    const rate = Number(key);
    player.playbackRate = rate;
    setPlaybackRate(rate);
    setSpeedOpen(false);
    dispatch(setVideoPlaybackRate(rate));
    logger.log(TAG, `Playback speed ${formatRate(rate)} chosen`);
  };

  // A layout effect on purpose: on unmount its cleanup runs before the passive cleanup in which
  // `useVideoPlayer` releases the player, so the tracker can still read the final position.
  useLayoutEffect(() => {
    const tracker = new VideoProgressTracker(player, parsedPath);
    return () => tracker.dispose();
  }, [player, parsedPath]);

  // Once the video is ready, jump to the resume point and start. Not on later `readyToPlay`s
  // (those follow every rebuffer), which must not pull the position back. The same effect watches
  // for the failures that come without an `error` status. An `error` always wins over the others.
  useEffect(() => {
    let started = false;
    let tracksChecked = false;
    // Not ready in time (slow or unreachable storage, a container the extractor chokes on).
    const slowTimer = setTimeout(() => {
      logger.warn(TAG, `${path} not ready after ${LOAD_TIMEOUT_MS / 1000}s`);
      setProblem((prev) => prev ?? { kind: 'slow' });
    }, LOAD_TIMEOUT_MS);
    const onReady = () => {
      if (started) return;
      started = true;
      clearTimeout(slowTimer);
      // The load finished after all, so the "taking a long time" notice no longer applies.
      setProblem((prev) => (prev?.kind === 'slow' ? null : prev));
      // A video must not play over an audiobook that was still going.
      AudiobookPlayer.getInstance().pause();
      if (startAt > 0 && !(player.duration > 0 && startAt >= player.duration)) player.currentTime = startAt;
      player.playbackRate = settings.playbackRate;
      logger.log(TAG, `Playing "${title}" (${parsedPath}) from ${Math.round(startAt)}s at ${formatRate(settings.playbackRate)}`);
      if (!holdPlayback.current) player.play();
    };
    const onError = (error?: { message?: string }) => {
      clearTimeout(slowTimer);
      logger.error(TAG, `Failed to play ${path}`, error?.message ?? error);
      setProblem({ kind: 'error' });
    };
    // ExoPlayer skips a video track the device cannot decode and plays the sound over a black screen.
    // Only the first look at a non-empty track list counts.
    const checkTracks = (tracks: Parameters<typeof unsupportedVideoTrack>[0]) => {
      if (tracksChecked || tracks.length === 0) return;
      tracksChecked = true;
      const mimeType = unsupportedVideoTrack(tracks);
      if (!mimeType) return;
      logger.warn(TAG, `No supported video track in ${path} (${mimeType})`);
      holdPlayback.current = true;
      player.pause();
      setProblem((prev) => (prev?.kind === 'error' ? prev : { kind: 'unsupported', mimeType }));
    };

    const statusSubscription = player.addListener('statusChange', ({ status, error }) => {
      if (status === 'readyToPlay') onReady();
      else if (status === 'error') onError(error);
    });
    const loadSubscription = player.addListener('sourceLoad', ({ availableVideoTracks }) => checkTracks(availableVideoTracks));
    // The player starts loading when it is created, so it may be ahead of this subscription.
    if (player.status === 'readyToPlay') {
      checkTracks(player.availableVideoTracks);
      onReady();
    } else if (player.status === 'error') onError();
    return () => {
      clearTimeout(slowTimer);
      statusSubscription.remove();
      loadSubscription.remove();
    };
  }, [player, path, parsedPath, title, startAt, settings.playbackRate]);

  const openExternally = () => {
    logger.log(TAG, `Falling back to the external player for ${path}`);
    openMediaInExternalApp(path, filename).catch((e: unknown) => {
      logger.error(TAG, `Failed to open file: ${path}`, e);
    });
    closeScreen();
  };

  const dismissProblem = () => {
    if (problem?.kind === 'unsupported') {
      holdPlayback.current = false;
      player.play();
    }
    setProblem(null);
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
      {/* A small corner button rather than a touch layer, so the native controls keep every other tap. */}
      {controlsVisible && !problem && !pickerOpen && !speedOpen && (
        <View style={styles.cornerButtons} pointerEvents="box-none">
          {settings.speedControl && (
            <TouchableOpacity
              style={styles.cornerButton}
              onPress={() => setSpeedOpen(true)}
              accessibilityRole="button"
              accessibilityLabel={`Playback speed ${formatRate(playbackRate)}`}
            >
              <Text style={styles.buttonText}>{formatRate(playbackRate)}</Text>
            </TouchableOpacity>
          )}
          {settings.trackPicker && tracks.hasChoices && (
            <TouchableOpacity
              style={styles.cornerButton}
              onPress={() => setPickerOpen(true)}
              accessibilityRole="button"
              accessibilityLabel="Subtitles and audio"
            >
              <Text style={styles.buttonText}>CC</Text>
            </TouchableOpacity>
          )}
        </View>
      )}
      {settings.speedControl && (
        <OptionSheet
          visible={speedOpen && !problem}
          title="Playback speed"
          options={VIDEO_PLAYBACK_RATES.map((rate) => ({ key: String(rate), label: formatRate(rate), selected: rate === playbackRate }))}
          onSelect={selectRate}
          onDismiss={() => setSpeedOpen(false)}
        />
      )}
      {next && upNext.visible && (
        <UpNextCard title={next.title} secondsLeft={upNext.secondsLeft} onPlay={playNext} onDismiss={upNext.dismiss} />
      )}
      {pickerOpen && !problem && (
        <VideoTrackPicker
          subtitleTracks={tracks.subtitleTracks}
          subtitleTrack={tracks.subtitleTrack}
          audioTracks={tracks.audioTracks}
          audioTrack={tracks.audioTrack}
          onSelectSubtitle={(track) => { tracks.selectSubtitle(track); setPickerOpen(false); }}
          onSelectAudio={(track) => { tracks.selectAudio(track); setPickerOpen(false); }}
          onClose={() => setPickerOpen(false)}
        />
      )}
      {problem && (
        <View style={[StyleSheet.absoluteFill, styles.center, styles.overlay]}>
          <Text style={styles.title} numberOfLines={2}>{title}</Text>
          <Text style={styles.message}>{problemMessage(problem)}</Text>
          <OverlayButton label="Open in external player" onPress={openExternally} />
          {problem.kind !== 'error' && <OverlayButton label={DISMISS_LABELS[problem.kind]} onPress={dismissProblem} />}
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
  cornerButtons: { position: 'absolute', top: 16, right: 16, flexDirection: 'row', gap: 8 },
  cornerButton: { paddingVertical: 8, paddingHorizontal: 14, borderRadius: 8, backgroundColor: 'rgba(0, 0, 0, 0.6)' },
});
