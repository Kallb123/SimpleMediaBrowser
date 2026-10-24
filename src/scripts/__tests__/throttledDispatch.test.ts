import { createThrottledDispatcher } from '../throttledDispatch';

const INTERVAL = 250;

describe('createThrottledDispatcher', () => {
  let dispatch: jest.Mock<void, [number]>;

  beforeEach(() => {
    jest.useFakeTimers();
    dispatch = jest.fn();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  const make = () => createThrottledDispatcher<number>(dispatch, INTERVAL);

  it('dispatches the first throttled value immediately (leading edge)', () => {
    make().throttled(1);
    expect(dispatch.mock.calls).toEqual([[1]]);
  });

  it('coalesces calls inside the window and dispatches only the latest value (trailing edge)', () => {
    const d = make();
    d.throttled(1);
    d.throttled(2);
    d.throttled(3);
    expect(dispatch.mock.calls).toEqual([[1]]);

    jest.advanceTimersByTime(INTERVAL - 1);
    expect(dispatch.mock.calls).toEqual([[1]]);

    jest.advanceTimersByTime(1);
    expect(dispatch.mock.calls).toEqual([[1], [3]]);

    // Nothing further is scheduled once the trailing value has gone out.
    jest.advanceTimersByTime(INTERVAL * 4);
    expect(dispatch).toHaveBeenCalledTimes(2);
  });

  it('dispatches leading again once a quiet window has passed', () => {
    const d = make();
    d.throttled(1);
    jest.advanceTimersByTime(INTERVAL);
    d.throttled(2);
    expect(dispatch.mock.calls).toEqual([[1], [2]]);
  });

  it('limits a sustained burst to roughly one dispatch per interval and ends on the last value', () => {
    const d = make();
    for (let i = 1; i <= 100; i++) {
      d.throttled(i);
      jest.advanceTimersByTime(10); // 100 ticks over ~1s
    }
    jest.advanceTimersByTime(INTERVAL);
    expect(dispatch.mock.calls.length).toBeLessThanOrEqual(6);
    expect(dispatch.mock.calls[dispatch.mock.calls.length - 1]).toEqual([100]);
  });

  it('immediate() dispatches now and cancels a pending trailing value', () => {
    const d = make();
    d.throttled(1);
    d.throttled(2); // pending trailing
    d.immediate(99);
    expect(dispatch.mock.calls).toEqual([[1], [99]]);

    jest.advanceTimersByTime(INTERVAL * 4);
    expect(dispatch.mock.calls).toEqual([[1], [99]]);
  });

  it('a throttled call right after immediate() is treated as inside the window', () => {
    const d = make();
    d.immediate(1);
    d.throttled(2);
    expect(dispatch.mock.calls).toEqual([[1]]);
    jest.advanceTimersByTime(INTERVAL);
    expect(dispatch.mock.calls).toEqual([[1], [2]]);
  });

  it('flush() sends the pending value now and clears the timer', () => {
    const d = make();
    d.throttled(1);
    d.throttled(2);
    d.flush();
    expect(dispatch.mock.calls).toEqual([[1], [2]]);
    jest.advanceTimersByTime(INTERVAL * 4);
    expect(dispatch).toHaveBeenCalledTimes(2);
  });

  it('flush() is a no-op when nothing is pending', () => {
    const d = make();
    d.throttled(1);
    d.flush();
    expect(dispatch).toHaveBeenCalledTimes(1);
  });

  it('cancel() discards the pending value', () => {
    const d = make();
    d.throttled(1);
    d.throttled(2);
    d.cancel();
    jest.advanceTimersByTime(INTERVAL * 4);
    expect(dispatch.mock.calls).toEqual([[1]]);
  });
});
