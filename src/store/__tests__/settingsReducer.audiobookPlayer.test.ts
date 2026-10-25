import reducer, {
  selectAudiobookPlaybackRate,
  selectAudiobookPlayer,
  selectAudiobookRewindSeconds,
  setAudiobookPlaybackRate,
  setAudiobookPlayer,
  setAudiobookRewindSeconds,
} from '../settingsReducer';
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

  describe('playback rate', () => {
    it('defaults to normal speed, and the selector falls back for persisted state that predates it', () => {
      expect(init().audiobookPlaybackRate).toBe(1);
      expect(selectAudiobookPlaybackRate(root(init()))).toBe(1);
      expect(selectAudiobookPlaybackRate(root({ dataSource: 'tmdb' }))).toBe(1);
    });

    it('stores a valid rate', () => {
      const s = reducer(init(), setAudiobookPlaybackRate(1.25));
      expect(selectAudiobookPlaybackRate(root(s))).toBe(1.25);
    });

    it('clamps to 0.5..2', () => {
      expect(reducer(init(), setAudiobookPlaybackRate(5)).audiobookPlaybackRate).toBe(2);
      expect(reducer(init(), setAudiobookPlaybackRate(0.1)).audiobookPlaybackRate).toBe(0.5);
      expect(reducer(init(), setAudiobookPlaybackRate(-1)).audiobookPlaybackRate).toBe(0.5);
    });

    it('ignores non-finite values', () => {
      const s = reducer(init(), setAudiobookPlaybackRate(1.5));
      expect(reducer(s, setAudiobookPlaybackRate(NaN)).audiobookPlaybackRate).toBe(1.5);
      expect(reducer(s, setAudiobookPlaybackRate(Infinity)).audiobookPlaybackRate).toBe(1.5);
    });
  });

  describe('rewind seconds', () => {
    it('defaults to 10, and the selector falls back for persisted state that predates it', () => {
      expect(init().audiobookRewindSeconds).toBe(10);
      expect(selectAudiobookRewindSeconds(root(init()))).toBe(10);
      expect(selectAudiobookRewindSeconds(root({ dataSource: 'tmdb' }))).toBe(10);
    });

    it('stores a value, 0 meaning off', () => {
      expect(selectAudiobookRewindSeconds(root(reducer(init(), setAudiobookRewindSeconds(30))))).toBe(30);
      expect(reducer(init(), setAudiobookRewindSeconds(0)).audiobookRewindSeconds).toBe(0);
    });

    it('rounds and clamps to 0..300', () => {
      expect(reducer(init(), setAudiobookRewindSeconds(7.6)).audiobookRewindSeconds).toBe(8);
      expect(reducer(init(), setAudiobookRewindSeconds(-4)).audiobookRewindSeconds).toBe(0);
      expect(reducer(init(), setAudiobookRewindSeconds(9999)).audiobookRewindSeconds).toBe(300);
    });

    it('ignores non-finite values', () => {
      const s = reducer(init(), setAudiobookRewindSeconds(15));
      expect(reducer(s, setAudiobookRewindSeconds(NaN)).audiobookRewindSeconds).toBe(15);
      expect(reducer(s, setAudiobookRewindSeconds(-Infinity)).audiobookRewindSeconds).toBe(15);
    });
  });
});
