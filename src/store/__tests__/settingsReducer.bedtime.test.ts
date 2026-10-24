import reducer, {
  selectBedtimeAllowedTypes,
  selectBedtimeEnabled,
  selectBedtimeEnd,
  selectBedtimeStart,
  setBedtimeAllowedTypes,
  setBedtimeEnabled,
  setBedtimeEnd,
  setBedtimeStart,
} from '../settingsReducer';
import type { RootState } from '../store';

const init = () => reducer(undefined, { type: '@@INIT' });
const root = (settingsReducer: unknown) => ({ settingsReducer }) as unknown as RootState;

describe('settingsReducer bedtime', () => {
  it('has the expected defaults', () => {
    const s = init();
    expect(s.bedtimeEnabled).toBe(false);
    expect(s.bedtimeStart).toBe('19:00');
    expect(s.bedtimeEnd).toBe('07:00');
    expect(s.bedtimeAllowedTypes).toEqual(['audiobook']);
  });

  it('setters update their fields', () => {
    let s = init();
    s = reducer(s, setBedtimeEnabled(true));
    s = reducer(s, setBedtimeStart('20:30'));
    s = reducer(s, setBedtimeEnd('06:15'));
    s = reducer(s, setBedtimeAllowedTypes(['tv', 'audiobook']));
    expect(s.bedtimeEnabled).toBe(true);
    expect(s.bedtimeStart).toBe('20:30');
    expect(s.bedtimeEnd).toBe('06:15');
    expect(s.bedtimeAllowedTypes).toEqual(['tv', 'audiobook']);
  });

  it('selectors read the stored values', () => {
    let s = init();
    s = reducer(s, setBedtimeEnabled(true));
    s = reducer(s, setBedtimeStart('21:00'));
    s = reducer(s, setBedtimeAllowedTypes([]));
    const state = root(s);
    expect(selectBedtimeEnabled(state)).toBe(true);
    expect(selectBedtimeStart(state)).toBe('21:00');
    expect(selectBedtimeEnd(state)).toBe('07:00');
    expect(selectBedtimeAllowedTypes(state)).toEqual([]);
  });

  it('selectors fall back to defaults for legacy persisted state', () => {
    const legacy = root({ dataSource: 'tmdb' });
    expect(selectBedtimeEnabled(legacy)).toBe(false);
    expect(selectBedtimeStart(legacy)).toBe('19:00');
    expect(selectBedtimeEnd(legacy)).toBe('07:00');
    expect(selectBedtimeAllowedTypes(legacy)).toEqual(['audiobook']);
  });

  it('returns a stable allowed-types reference when the key is missing', () => {
    const legacy = root({});
    expect(selectBedtimeAllowedTypes(legacy)).toBe(selectBedtimeAllowedTypes(root({})));
  });
});
