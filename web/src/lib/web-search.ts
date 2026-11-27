/**
 * Search suggestions and open-tab matching, shared by the overlay on the new
 * tab and by the background worker, which runs both for the overlay on web
 * pages: a content script's fetch follows the page's CORS and it has no
 * chrome.tabs (#545).
 */
import { SEARCH_API_TIMEOUT_MS } from './timing-constants';

const MAX_TERMS = 5;
const MAX_TABS = 3;

export interface TabMatch {
  tabId?: number;
  windowId?: number;
  title: string;
  url?: string;
  favicon?: string;
}

export async function fetchSearchTerms(q: string): Promise<string[]> {
  try {
    const res = await fetch(`https://duckduckgo.com/ac/?q=${encodeURIComponent(q)}&type=list`, {
      signal: AbortSignal.timeout(SEARCH_API_TIMEOUT_MS),
    });
    const data = (await res.json()) as unknown;

    let terms: string[] = [];

    if (Array.isArray(data) && Array.isArray((data as unknown[])[1])) {
      terms = ((data as unknown[])[1] as unknown[]).filter((t): t is string => typeof t === 'string');
    } else if (Array.isArray(data) && typeof (data as { phrase?: string }[])[0]?.phrase === 'string') {
      terms = (data as { phrase: string }[]).map((d) => d.phrase).filter(Boolean);
    }

    return terms.slice(0, MAX_TERMS);
  } catch {
    // Suggestions are optional: offline, a timeout or a changed response shape
    // all mean "no suggestions".
    return [];
  }
}

export function matchTabs(tabs: chrome.tabs.Tab[], q: string): TabMatch[] {
  const lower = q.toLowerCase();
  return tabs
    .filter((t) => {
      if (t.url?.startsWith('chrome://') || t.url?.startsWith('chrome-extension://')) return false;
      const urlMatch = t.url?.toLowerCase().includes(lower) ?? false;
      const titleMatch = t.title?.toLowerCase().includes(lower) ?? false;
      return urlMatch || titleMatch;
    })
    .slice(0, MAX_TABS)
    .map((t) => ({
      tabId: t.id,
      windowId: t.windowId,
      title: t.title || t.url || '',
      url: t.url,
      favicon: t.favIconUrl || undefined,
    }));
}
