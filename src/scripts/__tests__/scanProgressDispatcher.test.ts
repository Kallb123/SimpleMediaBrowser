import type { ScanProgress } from '@/store/libraryReducer';
import type { LibrarySink } from '@/scripts/librarySink';

// The whole point of the LibrarySink refactor: the dispatcher must work without the real
// store (redux-persist, AsyncStorage, native modules) ever being loaded.
const mockStoreLoaded = jest.fn();
jest.mock('@/store/store', () => {
  mockStoreLoaded();
  throw new Error('@/store/store must not be imported by scanProgressDispatcher');
});

const progress = (metadataDone: number): ScanProgress => ({
  phase: 'enriching',
  filesFound: 0,
  thumbnailsDone: 0,
  thumbnailsTotal: 0,
  metadataDone,
  metadataTotal: 100,
});

const action = (p: ScanProgress) => ({ type: 'settings/setScanProgress', payload: p });

const INTERVAL = 250;

describe('scanProgressDispatcher', () => {
  let dispatch: jest.Mock;
  let scanProgressDispatcher: typeof import('../scanProgressDispatcher').scanProgressDispatcher;
  let setLibrarySink: typeof import('../librarySink').setLibrarySink;

  beforeEach(() => {
    jest.useFakeTimers();
    // Fresh module registry so the dispatcher's throttle window starts clean in every test.
    jest.resetModules();
    // requireActual resolves through the (just reset) module registry; the mocked store still applies.
    ({ setLibrarySink } = jest.requireActual<typeof import('../librarySink')>('../librarySink'));
    ({ scanProgressDispatcher } = jest.requireActual<typeof import('../scanProgressDispatcher')>('../scanProgressDispatcher'));
    dispatch = jest.fn();
    setLibrarySink({ dispatch, getState: jest.fn() } as unknown as LibrarySink);
  });

  afterEach(() => {
    scanProgressDispatcher.cancel();
    setLibrarySink(null);
    jest.useRealTimers();
  });

  it('loads (and dispatches) without ever importing the real store', () => {
    scanProgressDispatcher.immediate(progress(1));
    expect(mockStoreLoaded).not.toHaveBeenCalled();
  });

  it('immediate() dispatches a setScanProgress action through the sink', () => {
    scanProgressDispatcher.immediate(progress(1));
    expect(dispatch.mock.calls).toEqual([[action(progress(1))]]);
  });

  it('throttled() dispatches the leading value immediately, then only the latest value after the interval', () => {
    scanProgressDispatcher.throttled(progress(1));
    scanProgressDispatcher.throttled(progress(2));
    scanProgressDispatcher.throttled(progress(3));
    expect(dispatch.mock.calls).toEqual([[action(progress(1))]]);

    jest.advanceTimersByTime(INTERVAL);
    expect(dispatch.mock.calls).toEqual([[action(progress(1))], [action(progress(3))]]);
  });

  it('flush() dispatches the pending trailing value right away and nothing afterwards', () => {
    scanProgressDispatcher.throttled(progress(1));
    scanProgressDispatcher.throttled(progress(2));
    scanProgressDispatcher.flush();
    expect(dispatch.mock.calls).toEqual([[action(progress(1))], [action(progress(2))]]);

    jest.advanceTimersByTime(INTERVAL * 4);
    expect(dispatch).toHaveBeenCalledTimes(2);
  });

  it('flush() with nothing pending does not dispatch', () => {
    scanProgressDispatcher.flush();
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('immediate() drops a pending trailing tick so a stale value cannot overwrite it', () => {
    scanProgressDispatcher.throttled(progress(1));
    scanProgressDispatcher.throttled(progress(2)); // pending
    scanProgressDispatcher.immediate(progress(50));
    jest.advanceTimersByTime(INTERVAL * 4);

    expect(dispatch.mock.calls).toEqual([[action(progress(1))], [action(progress(50))]]);
  });

  it('cancel() discards the pending trailing tick', () => {
    scanProgressDispatcher.throttled(progress(1));
    scanProgressDispatcher.throttled(progress(2));
    scanProgressDispatcher.cancel();
    jest.advanceTimersByTime(INTERVAL * 4);

    expect(dispatch.mock.calls).toEqual([[action(progress(1))]]);
  });

  it('resolves the sink at dispatch time, so a sink set after load receives the actions', () => {
    const late = jest.fn();
    setLibrarySink({ dispatch: late, getState: jest.fn() } as unknown as LibrarySink);
    scanProgressDispatcher.immediate(progress(7));
    expect(late).toHaveBeenCalledWith(action(progress(7)));
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('throws the "not configured" error if dispatched before a sink is set', () => {
    setLibrarySink(null);
    expect(() => scanProgressDispatcher.immediate(progress(1))).toThrow(/LibrarySink is not configured/);
  });
});
