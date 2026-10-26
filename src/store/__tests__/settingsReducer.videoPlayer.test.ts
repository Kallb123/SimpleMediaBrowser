import reducer, {
  selectVideoAudioLanguage,
  selectVideoPlayer,
  selectVideoSubtitleLanguage,
  setVideoAudioLanguage,
  setVideoPlayer,
  setVideoSubtitleLanguage,
} from '../settingsReducer';
import type { RootState } from '../store';

const init = () => reducer(undefined, { type: '@@INIT' });
const root = (settingsReducer: unknown) => ({ settingsReducer }) as unknown as RootState;

describe('settingsReducer videoPlayer', () => {
  it('defaults to the in-app player', () => {
    expect(init().videoPlayer).toBe('inapp');
    expect(selectVideoPlayer(root(init()))).toBe('inapp');
  });

  it('setVideoPlayer switches between the in-app and external player', () => {
    let s = reducer(init(), setVideoPlayer('external'));
    expect(s.videoPlayer).toBe('external');
    expect(selectVideoPlayer(root(s))).toBe('external');
    s = reducer(s, setVideoPlayer('inapp'));
    expect(selectVideoPlayer(root(s))).toBe('inapp');
  });

  it('selector falls back to in-app for persisted state that predates the setting', () => {
    expect(selectVideoPlayer(root({ dataSource: 'tmdb' }))).toBe('inapp');
  });

  it('remembers no track language until one is chosen', () => {
    expect(init().videoSubtitleLanguage).toBeNull();
    expect(init().videoAudioLanguage).toBeNull();
    expect(selectVideoSubtitleLanguage(root(init()))).toBeNull();
    expect(selectVideoAudioLanguage(root(init()))).toBeNull();
    // Persisted state that predates the settings has neither field.
    expect(selectVideoSubtitleLanguage(root({ dataSource: 'tmdb' }))).toBeNull();
    expect(selectVideoAudioLanguage(root({ dataSource: 'tmdb' }))).toBeNull();
  });

  it('stores the preferred subtitle language, with "off" for subtitles turned off', () => {
    let s = reducer(init(), setVideoSubtitleLanguage('en'));
    expect(selectVideoSubtitleLanguage(root(s))).toBe('en');
    s = reducer(s, setVideoSubtitleLanguage('off'));
    expect(selectVideoSubtitleLanguage(root(s))).toBe('off');
    s = reducer(s, setVideoSubtitleLanguage(null));
    expect(selectVideoSubtitleLanguage(root(s))).toBeNull();
  });

  it('stores the preferred audio language independently of the subtitle one', () => {
    const s = reducer(init(), setVideoAudioLanguage('ja'));
    expect(selectVideoAudioLanguage(root(s))).toBe('ja');
    expect(selectVideoSubtitleLanguage(root(s))).toBeNull();
  });
});
