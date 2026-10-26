import reducer, {
  selectShowSidebarSort,
  selectVideoAutoPlayNext,
  selectVideoPlaybackRate,
  selectVideoShowProgressBar,
  selectVideoSpeedControlEnabled,
  selectVideoTrackPickerEnabled,
  setShowSidebarSort,
  setVideoAutoPlayNext,
  setVideoPlaybackRate,
  setVideoShowProgressBar,
  setVideoSpeedControlEnabled,
  setVideoTrackPickerEnabled,
} from '../settingsReducer';
import type { RootState } from '../store';

const init = () => reducer(undefined, { type: '@@INIT' });
const root = (settingsReducer: unknown) => ({ settingsReducer }) as unknown as RootState;

describe('settingsReducer video player features', () => {
  it('defaults every video feature on, at normal speed with the "Up next" prompt', () => {
    const s = init();
    expect(s.videoShowProgressBar).toBe(true);
    expect(s.videoTrackPickerEnabled).toBe(true);
    expect(s.videoSpeedControlEnabled).toBe(true);
    expect(s.videoPlaybackRate).toBe(1);
    expect(s.videoAutoPlayNext).toBe('prompt');
    expect(selectVideoShowProgressBar(root(s))).toBe(true);
    expect(selectVideoTrackPickerEnabled(root(s))).toBe(true);
    expect(selectVideoSpeedControlEnabled(root(s))).toBe(true);
    expect(selectVideoPlaybackRate(root(s))).toBe(1);
    expect(selectVideoAutoPlayNext(root(s))).toBe('prompt');
  });

  it('defaults the sidebar sort menu off', () => {
    expect(init().showSidebarSort).toBe(false);
    expect(selectShowSidebarSort(root(init()))).toBe(false);
  });

  it('setters toggle each feature independently', () => {
    let s = reducer(init(), setVideoShowProgressBar(false));
    expect(selectVideoShowProgressBar(root(s))).toBe(false);
    expect(selectVideoTrackPickerEnabled(root(s))).toBe(true);
    s = reducer(s, setVideoTrackPickerEnabled(false));
    expect(selectVideoTrackPickerEnabled(root(s))).toBe(false);
    expect(selectVideoSpeedControlEnabled(root(s))).toBe(true);
    s = reducer(s, setVideoSpeedControlEnabled(false));
    expect(selectVideoSpeedControlEnabled(root(s))).toBe(false);
    s = reducer(s, setShowSidebarSort(true));
    expect(selectShowSidebarSort(root(s))).toBe(true);
    s = reducer(s, setVideoShowProgressBar(true));
    expect(selectVideoShowProgressBar(root(s))).toBe(true);
  });

  it('setVideoAutoPlayNext stores each mode', () => {
    let s = reducer(init(), setVideoAutoPlayNext('countdown'));
    expect(selectVideoAutoPlayNext(root(s))).toBe('countdown');
    s = reducer(s, setVideoAutoPlayNext('off'));
    expect(selectVideoAutoPlayNext(root(s))).toBe('off');
    s = reducer(s, setVideoAutoPlayNext('prompt'));
    expect(selectVideoAutoPlayNext(root(s))).toBe('prompt');
  });

  it('selectVideoAutoPlayNext coerces a missing or corrupt persisted value to "prompt"', () => {
    expect(selectVideoAutoPlayNext(root({ dataSource: 'tmdb' }))).toBe('prompt');
    expect(selectVideoAutoPlayNext(root({ videoAutoPlayNext: 'bogus' }))).toBe('prompt');
    expect(selectVideoAutoPlayNext(root({ videoAutoPlayNext: 3 }))).toBe('prompt');
    expect(selectVideoAutoPlayNext(root({ videoAutoPlayNext: null }))).toBe('prompt');
  });

  it('setVideoPlaybackRate stores in-range values and clamps to 0.5-2', () => {
    let s = reducer(init(), setVideoPlaybackRate(1.5));
    expect(selectVideoPlaybackRate(root(s))).toBe(1.5);
    s = reducer(s, setVideoPlaybackRate(10));
    expect(selectVideoPlaybackRate(root(s))).toBe(2);
    s = reducer(s, setVideoPlaybackRate(0.1));
    expect(selectVideoPlaybackRate(root(s))).toBe(0.5);
  });

  it('setVideoPlaybackRate ignores non-finite values', () => {
    const s = reducer(init(), setVideoPlaybackRate(1.25));
    for (const bad of [NaN, Infinity, -Infinity]) {
      expect(reducer(s, setVideoPlaybackRate(bad)).videoPlaybackRate).toBe(1.25);
    }
  });

  it('selectors fall back to the defaults for persisted state that predates the settings', () => {
    const old = root({ dataSource: 'tmdb' });
    expect(selectVideoShowProgressBar(old)).toBe(true);
    expect(selectVideoTrackPickerEnabled(old)).toBe(true);
    expect(selectVideoSpeedControlEnabled(old)).toBe(true);
    expect(selectVideoPlaybackRate(old)).toBe(1);
    expect(selectShowSidebarSort(old)).toBe(false);
  });
});
