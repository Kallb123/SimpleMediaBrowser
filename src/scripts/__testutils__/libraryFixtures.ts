import type { PersistedLibrary } from '@/scripts/LibraryStore';

// Test-only fixtures shared by the LibraryStore suites.

export const show = (title: string, extra: object = {}): any => ({
  ids: { tvdb: null, imdb: null, tmdb: null },
  title,
  year: 2020,
  poster: '',
  seasons: { '1': { episodes: { '1': { path: `content://x/${title}/1.mkv` } } } },
  ...extra,
});

export const makeLibrary = (): PersistedLibrary => ({
  mediaLibrary: {
    'Bluey': show('Bluey'),
    'AC/DC: Live': show('AC/DC: Live'),
    'Amélie 日本語': show('Amélie 日本語'),
    'Party 🎉🍿': show('Party 🎉🍿'),
  },
  movies: [{ name: 'Movie A', path: 'content://m/a.mkv' } as any],
  audiobooks: [{ title: 'Book', folderKey: 'book', path: 'p', files: [], poster: '' } as any],
  mediaOverrides: { 'show:Bluey': { title: 'Bluey!' } },
  thumbnails: { 'content://m/a.mkv': 'file:///t/a.jpg' },
  watched: { 'm/a.mkv': 1700000000000 },
  listenProgress: { book: { partPath: 'book/1.mp3', position: 12.5, duration: 600, updatedAt: 1700000000000 } },
});

/** Minimal stand-in for a Redux store holding a PersistedLibrary. */
export function makeSource(initial: PersistedLibrary) {
  let state = initial;
  const listeners = new Set<() => void>();
  return {
    getState: () => state,
    subscribe: (l: () => void) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    set(next: PersistedLibrary) {
      state = next;
      listeners.forEach(l => l());
    },
    get state() {
      return state;
    },
  };
}
