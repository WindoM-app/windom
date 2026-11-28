import { render, screen, fireEvent, act, cleanup } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { apiFetch, ensureTab, integrations } = vi.hoisted(() => ({
  apiFetch: vi.fn(),
  ensureTab: vi.fn(),
  integrations: { spotify: { connected: true } },
}));
vi.mock('../../../lib/api', () => ({ apiFetch, apiGet: vi.fn() }));
vi.mock('../../../lib/chrome-tabs', () => ({ ensureTab }));
vi.mock('../../../contexts/SettingsContext', () => ({ useSettingsSection: () => integrations }));
vi.mock('../../../hooks/useLiquidGlass', () => ({ useLiquidGlass: () => ({ current: null }) }));

import { SpotifyPlayer } from '../SpotifyPlayer';
import { SETTINGS_EVENT } from '../../../lib/settings-events';

const track = (name: string) => ({
  name,
  artist: 'The Artist',
  album: 'A',
  albumArt: null,
  durationMs: 200_000,
  url: `https://open.spotify.com/track/${name}`,
});

/** What the fake server reports, and how it answers commands (queued, then 204). */
let server: { isPlaying: boolean; progressMs: number; track: ReturnType<typeof track> | null };
let commandReplies: Array<[number, string?]>;
let pollReply: [number, string?] | null;

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });

const commands = () => apiFetch.mock.calls.map((c) => c[0] as string).filter((p) => p !== '/spotify/now-playing');
const polls = () => apiFetch.mock.calls.length - commands().length;

const advance = (ms: number) => act(() => vi.advanceTimersByTimeAsync(ms));

async function mount() {
  const view = render(<SpotifyPlayer />);
  await advance(0);
  return view;
}

const click = async (name: string) => {
  fireEvent.click(screen.getByRole('button', { name }));
  await advance(0);
};

