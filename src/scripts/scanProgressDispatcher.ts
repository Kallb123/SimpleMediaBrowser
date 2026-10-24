import { librarySink } from '@/scripts/librarySink';
import { setScanProgress } from '@/store/libraryReducer';
import type { ScanProgress } from '@/store/libraryReducer';
import { createThrottledDispatcher } from '@/scripts/throttledDispatch';

/** ~4 dispatches/s: each one re-serialises the persisted library and rebuilds every mounted browse screen. */
const SCAN_PROGRESS_INTERVAL_MS = 250;

/**
 * Shared by FileScanner and MetadataService so an immediate (phase-change) dispatch from
 * either one cancels a pending trailing tick from the other.  Use `.throttled` for per-item
 * ticks, `.immediate` for phase starts/finals, `.flush` at the end of a phase, and `.cancel`
 * just before `setIsScanning(false)` (which resets progress itself).
 */
export const scanProgressDispatcher = createThrottledDispatcher<ScanProgress>(
    (progress) => { librarySink.dispatch(setScanProgress(progress)); },
    SCAN_PROGRESS_INTERVAL_MS,
);
