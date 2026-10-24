import { createBatcher } from '../batchedDispatch';

const MAX = 3;
const INTERVAL = 300;

describe('createBatcher', () => {
  let send: jest.Mock<void, [number[]]>;

  beforeEach(() => {
    jest.useFakeTimers();
    send = jest.fn();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  const make = () => createBatcher<number>(send, MAX, INTERVAL);

  it('sends nothing until the batch is full or the interval passes', () => {
    const b = make();
    b.add(1);
    b.add(2);
    expect(send).not.toHaveBeenCalled();
  });

  it('sends a full batch immediately, preserving order', () => {
    const b = make();
    [1, 2, 3, 4].forEach((n) => b.add(n));
    expect(send.mock.calls).toEqual([[[1, 2, 3]]]);
  });

  it('sends a partial batch once the interval has passed since the first item', () => {
    const b = make();
    b.add(1);
    jest.advanceTimersByTime(INTERVAL - 1);
    b.add(2);
    expect(send).not.toHaveBeenCalled();

    jest.advanceTimersByTime(1);
    expect(send.mock.calls).toEqual([[[1, 2]]]);
  });

  it('flush() sends the queued items now and cancels the pending timer', () => {
    const b = make();
    b.add(1);
    b.add(2);
    b.flush();
    expect(send.mock.calls).toEqual([[[1, 2]]]);

    jest.advanceTimersByTime(INTERVAL * 4);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('flush() with nothing queued does not send', () => {
    make().flush();
    expect(send).not.toHaveBeenCalled();
  });

  it('starts a fresh interval for the next burst', () => {
    const b = make();
    b.add(1);
    jest.advanceTimersByTime(INTERVAL);
    b.add(2);
    jest.advanceTimersByTime(INTERVAL);
    expect(send.mock.calls).toEqual([[[1]], [[2]]]);
  });

  it('does not send items twice after a full-batch send cleared the timer', () => {
    const b = make();
    [1, 2, 3].forEach((n) => b.add(n));
    jest.advanceTimersByTime(INTERVAL * 2);
    expect(send).toHaveBeenCalledTimes(1);
  });
});
