import { waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type Listener = (m: unknown, s: chrome.runtime.MessageSender, r: (v: unknown) => void) => boolean | undefined;
const listeners: Listener[] = [];
const query = vi.fn();
const update = vi.fn();
const windowsUpdate = vi.fn();
const setAccessLevel = vi.fn();
const sender = { id: 'windom', tab: { id: 7, incognito: false } } as chrome.runtime.MessageSender;

beforeEach(async () => {
  vi.resetAllMocks();
  vi.resetModules();
  listeners.length = 0;
  for (const fn of [update, windowsUpdate, setAccessLevel]) fn.mockResolvedValue(undefined);
  vi.stubGlobal('chrome', {
    runtime: {
      id: 'windom',
      getURL: (p: string) => `chrome-extension://windom/${p}`,
      onMessage: { addListener: (l: Listener) => listeners.push(l) },
      onInstalled: { addListener: vi.fn() },
    },
    storage: { local: { remove: vi.fn(), setAccessLevel } },
    tabs: { query, update, onUpdated: { addListener: vi.fn() } },
    windows: { update: windowsUpdate },
  });
  await import('./index');
});
afterEach(() => vi.unstubAllGlobals());

const send = (message: unknown, from = sender) => {
  const respond = vi.fn();
  const kept = listeners.map((l) => l(message, from, respond));
  return { respond, handled: kept.includes(true) };
};

describe('overlay requests from web pages', () => {
  it('keeps local storage away from content scripts', () => {
    expect(setAccessLevel).toHaveBeenCalledWith({ accessLevel: 'TRUSTED_CONTEXTS' });
  });

  it('answers a tab search with matching tabs only, without favicons or private tabs', async () => {
    query.mockResolvedValue([
      { id: 1, windowId: 2, incognito: false, title: 'Docs', url: 'https://a.test/', favIconUrl: 'https://a.test/i' },
      { id: 3, windowId: 2, incognito: true, title: 'Docs private', url: 'https://b.test/' },
      { id: 4, windowId: 2, incognito: false, title: 'Other', url: 'https://c.test/' },
    ]);
    const { respond } = send({ type: 'WINDOM_CMD_QUERY_TABS', query: 'docs' });
    await waitFor(() => expect(respond).toHaveBeenCalled());
    expect(respond).toHaveBeenCalledWith({
      tabs: [{ tabId: 1, windowId: 2, title: 'Docs', url: 'https://a.test/' }],
    });
  });

  it('fetches suggestions for the page', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ json: async () => ['cat', ['cats', 'catan']] })),
    );
    const { respond } = send({ type: 'WINDOM_CMD_SUGGEST', query: 'cat' });
    await waitFor(() => expect(respond).toHaveBeenCalledWith({ terms: ['cats', 'catan'] }));
  });

  it('focuses the chosen tab and its window', async () => {
    const { respond } = send({ type: 'WINDOM_CMD_FOCUS_TAB', tabId: 4, windowId: 2 });
    await waitFor(() => expect(respond).toHaveBeenCalledWith({ ok: true }));
    expect(update).toHaveBeenCalledWith(4, { active: true });
    expect(windowsUpdate).toHaveBeenCalledWith(2, { focused: true });
  });

  it.each([
    { type: 'WINDOM_CMD_QUERY_TABS', query: '' },
    { type: 'WINDOM_CMD_QUERY_TABS', query: '   ' },
    { type: 'WINDOM_CMD_QUERY_TABS' },
    { type: 'WINDOM_CMD_SUGGEST', query: 'x'.repeat(513) },
    { type: 'WINDOM_CMD_FOCUS_TAB', tabId: '4' },
  ])('refuses %j', (message) => {
    expect(send(message).handled).toBe(false);
    expect(query).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });

  it.each([{ id: 'other', tab: { id: 1 } }, { id: 'windom' }])('refuses sender %j', (from) => {
    const message = { type: 'WINDOM_CMD_QUERY_TABS', query: 'a' };
    expect(send(message, from as chrome.runtime.MessageSender).handled).toBe(false);
    expect(query).not.toHaveBeenCalled();
  });
});
