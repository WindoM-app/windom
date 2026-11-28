/**
 * chrome.storage.sync refuses writes past 120 a minute (1800 an hour), which a
 * text field or a slider reaches in seconds. The first write goes out at once;
 * writes arriving within `intervalMs` of it are merged and sent together.
 */
type Values = Record<string, unknown>;

export interface CoalescedWriter {
  /** Resolves with the outcome of the write that carries these values. */
  write: (values: Values) => Promise<boolean>;
  /** Send anything still waiting now (the page is going away). */
  flush: () => void;
}

// 600ms keeps continuous input at 100 writes a minute.
export function createCoalescedWriter(send: (values: Values) => Promise<boolean>, intervalMs = 600): CoalescedWriter {
  let pending: Values | null = null;
  let waiting: Array<(ok: boolean) => void> = [];
  let cooldown: ReturnType<typeof setTimeout> | null = null;

  const startCooldown = () => {
    cooldown = setTimeout(() => {
      cooldown = null;
      flush();
    }, intervalMs);
  };

  const flush = () => {
    if (!pending) return;
    const values = pending;
    const resolvers = waiting;
    pending = null;
    waiting = [];
    if (cooldown) clearTimeout(cooldown);
    startCooldown();
    void send(values).then((ok) => resolvers.forEach((resolve) => resolve(ok)));
  };

  const write = (values: Values) => {
    if (!cooldown) {
      startCooldown();
      return send(values);
    }
    pending = { ...pending, ...values };
    return new Promise<boolean>((resolve) => waiting.push(resolve));
  };

  return { write, flush };
}
