import { audiobookProgressFraction, partProgressFraction, resolveStartPoint } from '@/scripts/audiobookProgress';
import type { IListenProgress, IMediaAudiobook } from '@/store/libraryReducer';

const makeBook = (filenames: string[] = ['1.mp3', '2.mp3', '3.mp3', '4.mp3']): IMediaAudiobook => ({
  ids: { itunes: null },
  title: 'Book',
  folderKey: 'book',
  path: `content://x/${filenames[0]}`,
  files: filenames.map((filename) => ({ path: `content://x/${filename}`, parsedPath: `x/${filename}`, filename })),
  poster: '',
});

const progress = (part: string, position: number, duration = 100): IListenProgress => ({
  partPath: `x/${part}`,
  position,
  duration,
  updatedAt: 1,
});

describe('resolveStartPoint', () => {
  const book = makeBook();

  it('starts the book when there is no progress', () => {
    expect(resolveStartPoint(book, undefined)).toEqual({ partIndex: 0, position: 0 });
  });

  it('resumes the saved part and position when no part is requested', () => {
    expect(resolveStartPoint(book, progress('3.mp3', 42.5))).toEqual({ partIndex: 2, position: 42.5 });
  });

  it('resumes the requested part when it is the saved part', () => {
    expect(resolveStartPoint(book, progress('3.mp3', 42.5), 2)).toEqual({ partIndex: 2, position: 42.5 });
  });

  it('starts a requested part from 0 when another part is saved', () => {
    expect(resolveStartPoint(book, progress('3.mp3', 42.5), 0)).toEqual({ partIndex: 0, position: 0 });
  });

  it('starts a requested part from 0 when there is no progress', () => {
    expect(resolveStartPoint(book, undefined, 1)).toEqual({ partIndex: 1, position: 0 });
  });

  it('starts the book when the saved part is no longer among the parts (rescan)', () => {
    expect(resolveStartPoint(book, progress('gone.mp3', 42.5))).toEqual({ partIndex: 0, position: 0 });
  });

  it('starts the requested part at 0 when the saved part is gone', () => {
    expect(resolveStartPoint(book, progress('gone.mp3', 42.5), 3)).toEqual({ partIndex: 3, position: 0 });
  });

  it('ignores a requested index outside the parts', () => {
    expect(resolveStartPoint(book, progress('2.mp3', 10), 9)).toEqual({ partIndex: 1, position: 10 });
    expect(resolveStartPoint(book, undefined, -1)).toEqual({ partIndex: 0, position: 0 });
  });

  it('indexes parts the way audioPartFiles does, skipping non-audio files', () => {
    const mixed = makeBook(['cover.jpg', '1.mp3', '2.mp3']);
    expect(resolveStartPoint(mixed, progress('2.mp3', 5))).toEqual({ partIndex: 1, position: 5 });
    expect(resolveStartPoint(mixed, undefined, 0)).toEqual({ partIndex: 0, position: 0 });
  });

  it('restarts a part whose saved position is not usable', () => {
    expect(resolveStartPoint(book, progress('2.mp3', -3))).toEqual({ partIndex: 1, position: 0 });
    expect(resolveStartPoint(book, progress('2.mp3', NaN))).toEqual({ partIndex: 1, position: 0 });
    expect(resolveStartPoint(book, progress('2.mp3', 100, 100))).toEqual({ partIndex: 1, position: 0 });
  });

  it('keeps a saved position when the part length is unknown', () => {
    expect(resolveStartPoint(book, progress('2.mp3', 30, 0))).toEqual({ partIndex: 1, position: 30 });
  });

  it('copes with a book that has no audio parts', () => {
    expect(resolveStartPoint(makeBook([]), progress('1.mp3', 5))).toEqual({ partIndex: 0, position: 0 });
    expect(resolveStartPoint(makeBook([]), undefined, 2)).toEqual({ partIndex: 0, position: 0 });
  });
});

describe('audiobookProgressFraction', () => {
  const book = makeBook(); // 4 parts

  it('is undefined without progress', () => {
    expect(audiobookProgressFraction(book, undefined)).toBeUndefined();
  });

  it('is undefined when the saved part is not among the parts', () => {
    expect(audiobookProgressFraction(book, progress('gone.mp3', 5))).toBeUndefined();
  });

  it('is undefined for a book with no audio parts', () => {
    expect(audiobookProgressFraction(makeBook(['cover.jpg']), progress('cover.jpg', 5))).toBeUndefined();
  });

  it('counts earlier parts as complete plus the saved part fraction', () => {
    // part index 2 of 4, halfway through: (2 + 0.5) / 4
    expect(audiobookProgressFraction(book, progress('3.mp3', 50, 100))).toBeCloseTo(0.625);
  });

  it('is 0 at the very start', () => {
    expect(audiobookProgressFraction(book, progress('1.mp3', 0))).toBe(0);
  });

  it('treats an unknown part duration as 0 progress within the part', () => {
    expect(audiobookProgressFraction(book, progress('2.mp3', 30, 0))).toBeCloseTo(0.25);
  });

  it('clamps a position past the end of the part', () => {
    expect(audiobookProgressFraction(book, progress('4.mp3', 250, 100))).toBe(1);
  });

  it('works for a single-file book', () => {
    expect(audiobookProgressFraction(makeBook(['only.m4b']), progress('only.m4b', 25, 100))).toBeCloseTo(0.25);
  });
});

describe('partProgressFraction', () => {
  it('is the part fraction for the saved part only', () => {
    const p = progress('2.mp3', 25, 100);
    expect(partProgressFraction(p, 'x/2.mp3')).toBeCloseTo(0.25);
    expect(partProgressFraction(p, 'x/1.mp3')).toBeUndefined();
    expect(partProgressFraction(undefined, 'x/2.mp3')).toBeUndefined();
  });

  it('is 0 when the part length is unknown and clamped to 1 past the end', () => {
    expect(partProgressFraction(progress('2.mp3', 25, 0), 'x/2.mp3')).toBe(0);
    expect(partProgressFraction(progress('2.mp3', 250, 100), 'x/2.mp3')).toBe(1);
  });
});
