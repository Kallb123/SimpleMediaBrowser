import type { BedtimeSlot, defaultPages } from '@/store/settingsReducer';
import {
  ALL_BEDTIME_DAYS,
  BEDTIME_DAY_ORDER,
  BEDTIME_DAY_SHORT_LABELS,
  BEDTIME_SECTIONS,
  DEFAULT_BEDTIME_SLOT,
  activeBedtimeSlot,
  bedtimeRestrictedSections,
  defaultPageSection,
  firstAllowedSection,
  formatBedtimeDays,
  formatTimeOfDay,
  initialSection,
  isWithinBedtime,
  parseTimeOfDay,
  sanitizeBedtimeSlots,
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
  it('audiobooks only restricts home, tv, movies and personal', () => {
    expect([...bedtimeRestrictedSections(['audiobook'])].sort()).toEqual(['(home)', 'movies', 'personal', 'tv']);
  });

  it('restricts nothing when every type is allowed', () => {
    expect(bedtimeRestrictedSections(['tv', 'movie', 'audiobook', 'personal']).size).toBe(0);
  });

  it('does not restrict home just because personal is not allowed (home never shows personal videos)', () => {
    expect([...bedtimeRestrictedSections(['tv', 'movie', 'audiobook'])]).toEqual(['personal']);
  });

  it('restricts home when a library it shows is not allowed, even with personal allowed', () => {
    expect([...bedtimeRestrictedSections(['tv', 'movie', 'personal'])].sort()).toEqual(['(home)', 'audiobooks']);
  });

  it('allowing only personal restricts everything else', () => {
    expect([...bedtimeRestrictedSections(['personal'])].sort()).toEqual(['(home)', 'audiobooks', 'movies', 'tv']);
  });

  it('restricts everything when nothing is allowed', () => {
    expect([...bedtimeRestrictedSections([])].sort()).toEqual([...BEDTIME_SECTIONS].sort());
  });

  it('restricts home and audiobooks when only tv and movies are allowed', () => {
    expect([...bedtimeRestrictedSections(['tv', 'movie'])].sort()).toEqual(['(home)', 'audiobooks', 'personal']);
  });
});

describe('firstAllowedSection', () => {
  it('returns the first section in drawer order that is not restricted', () => {
    expect(firstAllowedSection(new Set())).toBe('(home)');
    expect(firstAllowedSection(bedtimeRestrictedSections(['audiobook']))).toBe('audiobooks');
    expect(firstAllowedSection(bedtimeRestrictedSections(['movie']))).toBe('movies');
    expect(firstAllowedSection(bedtimeRestrictedSections(['personal']))).toBe('personal');
  });

  it('returns null when everything is restricted', () => {
    expect(firstAllowedSection(new Set<BedtimeSection>(BEDTIME_SECTIONS))).toBeNull();
  });
});

describe('defaultPageSection', () => {
  it("maps 'home' to the '(home)' route and the others to themselves", () => {
    expect(defaultPageSection('home')).toBe('(home)');
    expect(defaultPageSection('tv')).toBe('tv');
    expect(defaultPageSection('movies')).toBe('movies');
    expect(defaultPageSection('audiobooks')).toBe('audiobooks');
    expect(defaultPageSection('personal')).toBe('personal');
  });

  it('falls back to home for an unknown value', () => {
    expect(defaultPageSection('podcasts' as defaultPages)).toBe('(home)');
  });
});

describe('initialSection', () => {
  it("opens the default page's section when it is allowed", () => {
    expect(initialSection('home', new Set())).toBe('(home)');
    expect(initialSection('movies', new Set())).toBe('movies');
    expect(initialSection('tv', bedtimeRestrictedSections(['tv', 'movie']))).toBe('tv');
    expect(initialSection('personal', bedtimeRestrictedSections(['personal']))).toBe('personal');
  });

  it('falls back to the first allowed section when the default is restricted', () => {
    expect(initialSection('home', bedtimeRestrictedSections(['audiobook']))).toBe('audiobooks');
    expect(initialSection('tv', bedtimeRestrictedSections(['movie']))).toBe('movies');
    expect(initialSection('personal', bedtimeRestrictedSections(['audiobook']))).toBe('audiobooks');
  });

  it("returns the default's section when nothing is allowed", () => {
    expect(initialSection('movies', new Set<BedtimeSection>(BEDTIME_SECTIONS))).toBe('movies');
  });
});

// 2026-01-05 is a Monday; `day` is Date#getDay() (0 = Sunday).
const onDay = (day: number, h: number, m = 0) => new Date(2026, 0, 4 + day, h, m);
const slot = (days: number[], start: string, end: string): BedtimeSlot => ({ days, start, end });

