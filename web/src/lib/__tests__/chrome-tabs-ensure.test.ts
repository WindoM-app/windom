import { beforeEach, describe, expect, it, vi } from 'vitest';

const PATTERN = 'https://open.spotify.com/*';
const URL = 'https://open.spotify.com/';

const tabs = { query: vi.fn(), create: vi.fn(), update: vi.fn() };
const windows = { update: vi.fn() };

async function load() {
  vi.resetModules();
  Object.assign(globalThis.chrome, { tabs, windows, runtime: { id: 'x', sendMessage: vi.fn() } });
  // The extension's own page, not a content script.
  vi.stubGlobal('location', { ...window.location, protocol: 'chrome-extension:' });
  return import('../chrome-tabs');
}

beforeEach(() => {
  vi.clearAllMocks();
  tabs.query.mockResolvedValue([]);
});

describe('ensureTab', () => {
  it('opens the page in the background when there is no tab for it', async () => {
    const { ensureTab } = await load();

    await ensureTab(URL, PATTERN, false);

    expect(tabs.query).toHaveBeenCalledWith({ url: PATTERN });
    expect(tabs.create).toHaveBeenCalledWith({ url: URL, active: false });
  });

  it('leaves an existing tab alone when asked not to take focus', async () => {
    tabs.query.mockResolvedValue([{ id: 7, windowId: 2 }]);
    const { ensureTab } = await load();

    await ensureTab(URL, PATTERN, false);

    expect(tabs.create).not.toHaveBeenCalled();
    expect(tabs.update).not.toHaveBeenCalled();
  });

  it('brings an existing tab forward when asked to', async () => {
    tabs.query.mockResolvedValue([{ id: 7, windowId: 2 }]);
    const { ensureTab } = await load();

    await ensureTab(URL, PATTERN, true);

    expect(tabs.create).not.toHaveBeenCalled();
    expect(tabs.update).toHaveBeenCalledWith(7, { active: true });
  });
});
