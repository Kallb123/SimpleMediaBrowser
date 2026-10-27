/**
 * Pure helpers for "Bedtime mode": during configured hours only some libraries
 * are reachable from the drawer. No runtime imports, so it is safe to use from
 * anywhere and trivially unit-testable.
 */
import type { BedtimeSlot, contentTypes, defaultPages } from '@/store/settingsReducer';

/** Drawer route names of the media sections, in drawer order. */
export type BedtimeSection = '(home)' | 'tv' | 'movies' | 'audiobooks' | 'personal';
export const BEDTIME_SECTIONS: readonly BedtimeSection[] = ['(home)', 'tv', 'movies', 'audiobooks', 'personal'];

/** Section -> the content type it shows ('(home)' shows tv/movie/audiobook, so it is handled separately). */
const SECTION_CONTENT_TYPE = {
  tv: 'tv',
  movies: 'movie',
  audiobooks: 'audiobook',
  personal: 'personal',
} as const satisfies Record<Exclude<BedtimeSection, '(home)'>, contentTypes>;

/** The sections whose content '(home)' combines; Personal is deliberately not among them. */
const HOME_CONTENT_SECTIONS: readonly BedtimeSection[] = ['tv', 'movies', 'audiobooks'];

const TIME_RE = /^(\d{1,2}):(\d{2})$/;

/**
 * Parses "HH:MM" (24h, 00:00-23:59) to minutes since midnight; null if malformed.
 * A single-digit hour ("7:00") is accepted leniently; formatTimeOfDay normalises it.
 */
