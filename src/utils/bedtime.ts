/**
 * Pure helpers for "Bedtime mode": during configured hours only some libraries
 * are reachable from the drawer. No runtime imports, so it is safe to use from
 * anywhere and trivially unit-testable.
 */
import type { contentTypes, defaultPages } from '@/store/settingsReducer';

/** Drawer route names of the media sections, in drawer order. */
export type BedtimeSection = '(home)' | 'tv' | 'movies' | 'audiobooks';
export const BEDTIME_SECTIONS: readonly BedtimeSection[] = ['(home)', 'tv', 'movies', 'audiobooks'];

/** Section -> the content type it shows ('(home)' shows all, so it is handled separately). */
const SECTION_CONTENT_TYPE = {
  tv: 'tv',
  movies: 'movie',
  audiobooks: 'audiobook',
} as const satisfies Record<Exclude<BedtimeSection, '(home)'>, contentTypes>;

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

/**
 * Sections locked while bedtime is in effect. tv→'tv', movies→'movie', audiobooks→'audiobook'
 * are restricted when their content type is not in `allowedTypes`. '(home)' shows every
 * library, so it is restricted whenever ANY of the three types is not allowed.
 */
export function bedtimeRestrictedSections(allowedTypes: readonly contentTypes[]): Set<BedtimeSection> {
  const restricted = new Set<BedtimeSection>();
  for (const [section, type] of Object.entries(SECTION_CONTENT_TYPE) as [keyof typeof SECTION_CONTENT_TYPE, contentTypes][]) {
    if (!allowedTypes.includes(type)) restricted.add(section);
  }
  if (restricted.size > 0) restricted.add('(home)');
  return restricted;
}

/** First section (in BEDTIME_SECTIONS order) not in `restricted`, or null if all are restricted. */
export function firstAllowedSection(restricted: ReadonlySet<BedtimeSection>): BedtimeSection | null {
  return BEDTIME_SECTIONS.find((s) => !restricted.has(s)) ?? null;
}

/** The drawer section a "default page" setting opens ('home' is the '(home)' route; unknown values fall back to it). */
export function defaultPageSection(page: defaultPages): BedtimeSection {
  return page === 'tv' || page === 'movies' || page === 'audiobooks' ? page : '(home)';
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
