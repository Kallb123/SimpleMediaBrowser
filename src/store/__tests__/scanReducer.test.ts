import { configureStore } from '@reduxjs/toolkit';
import libraryReducer, { setMediaLibrary } from '@/store/libraryReducer';
import scanReducer, {
  INITIAL_SCAN_PROGRESS,
  selectIsScanning,
  selectScanProgress,
  setIsScanning,
  setScanProgress,
} from '@/store/scanReducer';
import type { ScanProgress } from '@/store/scanReducer';
import settingsReducer from '@/store/settingsReducer';

const makeStore = () => configureStore({ reducer: { libraryReducer, settingsReducer, scanReducer } });

const enriching = (metadataDone: number): ScanProgress => ({
  ...INITIAL_SCAN_PROGRESS,
  phase: 'enriching',
  metadataDone,
  metadataTotal: 10,
});

describe('scanReducer', () => {
  it('starts idle and not scanning', () => {
    const state = scanReducer(undefined, { type: '@@init' });
    expect(state).toEqual({ isScanning: false, scanProgress: INITIAL_SCAN_PROGRESS });
  });

  it('stores progress and exposes it through the selectors', () => {
    const store = makeStore();
    store.dispatch(setIsScanning(true));
    store.dispatch(setScanProgress(enriching(3)));

    expect(selectIsScanning(store.getState() as any)).toBe(true);
    expect(selectScanProgress(store.getState() as any)).toEqual(enriching(3));
  });

  it('resets progress to idle when scanning stops', () => {
    const store = makeStore();
    store.dispatch(setIsScanning(true));
    store.dispatch(setScanProgress(enriching(7)));
    store.dispatch(setIsScanning(false));

    expect(store.getState().scanReducer).toEqual({ isScanning: false, scanProgress: INITIAL_SCAN_PROGRESS });
  });

  it('does not touch libraryReducer state, so progress ticks never look like library changes', () => {
    const store = makeStore();
    store.dispatch(setMediaLibrary({}));
    const libraryBefore = store.getState().libraryReducer;
    const settingsBefore = store.getState().settingsReducer;

    store.dispatch(setIsScanning(true));
    for (let i = 0; i < 5; i++) store.dispatch(setScanProgress(enriching(i)));
    store.dispatch(setIsScanning(false));

    // Reference equality is what library autosave and the browse screens key off.
    expect(store.getState().libraryReducer).toBe(libraryBefore);
    expect(store.getState().settingsReducer).toBe(settingsBefore);
  });

  it('no longer keeps scan fields in the library slice', () => {
    const library = libraryReducer(undefined, { type: '@@init' });
    expect(library).not.toHaveProperty('isScanning');
    expect(library).not.toHaveProperty('scanProgress');
  });
});
