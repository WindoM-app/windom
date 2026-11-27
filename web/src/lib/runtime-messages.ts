import { isValidUrl } from '../utils/url';

export type TabCommand =
  | { type: 'WINDOM_CMD_NEW_TAB' | 'WINDOM_CMD_CLOSE_TAB' | 'WINDOM_CMD_DUPLICATE_TAB' | 'WINDOM_CMD_PIN_TAB' }
  | { type: 'WINDOM_CMD_OPEN_URL'; url: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function isOwnExtensionSender(sender: chrome.runtime.MessageSender): boolean {
  return typeof chrome.runtime.id === 'string' && chrome.runtime.id.length > 0 && sender.id === chrome.runtime.id;
}

/** Reconstruct commands so untrusted payload fields never select target tabs. */
export function parseTabCommand(value: unknown): TabCommand | null {
  if (!isRecord(value)) return null;
  switch (value.type) {
    case 'WINDOM_CMD_NEW_TAB':
    case 'WINDOM_CMD_CLOSE_TAB':
    case 'WINDOM_CMD_DUPLICATE_TAB':
    case 'WINDOM_CMD_PIN_TAB':
      return { type: value.type };
    case 'WINDOM_CMD_OPEN_URL':
      return typeof value.url === 'string' && isValidUrl(value.url) ? { type: value.type, url: value.url } : null;
    default:
      return null;
  }
}

/**
 * What the search overlay on a web page asks the worker for (#545). Focusing is
 * the one command where the payload names the target tab: the user picked it
 * from the worker's own answer, and all it can do is bring that tab forward.
 */
export type OverlayRequest =
  | { type: 'WINDOM_CMD_SUGGEST' | 'WINDOM_CMD_QUERY_TABS'; query: string }
  | { type: 'WINDOM_CMD_FOCUS_TAB'; tabId: number; windowId?: number };

const MAX_QUERY_LENGTH = 512;

export function parseOverlayRequest(value: unknown): OverlayRequest | null {
  if (!isRecord(value)) return null;
  switch (value.type) {
    case 'WINDOM_CMD_SUGGEST':
    case 'WINDOM_CMD_QUERY_TABS': {
      // An empty query would match every tab, so it is refused rather than answered.
      const { query } = value;
      if (typeof query !== 'string' || !query.trim() || query.length > MAX_QUERY_LENGTH) return null;
      return { type: value.type, query };
    }
    case 'WINDOM_CMD_FOCUS_TAB':
      if (!isTabId(value.tabId)) return null;
      return { type: value.type, tabId: value.tabId, windowId: isTabId(value.windowId) ? value.windowId : undefined };
    default:
      return null;
  }
}

export type TabSnapshot = Pick<chrome.tabs.Tab, 'id' | 'windowId' | 'active' | 'title' | 'url' | 'favIconUrl'>;

export function isTabId(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}
