import reducer, { selectAudiobookPlayer, setAudiobookPlayer } from '../settingsReducer';
import type { RootState } from '../store';

const init = () => reducer(undefined, { type: '@@INIT' });
const root = (settingsReducer: unknown) => ({ settingsReducer }) as unknown as RootState;

describe('settingsReducer audiobookPlayer', () => {
  it('defaults to the in-app player', () => {
    expect(init().audiobookPlayer).toBe('inapp');
    expect(selectAudiobookPlayer(root(init()))).toBe('inapp');
  });

  it('setAudiobookPlayer switches between the in-app and external player', () => {
    let s = reducer(init(), setAudiobookPlayer('external'));
    expect(s.audiobookPlayer).toBe('external');
    expect(selectAudiobookPlayer(root(s))).toBe('external');
    s = reducer(s, setAudiobookPlayer('inapp'));
    expect(selectAudiobookPlayer(root(s))).toBe('inapp');
  });

  it('selector falls back to in-app for persisted state that predates the setting', () => {
    expect(selectAudiobookPlayer(root({ dataSource: 'tmdb' }))).toBe('inapp');
  });
});
