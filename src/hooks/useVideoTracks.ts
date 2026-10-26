import { useEffect, useState } from 'react';
import type { AudioTrack, SubtitleTrack, VideoPlayer } from 'expo-video';
import { logger } from '@/scripts/Logger';
import { preferredTrack } from '@/scripts/VideoPlayback';
import { selectVideoAudioLanguage, selectVideoSubtitleLanguage, setVideoAudioLanguage, setVideoSubtitleLanguage } from '@/store/settingsReducer';
import { useAppDispatch, useAppStore } from '@/hooks/useRedux';

const TAG = 'VideoTracks';

/** How long the picker button stays up after playback starts (the native controls hide on a similar timer). */
const BUTTON_HIDE_MS = 4000;

/**
 * The embedded subtitle and audio tracks of a player and the user's choice among them. Applies the
 * remembered language once per list (so a choice made during playback is never overridden) and
 * remembers a new choice. `buttonVisible` stands in for the native controls: expo-video does not
 * report when they show, so the button is up while paused and for a few seconds after play starts.
 */
export function useVideoTracks(player: VideoPlayer) {
  const store = useAppStore();
  const dispatch = useAppDispatch();
  const [subtitleTracks, setSubtitleTracks] = useState<SubtitleTrack[]>([]);
  const [subtitleTrack, setSubtitleTrack] = useState<SubtitleTrack | null>(null);
  const [audioTracks, setAudioTracks] = useState<AudioTrack[]>([]);
  const [audioTrack, setAudioTrack] = useState<AudioTrack | null>(null);
  const [buttonVisible, setButtonVisible] = useState(true);

  useEffect(() => {
    let subtitlesApplied = false;
    let audioApplied = false;
    let hideTimer: ReturnType<typeof setTimeout> | undefined;

    // The remembered language is read from the store here, not from a selector hook, so changing it
    // (which choosing a track does) does not re-run this effect.
    const applySubtitles = (tracks: SubtitleTrack[]) => {
      if (subtitlesApplied || tracks.length === 0) return;
      subtitlesApplied = true;
      const language = selectVideoSubtitleLanguage(store.getState());
      if (language === null) return;
      if (language === 'off') {
        player.subtitleTrack = null;
        setSubtitleTrack(null);
        logger.log(TAG, 'Subtitles off (remembered)');
        return;
      }
      const match = preferredTrack(tracks, language);
      if (!match) return;
      player.subtitleTrack = match;
      setSubtitleTrack(match);
      logger.log(TAG, `Subtitles set to "${match.label}" (${match.language}, remembered ${language})`);
    };
    const applyAudio = (tracks: AudioTrack[]) => {
      // With a single track there is nothing to choose between.
      if (audioApplied || tracks.length === 0) return;
      audioApplied = true;
      const language = selectVideoAudioLanguage(store.getState());
      if (language === null || tracks.length < 2) return;
      const match = preferredTrack(tracks, language);
      if (!match) return;
      player.audioTrack = match;
      setAudioTrack(match);
      logger.log(TAG, `Audio set to "${match.label}" (${match.language}, remembered ${language})`);
    };
    const onSubtitleTracks = (tracks: SubtitleTrack[]) => {
      setSubtitleTracks(tracks);
      applySubtitles(tracks);
    };
    const onAudioTracks = (tracks: AudioTrack[]) => {
      setAudioTracks(tracks);
      applyAudio(tracks);
    };
    const onPlaying = (isPlaying: boolean) => {
      clearTimeout(hideTimer);
      setButtonVisible(true);
      if (isPlaying) hideTimer = setTimeout(() => setButtonVisible(false), BUTTON_HIDE_MS);
    };

    const subscriptions = [
      player.addListener('availableSubtitleTracksChange', ({ availableSubtitleTracks }) => onSubtitleTracks(availableSubtitleTracks)),
      player.addListener('availableAudioTracksChange', ({ availableAudioTracks }) => onAudioTracks(availableAudioTracks)),
      player.addListener('sourceLoad', ({ availableSubtitleTracks, availableAudioTracks }) => {
        onSubtitleTracks(availableSubtitleTracks);
        onAudioTracks(availableAudioTracks);
      }),
      player.addListener('subtitleTrackChange', ({ subtitleTrack: track }) => setSubtitleTrack(track)),
      player.addListener('audioTrackChange', ({ audioTrack: track }) => setAudioTrack(track)),
      player.addListener('playingChange', ({ isPlaying }) => onPlaying(isPlaying)),
    ];
    // The player starts loading when it is created, so it may be ahead of these subscriptions.
    setSubtitleTrack(player.subtitleTrack);
    setAudioTrack(player.audioTrack);
    onSubtitleTracks(player.availableSubtitleTracks);
    onAudioTracks(player.availableAudioTracks);
    onPlaying(player.playing);
    return () => {
      clearTimeout(hideTimer);
      subscriptions.forEach((s) => s.remove());
    };
  }, [player, store]);

  const selectSubtitle = (track: SubtitleTrack | null) => {
    player.subtitleTrack = track;
    setSubtitleTrack(track);
    if (track === null) dispatch(setVideoSubtitleLanguage('off'));
    // A track without a language cannot be matched again, so there is nothing to remember.
    else if (track.language) dispatch(setVideoSubtitleLanguage(track.language));
    logger.log(TAG, `Subtitles ${track ? `"${track.label}" (${track.language})` : 'off'} chosen`);
  };
  const selectAudio = (track: AudioTrack) => {
    player.audioTrack = track;
    setAudioTrack(track);
    if (track.language) dispatch(setVideoAudioLanguage(track.language));
    logger.log(TAG, `Audio "${track.label}" (${track.language}) chosen`);
  };

  return {
    subtitleTracks,
    subtitleTrack,
    audioTracks,
    audioTrack,
    /** Whether there is anything to choose: a subtitle track to turn on, or a second audio track. */
    hasChoices: subtitleTracks.length > 0 || audioTracks.length > 1,
    buttonVisible,
    selectSubtitle,
    selectAudio,
  };
}
