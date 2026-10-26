import reducer, { selectKeyboardHandling, setKeyboardHandling } from '../settingsReducer';
import type { RootState } from '../store';

const init = () => reducer(undefined, { type: '@@INIT' });
const root = (settingsReducer: unknown) => ({ settingsReducer }) as unknown as RootState;

describe('settingsReducer keyboardHandling', () => {
  it('defaults to the legacy keyboard handling', () => {
    expect(init().keyboardHandling).toBe('legacy');
    expect(selectKeyboardHandling(root(init()))).toBe('legacy');
  });

  it('setKeyboardHandling switches between legacy and library', () => {
    let s = reducer(init(), setKeyboardHandling('library'));
    expect(s.keyboardHandling).toBe('library');
    expect(selectKeyboardHandling(root(s))).toBe('library');
    s = reducer(s, setKeyboardHandling('legacy'));
    expect(selectKeyboardHandling(root(s))).toBe('legacy');
  });

  it('selector falls back to legacy for persisted state that predates the setting', () => {
    expect(selectKeyboardHandling(root({ dataSource: 'tmdb' }))).toBe('legacy');
  });

  it('selector falls back to legacy for an unrecognised persisted value', () => {
    expect(selectKeyboardHandling(root({ keyboardHandling: 'bogus' }))).toBe('legacy');
  });
});
