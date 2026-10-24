/**
 * Pure rate limiter for high-frequency state updates (no Redux/store imports, so it can be
 * unit-tested with an injected `dispatch`).
 *
 * - `throttled(v)`: dispatches immediately if `intervalMs` has passed since the last
 *   dispatch (leading edge); otherwise remembers only the latest `v` and dispatches it once
 *   the window closes (trailing edge), so the final value is never lost.
 * - `immediate(v)`: dispatches now and drops any pending trailing value, so a stale tick
 *   from an earlier phase can never land after (and overwrite) a newer update.
 * - `flush()`: dispatches the pending trailing value now, if any (use at the end of a phase).
 * - `cancel()`: discards the pending trailing value (use when the state it targets is reset).
 */
export interface ThrottledDispatcher<T> {
    throttled(value: T): void;
    immediate(value: T): void;
    flush(): void;
    cancel(): void;
}

export function createThrottledDispatcher<T>(
    dispatch: (value: T) => void,
    intervalMs: number,
    now: () => number = Date.now,
): ThrottledDispatcher<T> {
    let lastSentAt = -Infinity;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let hasPending = false;
    let pending: T | undefined;

    const send = (value: T) => {
        lastSentAt = now();
        dispatch(value);
    };

    const clearTimer = () => {
        if (timer !== undefined) {
            clearTimeout(timer);
            timer = undefined;
        }
    };

    const flush = () => {
        clearTimer();
        if (!hasPending) return;
        const value = pending as T;
        hasPending = false;
        pending = undefined;
        send(value);
    };

    return {
        throttled(value) {
            const elapsed = now() - lastSentAt;
            if (timer === undefined && !hasPending && elapsed >= intervalMs) {
                send(value);
                return;
            }
            pending = value;
            hasPending = true;
            if (timer === undefined) {
                timer = setTimeout(flush, Math.max(0, intervalMs - elapsed));
            }
        },
        immediate(value) {
            clearTimer();
            hasPending = false;
            pending = undefined;
            send(value);
        },
        flush,
        cancel() {
            clearTimer();
            hasPending = false;
            pending = undefined;
        },
    };
}
