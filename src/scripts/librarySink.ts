import type { UnknownAction } from '@reduxjs/toolkit';
// Type-only (erased at runtime), so this module never loads the store.
import type { RootState } from '@/store/store';

/**
 * The narrow slice of the Redux store that FileScanner, MetadataService and the
 * scan-progress dispatcher need: dispatch actions, and read fresh state.
 *
 * They talk to this instead of importing the `store` singleton, so they can be
 * loaded and tested without the store (and everything it pulls in). The real store
 * satisfies it structurally; tests can pass a fake.
 */
export interface LibrarySink {
    dispatch(action: UnknownAction): unknown;
    getState(): Pick<RootState, 'libraryReducer' | 'settingsReducer'>;
}

let configuredSink: LibrarySink | null = null;

/**
 * Wires the sink used by `librarySink`. Called once at startup (see
 * `store/wireServices.ts`); tests call it with a fake, or with `null` to reset.
 */
export function setLibrarySink(sink: LibrarySink | null): void {
    configuredSink = sink;
}

function requireSink(): LibrarySink {
    if (configuredSink == null) {
        throw new Error(
            'LibrarySink is not configured: call setLibrarySink(store) at startup (import "@/store/wireServices") before scanning or enriching.',
        );
    }
    return configuredSink;
}

/**
 * Drop-in replacement for the `store` singleton in the scanning/enrichment code.
 * It forwards to the configured sink on every call (never caching state), so
 * `getState()` always reads fresh state, and throws a clear error if used
 * before `setLibrarySink` has been called.
 */
export const librarySink: LibrarySink = {
    dispatch: (action) => requireSink().dispatch(action),
    getState: () => requireSink().getState(),
};