describe('bedtime day constants', () => {
  it('exposes consistent day tables', () => {
    expect(ALL_BEDTIME_DAYS).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect([...BEDTIME_DAY_ORDER].sort()).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(BEDTIME_DAY_ORDER[0]).toBe(1);
    expect(BEDTIME_DAY_SHORT_LABELS[0]).toBe('Sun');
    expect(BEDTIME_DAY_SHORT_LABELS[1]).toBe('Mon');
    expect(DEFAULT_BEDTIME_SLOT).toEqual({ days: [0, 1, 2, 3, 4, 5, 6], start: '19:00', end: '07:00' });
  });
});

describe('activeBedtimeSlot', () => {
  const monWed = slot([1, 2, 3], '19:00', '07:00');

  it('handles a same-day slot only on its days', () => {
    const s = slot([1], '13:00', '15:00');
    expect(activeBedtimeSlot(onDay(1, 13, 0), [s])).toBe(s);
    expect(activeBedtimeSlot(onDay(1, 14, 59), [s])).toBe(s);
    expect(activeBedtimeSlot(onDay(1, 15, 0), [s])).toBeNull();
    expect(activeBedtimeSlot(onDay(1, 12, 59), [s])).toBeNull();
    expect(activeBedtimeSlot(onDay(2, 14, 0), [s])).toBeNull();
  });

  it('starts an overnight slot on its days in the evening', () => {
    expect(activeBedtimeSlot(onDay(1, 19, 0), [monWed])).toBe(monWed);
    expect(activeBedtimeSlot(onDay(1, 18, 59), [monWed])).toBeNull();
    expect(activeBedtimeSlot(onDay(3, 23, 30), [monWed])).toBe(monWed);
    expect(activeBedtimeSlot(onDay(4, 19, 30), [monWed])).toBeNull();
  });

  it('lets an overnight slot run into the morning after its last day', () => {
    expect(activeBedtimeSlot(onDay(3, 6, 0), [monWed])).toBe(monWed); // Tue night tail
    expect(activeBedtimeSlot(onDay(4, 6, 59), [monWed])).toBe(monWed); // Wed night tail
    expect(activeBedtimeSlot(onDay(4, 7, 0), [monWed])).toBeNull();
    expect(activeBedtimeSlot(onDay(5, 6, 0), [monWed])).toBeNull(); // Thu night not in the slot
  });

  it('does not treat the morning of the first day as part of the slot', () => {
    expect(activeBedtimeSlot(onDay(1, 6, 0), [monWed])).toBeNull(); // Sun night not in the slot
  });

  it('wraps from Saturday into Sunday and from Sunday into Monday', () => {
    const sat = slot([6], '21:00', '07:00');
    expect(activeBedtimeSlot(onDay(6, 21, 0), [sat])).toBe(sat);
    expect(activeBedtimeSlot(onDay(0, 6, 0), [sat])).toBe(sat);
    expect(activeBedtimeSlot(onDay(0, 21, 0), [sat])).toBeNull();
    const sun = slot([0], '21:00', '07:00');
    expect(activeBedtimeSlot(onDay(0, 22, 0), [sun])).toBe(sun);
    expect(activeBedtimeSlot(onDay(1, 6, 0), [sun])).toBe(sun);
    expect(activeBedtimeSlot(onDay(6, 6, 0), [sun])).toBeNull();
  });

  it('supports the three-slot example from the issue', () => {
    const monWedSlot = slot([1, 2, 3], '19:00', '07:00');
    const thuFri = slot([4, 5], '20:00', '07:00');
    const satSun = slot([6, 0], '21:00', '07:00');
    const all = [monWedSlot, thuFri, satSun];
    expect(activeBedtimeSlot(onDay(2, 19, 30), all)).toBe(monWedSlot);
    expect(activeBedtimeSlot(onDay(4, 19, 30), all)).toBeNull(); // Thu before 20:00
    expect(activeBedtimeSlot(onDay(4, 20, 0), all)).toBe(thuFri);
    expect(activeBedtimeSlot(onDay(5, 6, 30), all)).toBe(thuFri);
    expect(activeBedtimeSlot(onDay(5, 12, 0), all)).toBeNull();
    expect(activeBedtimeSlot(onDay(6, 6, 30), all)).toBe(thuFri); // Fri night tail
    expect(activeBedtimeSlot(onDay(6, 20, 30), all)).toBeNull(); // Sat before 21:00
    expect(activeBedtimeSlot(onDay(6, 21, 0), all)).toBe(satSun);
    expect(activeBedtimeSlot(onDay(0, 6, 59), all)).toBe(satSun);
    expect(activeBedtimeSlot(onDay(0, 21, 30), all)).toBe(satSun);
    expect(activeBedtimeSlot(onDay(1, 6, 0), all)).toBe(satSun); // Sun night tail
    expect(activeBedtimeSlot(onDay(1, 7, 0), all)).toBeNull();
  });

  it('is never active for start === end, malformed times or no days', () => {
    expect(activeBedtimeSlot(onDay(1, 12, 0), [slot([0, 1, 2, 3, 4, 5, 6], '19:00', '19:00')])).toBeNull();
    expect(activeBedtimeSlot(onDay(1, 20, 0), [slot([1], 'abc', '07:00')])).toBeNull();
    expect(activeBedtimeSlot(onDay(1, 20, 0), [slot([1], '19:00', '')])).toBeNull();
    expect(activeBedtimeSlot(onDay(1, 20, 0), [slot([], '19:00', '07:00')])).toBeNull();
    expect(activeBedtimeSlot(onDay(1, 20, 0), [])).toBeNull();
  });

  it('returns the first matching slot in list order', () => {
    const a = slot([1], '19:00', '07:00');
    const b = slot([1], '18:00', '09:00');
    expect(activeBedtimeSlot(onDay(1, 20, 0), [a, b])).toBe(a);
    expect(activeBedtimeSlot(onDay(1, 20, 0), [b, a])).toBe(b);
    expect(activeBedtimeSlot(onDay(1, 18, 30), [a, b])).toBe(b);
  });
});

