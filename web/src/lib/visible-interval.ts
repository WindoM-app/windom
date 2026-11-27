/**
 * setInterval for network polling that rests while the page is hidden, so a
 * stack of background new tabs does not keep calling the backend (#547).
 *
 * A tick that falls due while hidden is skipped, and one catch-up call runs as
 * soon as the page is shown. Switching back before a tick was due calls nothing,
 * so flicking between tabs cannot spend a rate limit. Returns the stop function.
 */
export function startVisibleInterval(callback: () => void, ms: number): () => void {
  let missed = false;
  const id = setInterval(() => {
    if (document.hidden) missed = true;
    else callback();
  }, ms);
  const onVisibilityChange = () => {
    if (document.hidden || !missed) return;
    missed = false;
    callback();
  };
  document.addEventListener('visibilitychange', onVisibilityChange);
  return () => {
    clearInterval(id);
    document.removeEventListener('visibilitychange', onVisibilityChange);
  };
}
