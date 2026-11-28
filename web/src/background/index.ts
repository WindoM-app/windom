/** Background service worker - closes duplicate new tabs and answers content scripts */
import {
  isOwnExtensionSender,
  isTabId,
  parseOverlayRequest,
  parseTabCommand,
  type OverlayRequest,
} from '../lib/runtime-messages';
import { fetchSearchTerms, matchTabs } from '../lib/web-search';

/** The tab list earlier versions mirrored into storage on every tab event. */
const LEGACY_TABS_SNAPSHOT_KEY = '_windom_tabs';

// Earlier versions, on every tab event (each title, favicon and load-status change)
// queried all tabs, stored them, and sent every tab's URL and title to the
// content script on every open website. No content script read it - the tab
// sidebar is mounted only on the new tab page, which asks chrome.tabs itself -
// so it was browsing history handed to untrusted renderers for nothing. Drop
// the stored copy on update.
// chrome.storage.local holds the session token and API keys, and by default
// every content script can read it. No content script needs it, so limit it to
// extension pages and this worker. Chrome versions without the method for the
// local area keep the old behaviour.
chrome.storage.local.setAccessLevel?.({ accessLevel: 'TRUSTED_CONTEXTS' })?.catch(() => {});

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.remove(LEGACY_TABS_SNAPSHOT_KEY).catch(() => {});
});

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  // Close any older WindoM newtab in the same window when a new one loads (#47).
  // Compared exactly: a website whose path merely contains "/newtab.html" must
  // not close the user's new tabs.
  const newtabUrl = chrome.runtime.getURL('newtab.html');
  if (changeInfo.status === 'loading' && tab.url?.split(/[?#]/)[0] === newtabUrl) {
    const tabs = await chrome.tabs.query({ windowId: tab.windowId });
    for (const other of tabs) {
      if (other.id && other.id !== tabId && other.url === newtabUrl) {
        chrome.tabs.remove(other.id).catch(() => {});
      }
    }
  }
});

// Handle tab-management commands forwarded from content scripts.
// Content scripts in MV3 cannot call chrome.tabs.* directly.
chrome.runtime.onMessage.addListener((payload: unknown, sender, sendResponse) => {
  if (!isOwnExtensionSender(sender)) return;
  const message = parseTabCommand(payload);
  if (!message) return;

  const tabId = sender.tab?.id;
  if (message.type !== 'WINDOM_CMD_NEW_TAB' && message.type !== 'WINDOM_CMD_OPEN_URL' && !isTabId(tabId)) return;

  const handle = async () => {
    switch (message.type) {
      case 'WINDOM_CMD_NEW_TAB':
        await chrome.tabs.create({});
        break;
      case 'WINDOM_CMD_CLOSE_TAB':
        if (isTabId(tabId)) await chrome.tabs.remove(tabId);
        break;
      case 'WINDOM_CMD_DUPLICATE_TAB':
        if (isTabId(tabId)) await chrome.tabs.duplicate(tabId);
        break;
      case 'WINDOM_CMD_PIN_TAB':
        if (isTabId(tabId)) {
          const tab = await chrome.tabs.get(tabId);
          await chrome.tabs.update(tabId, { pinned: !tab.pinned });
        }
        break;
      case 'WINDOM_CMD_OPEN_URL':
        await chrome.tabs.create({ url: message.url });
        break;
      default:
        return; // not our message
    }
    sendResponse({ ok: true });
  };

  handle().catch(() => sendResponse({ ok: false }));
  return true; // keep channel open for async response
});

async function answerOverlay(request: OverlayRequest, sender: chrome.runtime.MessageSender): Promise<unknown> {
  switch (request.type) {
    case 'WINDOM_CMD_SUGGEST':
      return { terms: await fetchSearchTerms(request.query) };
    case 'WINDOM_CMD_QUERY_TABS': {
      // A normal window's page is never told about private tabs, nor the reverse.
      const tabs = (await chrome.tabs.query({})).filter((t) => t.incognito === sender.tab?.incognito);
      // Only what the row shows and switching needs; no favicon addresses.
      return {
        tabs: matchTabs(tabs, request.query).map(({ tabId, windowId, title, url }) => ({
          tabId,
          windowId,
          title,
          url,
        })),
      };
    }
    case 'WINDOM_CMD_FOCUS_TAB':
      await chrome.tabs.update(request.tabId, { active: true });
      if (request.windowId !== undefined) await chrome.windows.update(request.windowId, { focused: true });
      return { ok: true };
  }
}

// Requests from the search overlay on web pages. Answered only to a script
// running in a tab.
chrome.runtime.onMessage.addListener((payload: unknown, sender, sendResponse) => {
  if (!isOwnExtensionSender(sender) || !isTabId(sender.tab?.id)) return;
  const request = parseOverlayRequest(payload);
  if (!request) return;
  answerOverlay(request, sender)
    .then(sendResponse)
    .catch(() => sendResponse({ ok: false }));
  return true; // keep channel open for async response
});
