import { Alert } from 'react-native';
import { logger } from '@/scripts/Logger';
import { LibraryStore, pickPersistedLibrary } from '@/scripts/LibraryStore';
import type { PersistedLibrary } from '@/scripts/LibraryStore';
import {
  allowPersistWrites,
  didPersistRehydrateFail,
  store,
  takeLegacyPersistedLibrary,
  waitForPersistBootstrap,
} from './store';
import { hydrateLibrary } from './libraryReducer';

const TAG = 'LibraryPersistence';

let started: Promise<void> | undefined;

/**
 * Loads the library from the file store into Redux and starts autosaving it,
 * migrating it out of the legacy `persist:root` blob on the first launch after
 * upgrading. Runs once per JS runtime (the promise is memoised) and never
 * rejects, so callers can await it before routing.
 *
 * Hydration always happens before autosave starts, so the autosave baseline is
 * the loaded library rather than the empty initial state. Settings writes to
 * `persist:root` stay gated (see store.ts) until the library is safely stored.
 */
export function startLibraryPersistence(): Promise<void> {
  started ??= run().catch((e) => {
    logger.error(TAG, 'Unexpected failure starting library persistence', e);
  });
  return started;
}

async function run(): Promise<void> {
  const t0 = Date.now();
  await waitForPersistBootstrap();

  // When settings could not be read, store.ts has already blocked writes to
  // `persist:root` for this session. The file store doesn't depend on it, so an
  // existing library still loads and autosaves; only the migration is skipped
  // (see below), since persist:root may still hold the only copy of the legacy library.
  const settingsFailed = didPersistRehydrateFail();
  if (settingsFailed) {
    logger.error(TAG, 'Settings failed to load; settings will not be saved this session');
    Alert.alert(
      'Could not load your settings',
      'Your saved settings could not be read, so settings changes will not be saved this session. Restart the app to try again.',
    );
  }

  const libraryStore = LibraryStore.getInstance();
  let stored: PersistedLibrary | null;
  try {
    stored = await libraryStore.load();
  } catch (e) {
    // The store exists but can't be read (corruption / newer version). Don't
    // hydrate or autosave, otherwise the next save would overwrite what's there.
    // Settings writes are safe: a manifest existing means migration already ran.
    takeLegacyPersistedLibrary();
    logger.error(TAG, `Library store could not be loaded after ${Date.now() - t0}ms; library will not be saved this session`, e);
    Alert.alert(
      'Could not load your library',
      'Your saved library could not be read. It will not be saved this session so nothing is overwritten.',
    );
    allowPersistWrites();
    return;
  }

  if (stored !== null) {
    // Already migrated in an earlier session, so any blob left in persist:root is stale.
    takeLegacyPersistedLibrary();
    store.dispatch(hydrateLibrary(stored));
    startAutoSave(libraryStore);
    allowPersistWrites();
    logger.log(TAG, `Loaded library from file store in ${Date.now() - t0}ms (${summary(stored)})`);
    return;
  }

  if (settingsFailed) {
    // Initialising the file store now would mark the migration as done with an
    // empty library while the real one may still be in the unreadable persist:root.
    logger.warn(TAG, 'No library store yet; skipping migration until settings can be read');
    return;
  }

  // Fresh install, or first launch after upgrading from the persist:root library.
  const legacy = takeLegacyPersistedLibrary();
  const lib = pickPersistedLibrary(legacy as Parameters<typeof pickPersistedLibrary>[0]);
  try {
    await libraryStore.writeAll(lib);
  } catch (e) {
    // Show the library this session, but keep it in persist:root (writes stay
    // gated) so the migration is retried on the next launch.
    store.dispatch(hydrateLibrary(lib));
    logger.error(TAG, `Failed to write library store after ${Date.now() - t0}ms; keeping legacy data in persist:root and retrying next launch`, e);
    return;
  }
  store.dispatch(hydrateLibrary(lib));
  startAutoSave(libraryStore);
  allowPersistWrites();
  const elapsed = Date.now() - t0;
  if (legacy === undefined) {
    logger.log(TAG, `Initialised empty library store in ${elapsed}ms`);
  } else {
    logger.log(TAG, `Migrated ${summary(lib)} from persist:root in ${elapsed}ms`);
  }
}

function startAutoSave(libraryStore: LibraryStore): void {
  libraryStore.startAutoSave({
    getState: () => pickPersistedLibrary({ ...store.getState().libraryReducer }),
    subscribe: store.subscribe,
  });
}

function summary(lib: PersistedLibrary): string {
  return `${Object.keys(lib.mediaLibrary).length} shows / ${lib.movies.length} movies / ${lib.audiobooks.length} audiobooks`;
}
