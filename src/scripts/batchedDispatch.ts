/**
 * Pure accumulator for bursts of small updates (no Redux/store imports, so it can be
 * unit-tested with an injected `send`).
 *
 * - `add(item)`: queues the item. The queue is sent as one batch once it holds `maxItems`,
 *   or `intervalMs` after the first queued item, whichever comes first, so nothing waits
 *   longer than `intervalMs` even if the burst stops early.
 * - `flush()`: sends whatever is queued now (use at the end of a run, and before reading
 *   state that depends on the queued updates).
 */
export interface Batcher<T> {
    add(item: T): void;
    flush(): void;
}

export function createBatcher<T>(
    send: (items: T[]) => void,
    maxItems: number,
    intervalMs: number,
): Batcher<T> {
    let queue: T[] = [];
    let timer: ReturnType<typeof setTimeout> | undefined;

    const flush = () => {
        if (timer !== undefined) {
            clearTimeout(timer);
            timer = undefined;
        }
        if (queue.length === 0) return;
        const items = queue;
        queue = [];
        send(items);
    };

    return {
        add(item) {
            queue.push(item);
            if (queue.length >= maxItems) {
                flush();
            } else if (timer === undefined) {
                timer = setTimeout(flush, intervalMs);
            }
        },
        flush,
    };
}
