/** The hosted page in `player/`, run against a stand-in for its window and Spotify's SDK. */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import source from '../../../player/player.js?raw';
import headers from '../../../player/_headers?raw';

const EXTENSION = 'chrome-extension://comcnbccalbfcegbmaemancbhgpijkpb';

type Listener = (payload?: unknown) => void;

function load({ framed = true } = {}) {
  const listeners = new Map<string, Listener>();
  const sdk = { options: null as null | { getOAuthToken: (cb: Listener) => void }, disconnect: vi.fn(), created: 0 };
  const parent = { postMessage: vi.fn() };
  let onMessage: (event: unknown) => void = () => {};
  const page = {
    parent: parent as unknown,
    onSpotifyWebPlaybackSDKReady: undefined as undefined | (() => void),
    addEventListener: (_: string, handler: (event: unknown) => void) => (onMessage = handler),
    Spotify: {
      Player: class {
        constructor(options: NonNullable<typeof sdk.options>) {
          sdk.options = options;
          sdk.created++;
        }
        addListener = (name: string, handler: Listener) => listeners.set(name, handler);
        connect = () => Promise.resolve(true);
        disconnect = sdk.disconnect;
      },
    },
  };
  if (!framed) page.parent = page;
  new Function('window', source)(page);

  const receive = (data: unknown, over: Record<string, unknown> = {}) =>
    onMessage({ origin: EXTENSION, source: parent, data, ...over });
  const posted = () => parent.postMessage.mock.calls.map((c) => c[0] as { type: string });
  return { page, parent, sdk, listeners, receive, posted };
}

let t: ReturnType<typeof load>;
const ready = () => {
  t.page.onSpotifyWebPlaybackSDKReady!();
  t.receive({ type: 'init' });
};

beforeEach(() => {
  t = load();
});

describe('Spotify player page', () => {
  it('does nothing when opened directly', () => {
    expect(load({ framed: false }).page.onSpotifyWebPlaybackSDKReady).toBeUndefined();
  });

  it('addresses every message to the extension only', () => {
    ready();
    t.listeners.get('ready')!({ device_id: 'd1' });
    expect(t.parent.postMessage.mock.calls.every((c) => c[1] === EXTENSION)).toBe(true);
    expect(t.posted()).toContainEqual({ type: 'ready', deviceId: 'd1' });
  });

  it('waits for both the SDK and the extension, and creates one player', () => {
    t.receive({ type: 'init' });
    expect(t.sdk.created).toBe(0);
    t.page.onSpotifyWebPlaybackSDKReady!();
    t.receive({ type: 'init' });
    expect(t.sdk.created).toBe(1);
  });

  it.each([
    ['another origin', { origin: 'https://evil.example' }],
    ['another window', { source: {} }],
  ])('ignores %s', (_, over) => {
    t.page.onSpotifyWebPlaybackSDKReady!();
    t.receive({ type: 'init' }, over);
    expect(t.sdk.created).toBe(0);
  });

  it('hands a token to the SDK once, and keeps none for later requests', () => {
    ready();
    const first = vi.fn();
    t.sdk.options!.getOAuthToken(first);
    expect(t.posted()).toContainEqual({ type: 'token-request' });
    t.receive({ type: 'token', token: 'abc' });
    t.receive({ type: 'token', token: 'def' });
    expect(first).toHaveBeenCalledExactlyOnceWith('abc');
    const second = vi.fn();
    t.sdk.options!.getOAuthToken(second);
    expect(second).not.toHaveBeenCalled();
  });

  it('reports where playback is, and errors by kind', () => {
    ready();
    t.listeners.get('player_state_changed')!({
      paused: true,
      position: 42,
      context: { uri: 'spotify:playlist:p' },
      track_window: { current_track: { uri: 'spotify:track:t' } },
    });
    t.listeners.get('account_error')!({ message: 'Premium required' });
    expect(t.posted()).toContainEqual({
      type: 'state',
      idle: false,
      paused: true,
      positionMs: 42,
      trackUri: 'spotify:track:t',
      contextUri: 'spotify:playlist:p',
    });
    expect(t.posted()).toContainEqual({ type: 'error', kind: 'account', message: 'Premium required' });
  });

  it('disconnects on request', () => {
    ready();
    t.receive({ type: 'disconnect' });
    expect(t.sdk.disconnect).toHaveBeenCalled();
  });

  it('allows framing by the same extension it talks to', () => {
    expect(headers).toContain(`frame-ancestors ${EXTENSION}`);
    expect(headers).toContain("default-src 'none'");
  });
});
