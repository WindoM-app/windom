import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createCoalescedWriter } from '../coalesced-write';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('createCoalescedWriter', () => {
  it('writes at once, then merges a burst into one later write', async () => {
    const send = vi.fn().mockResolvedValue(true);
    const writer = createCoalescedWriter(send, 100);

    void writer.write({ a: 1 });
    const second = writer.write({ a: 2 });
    const third = writer.write({ b: 3 });
    expect(send.mock.calls).toEqual([[{ a: 1 }]]);

    await vi.advanceTimersByTimeAsync(100);
    expect(send.mock.calls).toEqual([[{ a: 1 }], [{ a: 2, b: 3 }]]);
    await expect(Promise.all([second, third])).resolves.toEqual([true, true]);
  });

  it('stays within the interval under continuous input', async () => {
    const send = vi.fn().mockResolvedValue(true);
    const writer = createCoalescedWriter(send, 100);
    for (let i = 0; i < 100; i++) {
      void writer.write({ i });
      await vi.advanceTimersByTimeAsync(10);
    }
    expect(send.mock.calls.length).toBeLessThanOrEqual(11);
  });

  it('reports a failed write to every caller it carried', async () => {
    const send = vi.fn().mockResolvedValueOnce(true).mockResolvedValue(false);
    const writer = createCoalescedWriter(send, 100);
    void writer.write({ a: 1 });
    const queued = writer.write({ a: 2 });
    await vi.advanceTimersByTimeAsync(100);
    await expect(queued).resolves.toBe(false);
  });

  it('flush sends what is waiting immediately', () => {
    const send = vi.fn().mockResolvedValue(true);
    const writer = createCoalescedWriter(send, 100);
    void writer.write({ a: 1 });
    void writer.write({ a: 2 });
    writer.flush();
    expect(send).toHaveBeenLastCalledWith({ a: 2 });
  });
});
