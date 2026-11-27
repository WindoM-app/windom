/**
 * Runs on every web page, so it is only a shortcut listener: React, the
 * stylesheets and the overlay are loaded the first time it is used (#545).
 */
function onShortcut(event: KeyboardEvent): void {
  // Ctrl+Super+H, the same combination SearchOverlay listens for once mounted.
  if (!event.ctrlKey || !event.metaKey || event.key.toLowerCase() !== 'h') return;
  event.preventDefault();
  document.removeEventListener('keydown', onShortcut);
  import('./mount')
    .then(({ mount }) => mount())
    .catch(() => {
      // The extension was updated under this page, or the load failed: listen again.
      document.addEventListener('keydown', onShortcut);
    });
}

document.addEventListener('keydown', onShortcut);
