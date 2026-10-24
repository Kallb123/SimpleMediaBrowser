import {
  BEDTIME_SECTIONS,
  bedtimeRestrictedSections,
  firstAllowedSection,
  formatTimeOfDay,
  isWithinBedtime,
  parseTimeOfDay,
  type BedtimeSection,
} from '../bedtime';

const at = (h: number, m: number) => new Date(2026, 0, 1, h, m);

describe('parseTimeOfDay', () => {
  it('parses valid times', () => {
    expect(parseTimeOfDay('00:00')).toBe(0);
    expect(parseTimeOfDay('07:30')).toBe(450);
    expect(parseTimeOfDay('19:00')).toBe(1140);
    expect(parseTimeOfDay('23:59')).toBe(1439);
  });

  it('accepts a single-digit hour leniently', () => {
    expect(parseTimeOfDay('7:00')).toBe(420);
  });

  it('rejects malformed or out-of-range values', () => {
    for (const bad of ['24:00', '12:60', 'abc', '', '12', '12:5', '12:345', '-1:00', '12:00:00']) {
      expect(parseTimeOfDay(bad)).toBeNull();
    }
  });
});

describe('formatTimeOfDay', () => {
  it('zero-pads', () => {
    expect(formatTimeOfDay(0)).toBe('00:00');
    expect(formatTimeOfDay(65)).toBe('01:05');
    expect(formatTimeOfDay(1439)).toBe('23:59');
  });

  it('round-trips with parseTimeOfDay', () => {
    for (const t of ['00:00', '07:05', '12:30', '19:00', '23:59']) {
      expect(formatTimeOfDay(parseTimeOfDay(t)!)).toBe(t);
    }
    expect(formatTimeOfDay(parseTimeOfDay('7:00')!)).toBe('07:00');
  });
});

describe('isWithinBedtime', () => {
  it('handles a same-day window as [start, end)', () => {
    expect(isWithinBedtime(at(12, 59), '13:00', '15:00')).toBe(false);
    expect(isWithinBedtime(at(13, 0), '13:00', '15:00')).toBe(true);
    expect(isWithinBedtime(at(14, 59), '13:00', '15:00')).toBe(true);
    expect(isWithinBedtime(at(15, 0), '13:00', '15:00')).toBe(false);
  });

  it('wraps windows that cross midnight', () => {
    expect(isWithinBedtime(at(18, 59), '19:00', '07:00')).toBe(false);
    expect(isWithinBedtime(at(19, 0), '19:00', '07:00')).toBe(true);
    expect(isWithinBedtime(at(23, 30), '19:00', '07:00')).toBe(true);
    expect(isWithinBedtime(at(0, 0), '19:00', '07:00')).toBe(true);
    expect(isWithinBedtime(at(6, 59), '19:00', '07:00')).toBe(true);
    expect(isWithinBedtime(at(7, 0), '19:00', '07:00')).toBe(false);
  });

  it('is never active when start equals end', () => {
    expect(isWithinBedtime(at(19, 0), '19:00', '19:00')).toBe(false);
    expect(isWithinBedtime(at(3, 0), '19:00', '19:00')).toBe(false);
  });

  it('is false when either time is malformed', () => {
    expect(isWithinBedtime(at(20, 0), 'nope', '07:00')).toBe(false);
    expect(isWithinBedtime(at(20, 0), '19:00', '25:00')).toBe(false);
    expect(isWithinBedtime(at(20, 0), '', '')).toBe(false);
  });
});

describe('bedtimeRestrictedSections', () => {
  it('audiobooks only restricts home, tv and movies', () => {
    expect([...bedtimeRestrictedSections(['audiobook'])].sort()).toEqual(['(home)', 'movies', 'tv']);
  });

  it('restricts nothing when every type is allowed', () => {
    expect(bedtimeRestrictedSections(['tv', 'movie', 'audiobook']).size).toBe(0);
  });

  it('restricts everything when nothing is allowed', () => {
    expect([...bedtimeRestrictedSections([])].sort()).toEqual([...BEDTIME_SECTIONS].sort());
  });

  it('restricts home and audiobooks when only tv and movies are allowed', () => {
    expect([...bedtimeRestrictedSections(['tv', 'movie'])].sort()).toEqual(['(home)', 'audiobooks']);
  });
});

describe('firstAllowedSection', () => {
  it('returns the first section in drawer order that is not restricted', () => {
    expect(firstAllowedSection(new Set())).toBe('(home)');
    expect(firstAllowedSection(bedtimeRestrictedSections(['audiobook']))).toBe('audiobooks');
    expect(firstAllowedSection(bedtimeRestrictedSections(['movie']))).toBe('movies');
  });

  it('returns null when everything is restricted', () => {
    expect(firstAllowedSection(new Set<BedtimeSection>(BEDTIME_SECTIONS))).toBeNull();
  });
});
