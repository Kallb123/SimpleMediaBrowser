import { Alert } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { logger } from '@/scripts/Logger';
import { LibraryStore, pickPersistedLibrary } from '@/scripts/LibraryStore';
import type { PersistedLibrary } from '@/scripts/LibraryStore';
import { hydrateLibrary } from './libraryReducer';
import {
  buildRecoveryPrompt,
  clearRehydrateFailure,
  errorMessage,
  performStartFresh,
  recordRehydrateFailure,
  shouldOfferRecovery,
} from './rehydrateRecovery';
import type { RehydrateFailureRecord } from './rehydrateRecovery';

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
  /** The error that failed the settings rehydrate (only meaningful when `didRehydrateFail()`). */
  getRehydrateError(): unknown;
  /** Handling for a `persist:root` that keeps failing to load (see rehydrateRecovery.ts). */
  recovery: {
    /** Counts this launch's failed rehydrate and returns the updated record. Never rejects. */
    recordFailure(message: string): Promise<RehydrateFailureRecord>;
    /** Forgets recorded failures. Never rejects. */
    clearFailure(): Promise<void>;
    /** Asks the user; resolves true for "Start fresh", false for "Keep trying". */
    confirmStartFresh(record: RehydrateFailureRecord): Promise<boolean>;
    /** Removes the unreadable `persist:root` and re-arms the write gate; rejects, changing nothing, if it can't. */
    startFresh(): Promise<void>;
  };
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
  const { store, allowPersistWrites, didPersistRehydrateFail, getPersistRehydrateError, unblockPersistWrites, takeLegacyPersistedLibrary, waitForPersistBootstrap }: typeof import('./store') =
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
    getRehydrateError: getPersistRehydrateError,
    recovery: {
      recordFailure: (message) => recordRehydrateFailure(AsyncStorage, message),
      clearFailure: () => clearRehydrateFailure(AsyncStorage),
      confirmStartFresh: confirmStartFreshAlert,
      startFresh: () => performStartFresh({ storage: AsyncStorage, unblockWrites: unblockPersistWrites }),
    },
  };
}

/** Blocks startup (the splash screen stays up) until the user picks "Start fresh" or "Keep trying". */
function confirmStartFreshAlert(record: RehydrateFailureRecord): Promise<boolean> {
  const { title, message } = buildRecoveryPrompt(record);
  return new Promise<boolean>((resolve) => {
    Alert.alert(
      title,
      message,
      [
        { text: 'Keep trying', style: 'cancel', onPress: () => resolve(false) },
        { text: 'Start fresh', style: 'destructive', onPress: () => resolve(true) },
      ],
      // Dismissing without choosing counts as "Keep trying": never delete on an accident.
      { cancelable: true, onDismiss: () => resolve(false) },
    );
  });
}

export async function runLibraryPersistence(deps: LibraryPersistenceDeps): Promise<void> {
  const t0 = Date.now();
  await deps.waitForBootstrap();

  // When settings could not be read, store.ts has already blocked writes to
  // `persist:root` for this session. The SQLite store doesn't depend on it, so an
  // existing library still loads and autosaves; only the migration is skipped
  // (see below), since persist:root may still hold the only copy of the legacy library.
  // A single failure never changes that. Only a persistent one (see
  // rehydrateRecovery.ts) lets the user choose to discard the unreadable entry.
  let settingsFailed = deps.didRehydrateFail();
  if (!settingsFailed) {
    await deps.recovery.clearFailure();
  } else {
    settingsFailed = !(await recoverFromSettingsFailure(deps));
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

/**
 * Handles a failed settings rehydrate: counts it, and either shows the usual
 * notice (a single, possibly transient failure) or, for a persistent one, asks
 * whether to start fresh. Returns true only if the user chose "Start fresh" and
 * `persist:root` was removed, i.e. the session can proceed like a fresh install.
 */
async function recoverFromSettingsFailure(deps: LibraryPersistenceDeps): Promise<boolean> {
  const message = errorMessage(deps.getRehydrateError());
  logger.error(TAG, `Settings failed to load; settings will not be saved this session (${message})`);
  const record = await deps.recovery.recordFailure(message);

  if (!shouldOfferRecovery(record)) {
    logger.warn(TAG, `Settings failed to load (${record.consecutiveFailures} launch(es) in a row); keeping stored data and not offering recovery yet`);
    deps.alert(
      'Could not load your settings',
      'Your saved settings could not be read, so settings changes will not be saved this session. Restart the app to try again.',
    );
    return false;
  }

  logger.warn(TAG, `Settings failed to load on ${record.consecutiveFailures} launch(es) in a row (${message}); offering to start fresh`);
  if (!(await deps.recovery.confirmStartFresh(record))) {
    logger.log(TAG, 'User chose "Keep trying": leaving persist:root untouched and not saving settings this session');
    return false;
  }

  logger.warn(TAG, 'User chose "Start fresh": discarding unreadable persist:root');
  try {
    await deps.recovery.startFresh();
  } catch (e) {
    logger.error(TAG, 'Start fresh failed; persist:root left in place and settings will not be saved this session', e);
    deps.alert(
      'Could not start fresh',
      'The unreadable saved settings could not be removed, so nothing will be saved this session. Restart the app to try again.',
    );
    return false;
  }
  await deps.recovery.clearFailure();
  logger.log(TAG, 'Start fresh complete: settings writes re-enabled once the library store is ready');
  return true;
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
