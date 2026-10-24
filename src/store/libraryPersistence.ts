import { Alert } from 'react-native';
import { logger } from '@/scripts/Logger';
import { LibraryStore, pickPersistedLibrary } from '@/scripts/LibraryStore';
import type { PersistedLibrary } from '@/scripts/LibraryStore';
import { hydrateLibrary } from './libraryReducer';

const TAG = 'LibraryPersistence';

/** Everything {@link runLibraryPersistence} touches, so tests can drive it with plain fakes. */
export interface LibraryPersistenceDeps {
  /** Resolves once redux-persist has finished (or failed) rehydrating settings. */
  waitForBootstrap(): Promise<void>;
  /** True when the settings rehydrate failed (settings writes are then blocked). */
  didRehydrateFail(): boolean;
  /** Takes (and clears) the legacy `libraryReducer` blob found in `persist:root`. */
  takeLegacy(): unknown;
  /** Lets redux-persist write settings to `persist:root`. */
  allowWrites(): void;
  libraryStore: Pick<LibraryStore, 'load' | 'writeAll' | 'startAutoSave'>;
  dispatch(action: ReturnType<typeof hydrateLibrary>): void;
  /** The `libraryReducer` slice state. */
  getLibraryState(): object;
  subscribe(listener: () => void): () => void;
  alert(title: string, message: string): void;
}

let started: Promise<void> | undefined;

/**
 * Loads the library from the SQLite library store into Redux and starts autosaving it,
 * migrating it out of the legacy `persist:root` blob on the first launch after
 * upgrading. Runs once per JS runtime (the promise is memoised) and never
 * rejects, so callers can await it before routing.
 *
 * Hydration always happens before autosave starts, so the autosave baseline is
 * the loaded library rather than the empty initial state. Settings writes to
 * `persist:root` stay gated (see persistGuards.ts) until the library is safely stored.
 */
export function startLibraryPersistence(): Promise<void> {
  started ??= Promise.resolve()
    .then(() => runLibraryPersistence(buildDeps()))
    .catch((e) => {
      logger.error(TAG, 'Unexpected failure starting library persistence', e);
    });
  return started;
}

// store.ts is required lazily so that importing this module (e.g. from a test of
// runLibraryPersistence) doesn't create the real store.
function buildDeps(): LibraryPersistenceDeps {
  const { store, allowPersistWrites, didPersistRehydrateFail, takeLegacyPersistedLibrary, waitForPersistBootstrap }: typeof import('./store') =
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require('./store');
  return {
    waitForBootstrap: waitForPersistBootstrap,
    didRehydrateFail: didPersistRehydrateFail,
    takeLegacy: takeLegacyPersistedLibrary,
    allowWrites: allowPersistWrites,
    libraryStore: LibraryStore.getInstance(),
    dispatch: store.dispatch,
    getLibraryState: () => store.getState().libraryReducer,
    subscribe: store.subscribe,
    alert: (title, message) => Alert.alert(title, message),
  };
}

export async function runLibraryPersistence(deps: LibraryPersistenceDeps): Promise<void> {
  const t0 = Date.now();
  await deps.waitForBootstrap();

  // When settings could not be read, store.ts has already blocked writes to
  // `persist:root` for this session. The SQLite store doesn't depend on it, so an
  // existing library still loads and autosaves; only the migration is skipped
  // (see below), since persist:root may still hold the only copy of the legacy library.
  const settingsFailed = deps.didRehydrateFail();
  if (settingsFailed) {
    logger.error(TAG, 'Settings failed to load; settings will not be saved this session');
    deps.alert(
      'Could not load your settings',
      'Your saved settings could not be read, so settings changes will not be saved this session. Restart the app to try again.',
    );
  }

  const { libraryStore } = deps;
  let stored: PersistedLibrary | null;
  try {
    stored = await libraryStore.load();
  } catch (e) {
    // The store exists but can't be read (corruption / newer version). Don't
    // hydrate or autosave, otherwise the next save would overwrite what's there.
    // Settings writes are safe: the store being initialised means migration already ran.
    deps.takeLegacy();
    logger.error(TAG, `Library store could not be loaded after ${Date.now() - t0}ms; library will not be saved this session`, e);
    deps.alert(
      'Could not load your library',
      'Your saved library could not be read. It will not be saved this session so nothing is overwritten.',
    );
    deps.allowWrites();
    return;
  }

  if (stored !== null) {
    // Already migrated in an earlier session, so any blob left in persist:root is stale.
    deps.takeLegacy();
    deps.dispatch(hydrateLibrary(stored));
    startAutoSave(deps);
    deps.allowWrites();
    logger.log(TAG, `Loaded library from SQLite store in ${Date.now() - t0}ms (${summary(stored)})`);
    return;
  }

  if (settingsFailed) {
    // Initialising the SQLite store now would mark the migration as done with an
    // empty library while the real one may still be in the unreadable persist:root.
    logger.warn(TAG, 'No library store yet; skipping migration until settings can be read');
    return;
  }

  // Fresh install, or first launch after upgrading from the persist:root library.
  const legacy = deps.takeLegacy();
  const lib = pickPersistedLibrary(legacy as Parameters<typeof pickPersistedLibrary>[0]);
  try {
    await libraryStore.writeAll(lib);
  } catch (e) {
    // Show the library this session, but keep it in persist:root (writes stay
    // gated) so the migration is retried on the next launch.
    deps.dispatch(hydrateLibrary(lib));
    logger.error(TAG, `Failed to write library store after ${Date.now() - t0}ms; keeping legacy data in persist:root and retrying next launch`, e);
    return;
  }
  deps.dispatch(hydrateLibrary(lib));
  startAutoSave(deps);
  deps.allowWrites();
  const elapsed = Date.now() - t0;
  if (legacy === undefined) {
    logger.log(TAG, `Initialised empty library store in ${elapsed}ms`);
  } else {
    logger.log(TAG, `Migrated ${summary(lib)} from persist:root in ${elapsed}ms`);
  }
}

function startAutoSave(deps: LibraryPersistenceDeps): void {
  deps.libraryStore.startAutoSave({
    getState: () => pickPersistedLibrary({ ...deps.getLibraryState() }),
    subscribe: deps.subscribe,
  });
}

function summary(lib: PersistedLibrary): string {
  return `${Object.keys(lib.mediaLibrary).length} shows / ${lib.movies.length} movies / ${lib.audiobooks.length} audiobooks`;
}
