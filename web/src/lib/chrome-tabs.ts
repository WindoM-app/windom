/**
 * chrome.tabs / chrome.windows behind functions (#250), plus the tab commands
 * that take a different route from a content script (MV3 gives content
 * scripts no chrome.tabs; the background worker runs them instead).
 */
import { hasChromeApi, isContentScript, sendTabCommand, sendToBackground } from './chrome-runtime';
import { matchTabs, type TabMatch } from './web-search';

/** Whether this context can query tabs directly. */
export function canQueryTabs(): boolean {
  return hasChromeApi && !!chrome.tabs?.query;
}

export function queryTabs(query: chrome.tabs.QueryInfo = {}): Promise<chrome.tabs.Tab[]> {
  return chrome.tabs.query(query);
}

/** Calls `cb` when a tab is activated, updated or removed; returns the unsubscribe. */
export function onTabsChanged(cb: () => void): () => void {
  const onActivated = () => cb();
  const onUpdated = () => cb();
  const onRemoved = () => cb();
  chrome.tabs.onActivated?.addListener(onActivated);
  chrome.tabs.onUpdated?.addListener(onUpdated);
  chrome.tabs.onRemoved?.addListener(onRemoved);
  return () => {
    chrome.tabs.onActivated?.removeListener(onActivated);
    chrome.tabs.onUpdated?.removeListener(onUpdated);
    chrome.tabs.onRemoved?.removeListener(onRemoved);
  };
}

/** Activates a tab and, when its window is known, focuses that window. */
export function focusTab(tabId: number, windowId?: number | null): void {
  if (isContentScript) {
    void sendToBackground({ type: 'WINDOM_CMD_FOCUS_TAB', tabId, windowId: windowId ?? undefined });
    return;
  }
  chrome.tabs.update(tabId, { active: true });
  if (windowId !== null && windowId !== undefined) chrome.windows.update(windowId, { focused: true });
}

/** Open tabs matching `q`, from either context. Empty when they cannot be read. */
export async function searchOpenTabs(q: string): Promise<TabMatch[]> {
  try {
    if (!hasChromeApi) return [];
    if (isContentScript) {
      const reply = await sendToBackground<{ tabs?: TabMatch[] }>({ type: 'WINDOM_CMD_QUERY_TABS', query: q });
      return reply?.tabs ?? [];
    }
    return canQueryTabs() ? matchTabs(await queryTabs(), q) : [];
  } catch {
    return [];
  }
}

/** Opens a tab through chrome.tabs directly (extension pages only). */
export function createTab(url?: string): void {
  chrome.tabs.create(url === undefined ? {} : { url });
}

/**
 * Makes sure a tab matching `pattern` exists, opening `url` if none does. With
 * `focus` the tab is brought forward; otherwise the user stays where they are.
 */
export async function ensureTab(url: string, pattern: string, focus: boolean): Promise<void> {
  if (!canQueryTabs()) {
    window.open(url, '_blank', 'noopener');
    return;
  }
  const [existing] = await queryTabs({ url: pattern });
  if (existing?.id === undefined) await chrome.tabs.create({ url, active: focus });
  else if (focus) focusTab(existing.id, existing.windowId);
}

async function activeTab(): Promise<chrome.tabs.Tab | undefined> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

// ── Commands that work from either context ───────────────────────────────────
// Each is a no-op without the chrome API. From a content script it messages
// the background worker; on an extension page it calls chrome.tabs directly.

export function openNewTab(): void {
  if (!hasChromeApi) return;
  if (isContentScript) sendTabCommand({ type: 'WINDOM_CMD_NEW_TAB' });
  else createTab();
}

/** Outside the extension (no chrome API) this falls back to `window.open`. */
export function openUrlInNewTab(url: string): void {
  if (!hasChromeApi) {
    window.open(url, '_blank');
    return;
  }
  if (isContentScript) sendTabCommand({ type: 'WINDOM_CMD_OPEN_URL', url });
  else createTab(url);
}

export async function closeActiveTab(): Promise<void> {
  if (!hasChromeApi) return;
  if (isContentScript) {
    sendTabCommand({ type: 'WINDOM_CMD_CLOSE_TAB' });
    return;
  }
  const tab = await activeTab();
  if (tab?.id) chrome.tabs.remove(tab.id);
}

export async function duplicateActiveTab(): Promise<void> {
  if (!hasChromeApi) return;
  if (isContentScript) {
    sendTabCommand({ type: 'WINDOM_CMD_DUPLICATE_TAB' });
    return;
  }
  const tab = await activeTab();
  if (tab?.id) chrome.tabs.duplicate(tab.id);
}

export async function togglePinActiveTab(): Promise<void> {
  if (!hasChromeApi) return;
  if (isContentScript) {
    sendTabCommand({ type: 'WINDOM_CMD_PIN_TAB' });
    return;
  }
  const tab = await activeTab();
  if (tab?.id) chrome.tabs.update(tab.id, { pinned: !tab.pinned });
}
