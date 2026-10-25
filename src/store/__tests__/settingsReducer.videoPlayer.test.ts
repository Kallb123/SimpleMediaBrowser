import reducer, { selectVideoPlayer, setVideoPlayer } from '../settingsReducer';
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
});
