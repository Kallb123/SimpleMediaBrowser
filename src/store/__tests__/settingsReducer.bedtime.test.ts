import reducer, {
  selectBedtimeAllowedTypes,
  selectBedtimeEnabled,
  selectBedtimeSlots,
  setBedtimeAllowedTypes,
  setBedtimeEnabled,
  setBedtimeSlots,
} from '../settingsReducer';
import type { BedtimeSlot } from '../settingsReducer';
import type { RootState } from '../store';

const init = () => reducer(undefined, { type: '@@INIT' });
const root = (settingsReducer: unknown) => ({ settingsReducer }) as unknown as RootState;
const everyDay = (start: string, end: string): BedtimeSlot => ({ days: [0, 1, 2, 3, 4, 5, 6], start, end });

describe('settingsReducer bedtime', () => {
  it('has the expected defaults', () => {
    const s = init();
    expect(s.bedtimeEnabled).toBe(false);
    expect(s.bedtimeSlots).toEqual([everyDay('19:00', '07:00')]);
    expect(s.bedtimeStart).toBeUndefined();
    expect(s.bedtimeEnd).toBeUndefined();
    expect(s.bedtimeAllowedTypes).toEqual(['audiobook']);
  });

  it('setters update their fields', () => {
    const slots: BedtimeSlot[] = [
      { days: [1, 2, 3], start: '19:00', end: '07:00' },
      { days: [4, 5], start: '20:30', end: '06:15' },
    ];
    let s = init();
    s = reducer(s, setBedtimeEnabled(true));
    s = reducer(s, setBedtimeSlots(slots));
    s = reducer(s, setBedtimeAllowedTypes(['tv', 'audiobook']));
    expect(s.bedtimeEnabled).toBe(true);
    expect(s.bedtimeSlots).toEqual(slots);
    expect(s.bedtimeAllowedTypes).toEqual(['tv', 'audiobook']);
  });

  it('setBedtimeSlots drops the legacy start/end keys', () => {
    const legacy = { ...init(), bedtimeStart: '20:00', bedtimeEnd: '06:00' };
    const s = reducer(legacy, setBedtimeSlots([everyDay('21:00', '07:00')]));
    expect('bedtimeStart' in s).toBe(false);
    expect('bedtimeEnd' in s).toBe(false);
  });

  it('selectors read the stored values', () => {
    let s = init();
    s = reducer(s, setBedtimeEnabled(true));
    s = reducer(s, setBedtimeSlots([{ days: [6, 0], start: '21:00', end: '08:00' }]));
    s = reducer(s, setBedtimeAllowedTypes([]));
    const state = root(s);
    expect(selectBedtimeEnabled(state)).toBe(true);
    expect(selectBedtimeSlots(state)).toEqual([{ days: [6, 0], start: '21:00', end: '08:00' }]);
    expect(selectBedtimeAllowedTypes(state)).toEqual([]);
  });

  it('selectors fall back to defaults for legacy persisted state', () => {
    const legacy = root({ dataSource: 'tmdb' });
    expect(selectBedtimeEnabled(legacy)).toBe(false);
    expect(selectBedtimeSlots(legacy)).toEqual([everyDay('19:00', '07:00')]);
    expect(selectBedtimeAllowedTypes(legacy)).toEqual(['audiobook']);
  });

  it('migrates a legacy single window to one every-day slot', () => {
    const legacy = root({ bedtimeStart: '20:30', bedtimeEnd: '06:15' });
    expect(selectBedtimeSlots(legacy)).toEqual([everyDay('20:30', '06:15')]);
    expect(selectBedtimeSlots(root({ bedtimeStart: '21:00' }))).toEqual([everyDay('21:00', '07:00')]);
    expect(selectBedtimeSlots(root({ bedtimeEnd: '08:00' }))).toEqual([everyDay('19:00', '08:00')]);
  });

  it('prefers bedtimeSlots over the legacy fields', () => {
    const state = root({ bedtimeSlots: [{ days: [1], start: '22:00', end: '06:00' }], bedtimeStart: '20:00', bedtimeEnd: '05:00' });
    expect(selectBedtimeSlots(state)).toEqual([{ days: [1], start: '22:00', end: '06:00' }]);
  });

  it('returns stable references when the input is unchanged', () => {
    const legacy = root({});
    expect(selectBedtimeAllowedTypes(legacy)).toBe(selectBedtimeAllowedTypes(root({})));
    expect(selectBedtimeSlots(legacy)).toBe(selectBedtimeSlots(root({})));
    const migrated = root({ bedtimeStart: '20:00', bedtimeEnd: '06:00' });
    expect(selectBedtimeSlots(migrated)).toBe(selectBedtimeSlots(migrated));
    const s = reducer(init(), setBedtimeSlots([everyDay('21:00', '07:00')]));
    expect(selectBedtimeSlots(root(s))).toBe(s.bedtimeSlots);
  });
});
