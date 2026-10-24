import type { Middleware } from '@reduxjs/toolkit'
import { REHYDRATE } from 'redux-persist';
import type { PersistConfig, Storage } from 'redux-persist';
import autoMergeLevel1 from 'redux-persist/lib/stateReconciler/autoMergeLevel1';
import { logger } from '@/scripts/Logger';

// Side-effect-free pieces of the redux-persist wiring in store.ts, kept apart
// so they can be unit-tested without creating the real store.

export const PERSIST_KEY = 'root';

// ---------------------------------------------------------------------------
// Legacy library capture
// ---------------------------------------------------------------------------
// Installs from before the SQLite library store have `libraryReducer` inside
// `persist:root`. redux-persist's autoMergeLevel1 merges *every* key of the
// inbound blob into state regardless of `whitelist`, so without intervention a
// stale library would be merged on every rehydrate until the blob is rewritten.
// The reconciler pulls it out of the inbound state, stashes it for the
// one-time migration in libraryPersistence.ts, and merges the rest as usual.
// The stash can still contain legacy transient fields (isScanning /
// scanProgress / scanList); `pickPersistedLibrary` strips them.
export function createLegacyLibraryCapture() {
  let legacyPersistedLibrary: unknown;

  const reconciler = (
    inboundState: any,
    originalState: any,
    reducedState: any,
    config: PersistConfig<any>,
  ) => {
    if (inboundState && typeof inboundState === 'object' && 'libraryReducer' in inboundState) {
      const { libraryReducer: legacy, ...rest } = inboundState;
      legacyPersistedLibrary = legacy;
      return autoMergeLevel1(rest, originalState, reducedState, config);
    }
    return autoMergeLevel1(inboundState, originalState, reducedState, config);
  };

  return {
    reconciler,
    /** Returns the `libraryReducer` blob found in `persist:root` (if any) and clears it. */
    take: (): unknown | undefined => {
      const legacy = legacyPersistedLibrary;
      legacyPersistedLibrary = undefined;
      return legacy;
    },
  };
}

// ---------------------------------------------------------------------------
// Write gate
// ---------------------------------------------------------------------------
// After the first REHYDRATE, redux-persist's persistoid (createPersistoid.js)
// has an empty `lastState`, so it queues every whitelisted key plus `_persist`
// and writes them as the *entire* new `persist:root` value. That first write
// is what drops the legacy `libraryReducer` from the blob, so it must not
// happen until the library is safely in the SQLite library store. For the same reason a
// failed read must never be followed by a write: redux-persist rehydrates with
// `undefined` on a read error or its 5 s timeout, and the next write would
// replace the stored settings (sources, API keys, password, ...) with defaults.
//
// Hence storage writes wait for `open()` (called by libraryPersistence once
// the library is hydrated/migrated), and `block()` turns them into no-ops for
// the rest of the session. The one exception is the user-confirmed "Start
// fresh" recovery for a `persist:root` that can never be read, which calls
// `unblock()` after removing the entry.
export function createWriteGate(base: Storage) {
  let open!: () => void;
  let opened = new Promise<void>((resolve) => { open = resolve; });
  let blocked = false;
  let blockReason: unknown;

  const storage: Storage = {
    getItem: (key: string) => base.getItem(key),
    removeItem: (key: string) => base.removeItem(key),
    setItem: async (key: string, value: string) => {
      await opened;
      if (blocked) {
        logger.warn('Store', `Skipping write of "${key}": settings were not loaded this session, keeping stored data intact`);
        return;
      }
      return base.setItem(key, value);
    },
  };

  return {
    storage,
    /** Lets queued and future writes through. */
    allow: () => open(),
    /**
     * Turns writes into no-ops (also wakes writes already waiting). `reason` is
     * the error that made it necessary. Lasts for the session unless the user
     * explicitly chooses to discard the unreadable data (see `unblock`).
     */
    block: (reason?: unknown) => {
      blocked = true;
      blockReason = reason;
      open();
    },
    /**
     * Only for the "Start fresh" recovery (rehydrateRecovery.ts), after the
     * unreadable `persist:root` has been removed. Writes are held again until
     * `allow()`, exactly as at startup, so settings are not written before the
     * library store is initialised.
     */
    unblock: () => {
      if (!blocked) return;
      blocked = false;
      blockReason = undefined;
      opened = new Promise<void>((resolve) => { open = resolve; });
    },
    isBlocked: () => blocked,
    /** The error passed to `block()`, if any. */
    getBlockReason: () => blockReason,
  };
}

// redux-persist reports a failed read, failed migrate or the 5 s timeout by
// dispatching REHYDRATE with an `err` and no payload. The state then stays at
// defaults while storage may still hold the user's real settings (and legacy
// library), so block writes before the reducer's post-rehydrate write is queued.
export function createRehydrateErrorGuard(gate: Pick<ReturnType<typeof createWriteGate>, 'block'>): Middleware {
  return () => (next) => (action: any) => {
    if (action?.type === REHYDRATE && action.key === PERSIST_KEY && action.err) {
      logger.error('Store', 'Failed to rehydrate persisted settings; blocking settings writes for this session so stored data is not overwritten', action.err);
      gate.block(action.err);
    }
    return next(action);
  };
}