describe('formatBedtimeDays', () => {
  it('collapses runs of three or more into a range', () => {
    expect(formatBedtimeDays([1, 2, 3])).toBe('Mon–Wed');
    expect(formatBedtimeDays([1, 2, 3, 4, 5])).toBe('Mon–Fri');
    expect(formatBedtimeDays([1, 2, 3, 4, 5, 6])).toBe('Mon–Sat');
  });

  it('lists runs of one or two days', () => {
    expect(formatBedtimeDays([4, 5])).toBe('Thu, Fri');
    expect(formatBedtimeDays([6, 0])).toBe('Sat, Sun');
    expect(formatBedtimeDays([3])).toBe('Wed');
  });

  it('mixes ranges and singles, Monday first', () => {
    expect(formatBedtimeDays([0, 1, 2, 3, 4, 5])).toBe('Mon–Fri, Sun');
    expect(formatBedtimeDays([0, 2, 4])).toBe('Tue, Thu, Sun');
    expect(formatBedtimeDays([5, 4, 3, 1])).toBe('Mon, Wed–Fri');
  });

  it('handles every day and no days', () => {
    expect(formatBedtimeDays([0, 1, 2, 3, 4, 5, 6])).toBe('Every day');
    expect(formatBedtimeDays([])).toBe('No days');
  });
});

describe('sanitizeBedtimeSlots', () => {
  it('keeps valid slots and normalises times and days', () => {
    expect(sanitizeBedtimeSlots([{ days: [3, 1, 2, 2], start: '7:00', end: '19:30' }])).toEqual([
      { days: [1, 2, 3], start: '07:00', end: '19:30' },
    ]);
  });

  it('drops invalid entries and invalid days', () => {
    expect(
      sanitizeBedtimeSlots([
        null,
        'x',
        7,
        { days: [1], start: '25:00', end: '07:00' },
        { days: [1], start: '19:00' },
        { days: [1], start: 1900, end: '07:00' },
        { start: '19:00', end: '07:00' },
        { days: 'mon', start: '19:00', end: '07:00' },
        { days: [], start: '19:00', end: '07:00' },
        { days: [7, -1, 1.5, '2', null], start: '19:00', end: '07:00' },
        { days: [0, 9, 6], start: '20:00', end: '06:00' },
      ]),
    ).toEqual([{ days: [0, 6], start: '20:00', end: '06:00' }]);
  });

  it('returns null when the input is not an array or nothing valid remains', () => {
    expect(sanitizeBedtimeSlots(undefined)).toBeNull();
    expect(sanitizeBedtimeSlots({ days: [1], start: '19:00', end: '07:00' })).toBeNull();
    expect(sanitizeBedtimeSlots('x')).toBeNull();
    expect(sanitizeBedtimeSlots([])).toBeNull();
    expect(sanitizeBedtimeSlots([{ days: [], start: '19:00', end: '07:00' }])).toBeNull();
  });
});
