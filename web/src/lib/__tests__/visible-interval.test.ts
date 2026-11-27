import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { startVisibleInterval } from '../visible-interval';

let hidden = false;
const show = (visible: boolean) => {
  hidden = !visible;
  document.dispatchEvent(new Event('visibilitychange'));
};

beforeEach(() => {
  hidden = false;
  vi.useFakeTimers();
  vi.spyOn(document, 'hidden', 'get').mockImplementation(() => hidden);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('startVisibleInterval', () => {
  it('ticks while visible and rests while hidden, catching up once', () => {
    const fn = vi.fn();
    const stop = startVisibleInterval(fn, 1000);
    vi.advanceTimersByTime(2000);
    expect(fn).toHaveBeenCalledTimes(2);
    show(false);
    vi.advanceTimersByTime(10_000);
    expect(fn).toHaveBeenCalledTimes(2);
    show(true);
    expect(fn).toHaveBeenCalledTimes(3);
    stop();
  });

  it('calls nothing on return when no tick was due', () => {
    const fn = vi.fn();
    const stop = startVisibleInterval(fn, 1000);
    show(false);
    vi.advanceTimersByTime(500);
    show(true);
    expect(fn).not.toHaveBeenCalled();
    stop();
  });

  it('does nothing after stop', () => {
    const fn = vi.fn();
    const stop = startVisibleInterval(fn, 1000);
    show(false);
    vi.advanceTimersByTime(1000);
    stop();
    show(true);
    vi.advanceTimersByTime(5000);
    expect(fn).not.toHaveBeenCalled();
  });
});
