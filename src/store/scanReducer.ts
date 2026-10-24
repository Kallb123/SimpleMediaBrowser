import { createSlice, PayloadAction } from '@reduxjs/toolkit';
import type { RootState } from './store';

/** Progress information for an in-progress scan. */
export interface ScanProgress {
  /** Current phase of the scan. */
  phase: 'idle' | 'collecting' | 'thumbnails' | 'enriching';
  /** Number of media files found so far during the collecting phase. */
  filesFound: number;
  /** Number of thumbnails successfully generated or failed so far. */
  thumbnailsDone: number;
  /** Total number of thumbnails to generate (set when the thumbnail phase begins). */
  thumbnailsTotal: number;
  /** Number of metadata items (shows + movies) processed so far during enrichment. */
  metadataDone: number;
  /** Total number of metadata items to process during enrichment. */
  metadataTotal: number;
  /**
   * 1-based index of the source currently being collected.
   * Only present during the 'collecting' phase when there is more than one source.
   */
  currentSourceIndex?: number;
  /** Total number of sources being scanned. Only present when there is more than one source. */
  sourcesTotal?: number;
}

/**
 * Transient scan state. Deliberately its own slice, separate from `libraryReducer`: progress
 * ticks several times a second during a scan, and keeping them out of the library slice means
 * the library's object identity (which library autosave and the browse screens key off) only
 * changes when the library itself does. Not persisted anywhere.
 */
export interface ScanState {
  isScanning: boolean;
  /** Live progress information updated during an active scan. */
  scanProgress: ScanProgress;
}

export const INITIAL_SCAN_PROGRESS: ScanProgress = {
  phase: 'idle',
  filesFound: 0,
  thumbnailsDone: 0,
  thumbnailsTotal: 0,
  metadataDone: 0,
  metadataTotal: 0,
};

const initialState: ScanState = {
  isScanning: false,
  scanProgress: INITIAL_SCAN_PROGRESS,
};

export const scanSlice = createSlice({
  name: 'scan',
  initialState,
  reducers: {
    setIsScanning: (state, action: PayloadAction<boolean>) => {
      state.isScanning = action.payload;
      // Reset progress to idle when scanning stops so stale values are not shown
      // on the next scan's initial render.
      if (!action.payload) {
        state.scanProgress = INITIAL_SCAN_PROGRESS;
      }
    },
    setScanProgress: (state, action: PayloadAction<ScanProgress>) => {
      state.scanProgress = action.payload;
    },
  },
});

export const { setIsScanning, setScanProgress } = scanSlice.actions;

export const selectIsScanning = (state: RootState) => state.scanReducer.isScanning;
export const selectScanProgress = (state: RootState) => state.scanReducer.scanProgress;

export default scanSlice.reducer;
