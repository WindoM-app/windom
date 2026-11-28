import { isContentScript, sendToBackground } from './chrome-runtime';
import { fetchSearchTerms } from './web-search';

/** Suggested search terms: fetched here on the new tab, by the worker on web pages. */
export async function searchTerms(q: string): Promise<string[]> {
  if (!isContentScript) return fetchSearchTerms(q);
  const reply = await sendToBackground<{ terms?: string[] }>({ type: 'WINDOM_CMD_SUGGEST', query: q });
  return reply?.terms ?? [];
}
