import { librarySink, setLibrarySink } from '../librarySink';
import type { LibrarySink } from '../librarySink';

const makeFakeSink = (state: object = {}) => {
  const sink = {
    dispatch: jest.fn((action: unknown) => action),
    getState: jest.fn(() => state),
  };
  return sink as typeof sink & LibrarySink;
};

describe('librarySink', () => {
  afterEach(() => {
    setLibrarySink(null);
  });

  describe('before configuration', () => {
    it('throws a clear error from dispatch', () => {
      expect(() => librarySink.dispatch({ type: 'x' })).toThrow(/LibrarySink is not configured/);
      expect(() => librarySink.dispatch({ type: 'x' })).toThrow(/setLibrarySink/);
    });

    it('throws a clear error from getState', () => {
      expect(() => librarySink.getState()).toThrow(/LibrarySink is not configured/);
    });
  });

  describe('once configured', () => {
    it('forwards dispatch with the action and returns the sink result', () => {
      const sink = makeFakeSink();
      setLibrarySink(sink);
      const action = { type: 'thing/happened', payload: 1 };

      expect(librarySink.dispatch(action)).toBe(action);
      expect(sink.dispatch).toHaveBeenCalledTimes(1);
      expect(sink.dispatch).toHaveBeenCalledWith(action);
    });

    it('forwards getState and returns the sink state', () => {
      const state = { libraryReducer: {}, settingsReducer: {} };
      const sink = makeFakeSink(state);
      setLibrarySink(sink);

      expect(librarySink.getState()).toBe(state);
      expect(sink.getState).toHaveBeenCalledTimes(1);
    });

    it('reads state fresh on every call (never caches)', () => {
      let n = 0;
      const sink = makeFakeSink();
      sink.getState.mockImplementation(() => ({ n: ++n }) as any);
      setLibrarySink(sink);

      expect(librarySink.getState()).toEqual({ n: 1 });
      expect(librarySink.getState()).toEqual({ n: 2 });
      expect(librarySink.getState()).toEqual({ n: 3 });
      expect(sink.getState).toHaveBeenCalledTimes(3);
    });

    it('resolves the sink at call time, so a held reference follows reconfiguration', () => {
      const first = makeFakeSink({ which: 'first' });
      const second = makeFakeSink({ which: 'second' });
      const held = librarySink; // what other modules import at load time

      setLibrarySink(first);
      expect(held.getState()).toEqual({ which: 'first' });

      setLibrarySink(second);
      expect(held.getState()).toEqual({ which: 'second' });
      held.dispatch({ type: 'a' });
      expect(first.dispatch).not.toHaveBeenCalled();
      expect(second.dispatch).toHaveBeenCalledWith({ type: 'a' });
    });
  });

  describe('setLibrarySink(null)', () => {
    it('resets to the unconfigured state', () => {
      const sink = makeFakeSink();
      setLibrarySink(sink);
      librarySink.dispatch({ type: 'a' });

      setLibrarySink(null);

      expect(() => librarySink.dispatch({ type: 'b' })).toThrow(/not configured/);
      expect(() => librarySink.getState()).toThrow(/not configured/);
      expect(sink.dispatch).toHaveBeenCalledTimes(1);
    });
  });
});
