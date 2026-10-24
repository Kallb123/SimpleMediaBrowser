import { StorageKeys } from '@/constants/StorageKeys';
import { logger } from '@/scripts/Logger';
import { PERSIST_KEY } from './persistGuards';

// Recovery for a `persist:root` that can never be read (issue #228).
//
// Installs from before the SQLite library store can have grown `persist:root`
// past Android's ~2 MB per-entry read limit (issue #222), so AsyncStorage fails
// to read it on every launch. The rehydrate error guard (persistGuards.ts) then
// blocks settings writes and libraryPersistence.ts skips the migration, on every
// launch, because a single failed read must never overwrite stored data. That is
// right for a one-off failure and a dead end for a permanent one.
//
// This module is side-effect free apart from the storage it is handed, so it is
// unit-tested directly. It tracks consecutive failed launches in its own small
// AsyncStorage entry (so it stays readable when persist:root is not), decides
// when to offer the user a choice, and implements the "Start fresh" action.
// libraryPersistence.ts drives it.

const TAG = 'RehydrateRecovery';

/** AsyncStorage key redux-persist uses for the settings blob (`persist:` + key). */
export const PERSIST_STORAGE_KEY = `persist:${PERSIST_KEY}`;

/** Offer recovery once this many consecutive launches failed to load settings. */
export const RECOVERY_FAILURE_THRESHOLD = 2;

/** The slice of AsyncStorage this module uses. */
export interface KeyValueStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

export interface RehydrateFailureRecord {
  /** Consecutive launches whose settings rehydrate failed, including this one. */
  consecutiveFailures: number;
  /** Message of the most recent failure. */
  lastError: string;
  /** Epoch ms of the most recent failure. */
  lastFailedAt: number;
}

/** Text of an error as redux-persist reports it (an Error, a string, or something else). */
export function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  if (err === undefined || err === null) return 'unknown error';
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}

/**
 * True for the AsyncStorage failure behind #222: Android could not read an
 * oversized entry through its ~2 MB CursorWindow. Retrying cannot succeed.
 */
export function isSizeFailure(message: string): boolean {
  return /CursorWindow|Row too big/i.test(message);
}

/**
 * Whether the user should be offered "Start fresh" instead of just the usual
 * "settings could not be loaded" notice: after repeated failed launches, or
 * straight away when the error shows the entry is too large to ever be read.
 */
export function shouldOfferRecovery(record: Pick<RehydrateFailureRecord, 'consecutiveFailures' | 'lastError'>): boolean {
  return record.consecutiveFailures >= RECOVERY_FAILURE_THRESHOLD || isSizeFailure(record.lastError);
}

function parseRecord(raw: string | null): RehydrateFailureRecord | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw);
    if (v && typeof v.consecutiveFailures === 'number' && v.consecutiveFailures >= 0) {
      return {
        consecutiveFailures: Math.floor(v.consecutiveFailures),
        lastError: typeof v.lastError === 'string' ? v.lastError : '',
        lastFailedAt: typeof v.lastFailedAt === 'number' ? v.lastFailedAt : 0,
      };
    }
  } catch {
    // Corrupt record: treated as no history.
  }
  return null;
}

/**
 * Counts this launch's failed settings rehydrate in the failure record and
 * returns the updated record. Never throws: if the record can't be read or
 * written, the failure is counted as the first one (so recovery is only offered
 * by the size check), which errs on the side of never offering data deletion.
 */
export async function recordRehydrateFailure(
  storage: KeyValueStorage,
  message: string,
  now: number = Date.now(),
): Promise<RehydrateFailureRecord> {
  let previous: RehydrateFailureRecord | null = null;
  try {
    previous = parseRecord(await storage.getItem(StorageKeys.REHYDRATE_FAILURE_KEY));
  } catch (e) {
    logger.warn(TAG, 'Could not read the rehydrate failure record', e);
  }
  const record: RehydrateFailureRecord = {
    consecutiveFailures: (previous?.consecutiveFailures ?? 0) + 1,
    lastError: message,
    lastFailedAt: now,
  };
  try {
    await storage.setItem(StorageKeys.REHYDRATE_FAILURE_KEY, JSON.stringify(record));
  } catch (e) {
    logger.warn(TAG, 'Could not save the rehydrate failure record', e);
  }
  return record;
}

/** Forgets recorded failures (settings loaded fine, or the user started fresh). Never throws. */
export async function clearRehydrateFailure(storage: KeyValueStorage): Promise<void> {
  try {
    await storage.removeItem(StorageKeys.REHYDRATE_FAILURE_KEY);
  } catch (e) {
    logger.warn(TAG, 'Could not clear the rehydrate failure record', e);
  }
}

/** Text for the "Start fresh" / "Keep trying" prompt. */
export function buildRecoveryPrompt(record: Pick<RehydrateFailureRecord, 'consecutiveFailures' | 'lastError'>): { title: string; message: string } {
  const detail = record.lastError.length > 200 ? `${record.lastError.slice(0, 200)}...` : record.lastError;
  const reason = isSizeFailure(record.lastError)
    ? 'Your saved settings are too large for Android to read, so this will keep happening.'
    : `Your saved settings could not be read on ${record.consecutiveFailures} launches in a row.`;
  return {
    title: 'Saved settings cannot be loaded',
    message:
      `${reason}\n\n` +
      'Start fresh deletes the unreadable saved settings (and any old library stored with them). ' +
      'You will need to set up the app and rescan your folders again, but settings and your library will save normally afterwards.\n\n' +
      'Keep trying changes nothing: nothing will be saved this session, and you will be asked again next launch.' +
      (detail ? `\n\nError: ${detail}` : ''),
  };
}

export interface StartFreshDeps {
  storage: Pick<KeyValueStorage, 'removeItem'>;
  /** Re-arms the write gate (writes stay held until the library store is ready). */
  unblockWrites(): void;
}

/**
 * "Start fresh": discards the unreadable settings so they (and the library) can
 * be saved again. Throws, having changed nothing else, if `persist:root` could
 * not be removed.
 *
 * Order matters:
 * 1. Remove `persist:root`. Until this succeeds the write gate stays blocked,
 *    so nothing can write defaults over the old entry.
 * 2. Remove the first-time-setup flag, so the app shows first-time setup as on
 *    a fresh install (the settings it configured are gone). Best effort.
 * 3. Re-arm the write gate. Writes are still held until the library store has
 *    been initialised (libraryPersistence calls allowWrites afterwards).
 */
export async function performStartFresh(deps: StartFreshDeps): Promise<void> {
  await deps.storage.removeItem(PERSIST_STORAGE_KEY);
  logger.log(TAG, `Removed unreadable "${PERSIST_STORAGE_KEY}"`);
  try {
    await deps.storage.removeItem(StorageKeys.FIRST_TIME_SETUP_KEY);
  } catch (e) {
    logger.warn(TAG, 'Could not reset the first-time setup flag; first-time setup will not be shown', e);
  }
  deps.unblockWrites();
}