beforeEach(() => {
  vi.useFakeTimers();
  server = { isPlaying: false, progressMs: 1000, track: track('One') };
  commandReplies = [];
  pollReply = null;
  integrations.spotify.connected = true;
  ensureTab.mockReset().mockResolvedValue(undefined);
  apiFetch.mockReset().mockImplementation((path: string) => {
    if (path === '/spotify/now-playing') {
      return Promise.resolve(pollReply ? json(pollReply[0], { code: pollReply[1] }) : json(200, server));
    }
    const [status, code] = commandReplies.shift() ?? [204];
    return Promise.resolve(status === 204 ? new Response(null, { status }) : json(status, { code }));
  });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('what is playing', () => {
  it('shows the track and artist as a link to Spotify', async () => {
    await mount();

    const link = screen.getByRole('link', { name: 'One · The Artist' });
    expect(link.getAttribute('href')).toBe('https://open.spotify.com/track/One');
  });

  it('says so when nothing is loaded', async () => {
    server = { isPlaying: false, progressMs: 0, track: null };
    await mount();

    expect(screen.getByText('Nothing playing')).toBeTruthy();
  });

  it('keeps itself current by polling, and moves on when a track ends', async () => {
    server = { isPlaying: true, progressMs: 197_000, track: track('One') };
    await mount();

    server = { isPlaying: true, progressMs: 0, track: track('Two') };
    await advance(4000);

    expect(screen.getByText('Two · The Artist')).toBeTruthy();
  });

  it('renders nothing and asks nothing when Spotify is not connected', async () => {
    integrations.spotify.connected = false;
    const { container } = await mount();

    expect(container.innerHTML).toBe('');
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it('refreshes stale state when the pointer reaches the player', async () => {
    await mount();
    await advance(5000);
    const before = polls();

    fireEvent.mouseEnter(screen.getByRole('group', { name: 'Spotify player' }));
    await advance(0);

    expect(polls()).toBe(before + 1);
  });
});

describe('controls', () => {
  it('sends one command however fast the button is clicked', async () => {
    let release!: (r: Response) => void;
    await mount();
    apiFetch.mockImplementationOnce(() => new Promise<Response>((resolve) => (release = resolve)));

    await click('Play');
    await click('Pause');
    await click('Next track');

    expect(commands()).toEqual(['/spotify/play']);
    expect(screen.getByRole('button', { name: 'Pause' }).getAttribute('aria-disabled')).toBe('true');
    await act(async () => release(new Response(null, { status: 204 })));
  });

  it('does not flip back while Spotify still reports the old state', async () => {
    await mount();

    await click('Play');
    // First re-read: Spotify has not caught up.
    await advance(500);
    expect(screen.getByRole('button', { name: 'Pause' })).toBeTruthy();

    server = { ...server, isPlaying: true };
    await advance(1000);

    expect(screen.getByRole('button', { name: 'Pause' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Open Spotify' })).toBeNull();
  });

  it('ignores a poll that was sent before the click', async () => {
    await mount();
    let release!: (r: Response) => void;
    apiFetch.mockImplementationOnce(() => new Promise<Response>((resolve) => (release = resolve)));
    await advance(10_000);

    await click('Play');
    await act(async () => release(json(200, { isPlaying: false, track: track('Old') })));

    expect(screen.getByRole('button', { name: 'Pause' })).toBeTruthy();
    expect(screen.queryByText('Old · The Artist')).toBeNull();
  });

  it('shows the next track as soon as Spotify reports it', async () => {
    await mount();

    await click('Next track');
    server = { isPlaying: true, progressMs: 0, track: track('Two') };
    await advance(500);

    expect(screen.getByText('Two · The Artist')).toBeTruthy();
  });

  it('offers to open Spotify if play was accepted but nothing started', async () => {
    await mount();

    await click('Play');
    await advance(3500);

    expect(screen.getByRole('button', { name: 'Play' })).toBeTruthy();
    expect(screen.getByRole('button', { name: /^Open Spotify/ })).toBeTruthy();
  });
});

describe('when Spotify is not open anywhere', () => {
  it('opens the web player in the background and plays once it appears', async () => {
    commandReplies = [[422, 'NO_DEVICE'], [422, 'NO_DEVICE'], [204]];
    await mount();

    await click('Play');
    expect(ensureTab).toHaveBeenCalledWith('https://open.spotify.com/', 'https://open.spotify.com/*', false);
    expect(screen.getByText('Opening Spotify…')).toBeTruthy();

    server = { ...server, isPlaying: true };
    await advance(3500);

    expect(commands()).toEqual(['/spotify/play', '/spotify/play', '/spotify/play']);
    expect(screen.getByText('One · The Artist')).toBeTruthy();
  });

  it('gives up with a button that brings Spotify forward', async () => {
    commandReplies = Array.from({ length: 11 }, () => [422, 'NO_DEVICE'] as [number, string]);
    await mount();

    await click('Play');
    await advance(16_000);
    await click('Open Spotify. Open Spotify on a device, or here in the browser.');

    expect(commands()).toHaveLength(11);
    expect(ensureTab).toHaveBeenLastCalledWith(expect.any(String), expect.any(String), true);
  });

  it('does not open a tab for next or previous', async () => {
    commandReplies = [[422, 'NO_DEVICE']];
    await mount();

    await click('Next track');

    expect(ensureTab).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: /^Open Spotify/ })).toBeTruthy();
  });

  it('stops retrying when the player goes away', async () => {
    commandReplies = Array.from({ length: 11 }, () => [422, 'NO_DEVICE'] as [number, string]);
    const { unmount } = await mount();
    await click('Play');

    unmount();
    await advance(16_000);

    expect(commands()).toHaveLength(1);
  });
});

describe('failures', () => {
  it('offers to reconnect when Spotify access has expired', async () => {
    pollReply = [401, 'RECONNECT_REQUIRED'];
    const opened = vi.fn();
    document.addEventListener(SETTINGS_EVENT.OPEN_SPOTIFY, opened);
    await mount();

    await click('Reconnect. Spotify access has expired. Reconnect it in Settings.');

    expect(opened).toHaveBeenCalled();
    document.removeEventListener(SETTINGS_EVENT.OPEN_SPOTIFY, opened);
  });

  it.each([
    [403, 'PREMIUM_REQUIRED', /^Premium required/],
    [409, 'RESTRICTED', /^Not allowed now/],
    [502, undefined, /^Spotify error/],
    [403, undefined, /^Spotify refused/],
  ])('explains a %i %s command and restores the button', async (status, code, message) => {
    commandReplies = [[status, code]];
    await mount();

    await click('Play');

    expect(screen.getByText(message)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Play' })).toBeTruthy();
  });

  it('clears a poll error once polling works again', async () => {
    pollReply = [502];
    await mount();
    expect(screen.getByText(/^Spotify error/)).toBeTruthy();

    pollReply = null;
    await advance(10_000);

    expect(screen.getByText('One · The Artist')).toBeTruthy();
  });

  it('backs off when rate limited', async () => {
    pollReply = [429, 'RATE_LIMITED'];
    await mount();

    await advance(50_000);
    expect(polls()).toBe(1);
    await advance(20_000);
    expect(polls()).toBe(2);
  });

  it('reports being offline', async () => {
    apiFetch.mockRejectedValue(new Error('Network error'));
    await mount();

    expect(screen.getByText(/^Offline/)).toBeTruthy();
  });
});