export function parseTimeOfDay(value: string): number | null {
  const m = TIME_RE.exec(value.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

/** Formats minutes since midnight back to zero-padded "HH:MM". */
export function formatTimeOfDay(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/**
 * True when `now`'s local time falls in [start, end). Windows that cross midnight
 * (start > end, e.g. 19:00-07:00) wrap. start === end, or either malformed, → false.
 */
export function isWithinBedtime(now: Date, start: string, end: string): boolean {
  const s = parseTimeOfDay(start);
  const e = parseTimeOfDay(end);
  if (s === null || e === null || s === e) return false;
  const cur = now.getHours() * 60 + now.getMinutes();
  return s < e ? cur >= s && cur < e : cur >= s || cur < e;
}

/** Weekday numbers as returned by Date#getDay(): 0 = Sunday … 6 = Saturday. */
export const ALL_BEDTIME_DAYS: readonly number[] = [0, 1, 2, 3, 4, 5, 6];
/** Display order for day pickers/labels: Monday first. */
export const BEDTIME_DAY_ORDER: readonly number[] = [1, 2, 3, 4, 5, 6, 0];
/** Short day names, indexed by Date#getDay(). */
export const BEDTIME_DAY_SHORT_LABELS: readonly string[] = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
/** The out-of-the-box bedtime: every day, 19:00 to 07:00. */
export const DEFAULT_BEDTIME_SLOT: BedtimeSlot = Object.freeze({ days: [0, 1, 2, 3, 4, 5, 6], start: '19:00', end: '07:00' });

/**
 * The first slot (list order) whose window contains `now`, or null. A slot belongs to the day its
 * window starts on, so an overnight slot for Monday covers Mon start → Tue end: it is active when
 * today is in `days` and the time is at/after start, or yesterday is in `days` and the time is
 * before end. start === end, or either time malformed, → never active.
 */
export function activeBedtimeSlot(now: Date, slots: readonly BedtimeSlot[]): BedtimeSlot | null {
  const today = now.getDay();
  const yesterday = (today + 6) % 7;
  const cur = now.getHours() * 60 + now.getMinutes();
  for (const slot of slots) {
    const s = parseTimeOfDay(slot.start);
    const e = parseTimeOfDay(slot.end);
    if (s === null || e === null || s === e) continue;
    const active = s < e
      ? slot.days.includes(today) && cur >= s && cur < e
      : (slot.days.includes(today) && cur >= s) || (slot.days.includes(yesterday) && cur < e);
    if (active) return slot;
  }
  return null;
}

/**
 * Human label for a set of weekdays, Monday first: "Mon–Wed", "Thu, Fri", "Mon–Fri, Sun",
 * "Every day", or "No days". Runs of 3+ consecutive days collapse to "A–B"; shorter runs list each day.
 */
export function formatBedtimeDays(days: readonly number[]): string {
  const selected = BEDTIME_DAY_ORDER.filter((d) => days.includes(d));
  if (selected.length === 0) return 'No days';
  if (selected.length === 7) return 'Every day';
  const label = (d: number) => BEDTIME_DAY_SHORT_LABELS[d];
  const parts: string[] = [];
  let i = 0;
  while (i < BEDTIME_DAY_ORDER.length) {
    if (!selected.includes(BEDTIME_DAY_ORDER[i])) {
      i++;
      continue;
    }
    let j = i;
    while (j + 1 < BEDTIME_DAY_ORDER.length && selected.includes(BEDTIME_DAY_ORDER[j + 1])) j++;
    if (j - i >= 2) parts.push(`${label(BEDTIME_DAY_ORDER[i])}–${label(BEDTIME_DAY_ORDER[j])}`);
    else for (let k = i; k <= j; k++) parts.push(label(BEDTIME_DAY_ORDER[k]));
    i = j + 1;
  }
  return parts.join(', ');
}

/**
 * Validates untrusted input (e.g. an import file) into slots: keeps entries that are objects with a
 * valid start and end, normalises the times, keeps only integer days 0..6 (sorted, de-duplicated),
 * and drops entries left with no days. Null if `raw` isn't an array or nothing valid remains.
 */
export function sanitizeBedtimeSlots(raw: unknown): BedtimeSlot[] | null {
  if (!Array.isArray(raw)) return null;
  const slots: BedtimeSlot[] = [];
  for (const entry of raw as unknown[]) {
    if (typeof entry !== 'object' || entry === null) continue;
    const { days, start, end } = entry as Record<string, unknown>;
    const s = typeof start === 'string' ? parseTimeOfDay(start) : null;
    const e = typeof end === 'string' ? parseTimeOfDay(end) : null;
    if (s === null || e === null || !Array.isArray(days)) continue;
    const validDays = [...new Set((days as unknown[]).filter((d): d is number => Number.isInteger(d) && (d as number) >= 0 && (d as number) <= 6))].sort((a, b) => a - b);
    if (validDays.length === 0) continue;
    slots.push({ days: validDays, start: formatTimeOfDay(s), end: formatTimeOfDay(e) });
  }
  return slots.length > 0 ? slots : null;
}

/**
 * Sections locked while bedtime is in effect. tv→'tv', movies→'movie', audiobooks→'audiobook',
 * personal→'personal' are restricted when their content type is not in `allowedTypes`. '(home)'
 * shows the tv, movie and audiobook libraries (never Personal), so it is restricted whenever ANY
 * of those three types is not allowed.
 */
export function bedtimeRestrictedSections(allowedTypes: readonly contentTypes[]): Set<BedtimeSection> {
  const restricted = new Set<BedtimeSection>();
  for (const [section, type] of Object.entries(SECTION_CONTENT_TYPE) as [keyof typeof SECTION_CONTENT_TYPE, contentTypes][]) {
    if (!allowedTypes.includes(type)) restricted.add(section);
  }
  if (HOME_CONTENT_SECTIONS.some((section) => restricted.has(section))) restricted.add('(home)');
  return restricted;
}

/** First section (in BEDTIME_SECTIONS order) not in `restricted`, or null if all are restricted. */
export function firstAllowedSection(restricted: ReadonlySet<BedtimeSection>): BedtimeSection | null {
  return BEDTIME_SECTIONS.find((s) => !restricted.has(s)) ?? null;
}

/** The drawer section a "default page" setting opens ('home' is the '(home)' route; unknown values fall back to it). */
export function defaultPageSection(page: defaultPages): BedtimeSection {
  return page === 'tv' || page === 'movies' || page === 'audiobooks' || page === 'personal' ? page : '(home)';
}

/**
 * The section the drawer opens on: the default page's section unless bedtime restricts it,
 * else the first allowed section. Falls back to the default's section only when nothing is
 * allowed (callers avoid that case by never restricting every section).
 */
export function initialSection(page: defaultPages, restricted: ReadonlySet<BedtimeSection>): BedtimeSection {
  const preferred = defaultPageSection(page);
  if (!restricted.has(preferred)) return preferred;
  return firstAllowedSection(restricted) ?? preferred;
}
