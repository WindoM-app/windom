import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { store, launchWebAuth } = vi.hoisted(() => ({ store: new Map<string, unknown>(), launchWebAuth: vi.fn() }));
vi.mock('../chrome-storage', () => ({
  localStore: {
    get: async (key: string, fallback: unknown) => store.get(key) ?? fallback,
    set: async (key: string, value: unknown) => (store.set(key, value), true),
    remove: async (key: string) => (store.delete(key), true),
  },
}));
vi.mock('../oauth-connection', () => ({
  getAuthRedirectUrl: () => 'https://ext.chromiumapp.org/',
  launchWebAuth,
}));

import { SPOTIFY_DEVICE_KEY, deviceTokenSource, signInOnDevice } from '../spotify-device';

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });
const fetchMock = vi.fn();
const sent = (call = 0) => Object.fromEntries(fetchMock.mock.calls[call][1].body as URLSearchParams);

const connection = (over: Record<string, unknown> = {}) => ({
  v: 1,
  clientId: 'app',
  scopes: 's',
  accessToken: 'old-access',
  refreshToken: 'old-refresh',
  expiresAt: Date.now() + 3_600_000,
  ...over,
});

/** One queue per lock, as the browser's lock manager behaves for a single name. */
function fakeLocks() {
  let tail: Promise<unknown> = Promise.resolve();
  return {
    request: (_name: string, work: () => Promise<unknown>) => {
      const next = tail.then(work);
      tail = next.catch(() => undefined);
      return next;
    },
  };
}

/** Spotify's consent window, answering with the state it was given. */
const consent = (answer: (state: string) => string) =>
  launchWebAuth.mockImplementation(async (url: string) => {
    const state = new URL(url).searchParams.get('state')!;
    return `https://ext.chromiumapp.org/?${answer(state)}`;
  });

beforeEach(() => {
  store.clear();
  launchWebAuth.mockReset();
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  Object.defineProperty(navigator, 'locks', { value: fakeLocks(), configurable: true });
});
afterEach(() => vi.unstubAllGlobals());

describe('signInOnDevice', () => {
  it('uses PKCE with the user app and keeps the tokens on the device', async () => {
    consent((state) => `code=abc&state=${state}`);
    fetchMock.mockResolvedValue(json(200, { access_token: 'a', refresh_token: 'r', expires_in: 3600, scope: 'x' }));

    await signInOnDevice('app');

    const url = new URL(launchWebAuth.mock.calls[0][0] as string);
    expect(url.origin + url.pathname).toBe('https://accounts.spotify.com/authorize');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(fetchMock.mock.calls[0][0]).toBe('https://accounts.spotify.com/api/token');
    expect(sent()).toMatchObject({ client_id: 'app', grant_type: 'authorization_code', code: 'abc' });
    expect(sent()).not.toHaveProperty('client_secret');
    expect(store.get(SPOTIFY_DEVICE_KEY)).toMatchObject({ clientId: 'app', accessToken: 'a', refreshToken: 'r' });
  });

  it('refuses an answer with the wrong state, before asking for tokens', async () => {
    consent(() => 'code=abc&state=forged');
    await expect(signInOnDevice('app')).rejects.toThrow('state mismatch');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(store.size).toBe(0);
  });

  it('reports a refused consent as a cancel', async () => {
    consent((state) => `error=access_denied&state=${state}`);
    await expect(signInOnDevice('app')).rejects.toThrow('cancelled');
  });

  it('stores nothing when the exchange fails', async () => {
    consent((state) => `code=abc&state=${state}`);
    fetchMock.mockResolvedValue(json(400, { error: 'invalid_client' }));
    await expect(signInOnDevice('app')).rejects.toThrow('invalid_client');
    expect(store.size).toBe(0);
  });
});

describe('deviceTokenSource', () => {
  it('answers from storage while the token is valid', async () => {
    store.set(SPOTIFY_DEVICE_KEY, connection());
    expect(await deviceTokenSource.getAccessToken()).toEqual({ ok: true, data: 'old-access' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('says so when nothing is connected', async () => {
    expect(await deviceTokenSource.getAccessToken()).toEqual({ ok: false, failure: 'NOT_CONNECTED' });
  });

  it('renews once when two callers find the token expired, keeping the rotated token', async () => {
    store.set(SPOTIFY_DEVICE_KEY, connection({ expiresAt: 0 }));
    fetchMock.mockResolvedValue(json(200, { access_token: 'new', refresh_token: 'rotated', expires_in: 3600 }));

    const both = await Promise.all([deviceTokenSource.getAccessToken(), deviceTokenSource.getAccessToken()]);

    expect(both).toEqual([
      { ok: true, data: 'new' },
      { ok: true, data: 'new' },
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(store.get(SPOTIFY_DEVICE_KEY)).toMatchObject({ refreshToken: 'rotated' });
  });

  it('keeps the old refresh token when Spotify sends none', async () => {
    store.set(SPOTIFY_DEVICE_KEY, connection({ expiresAt: 0 }));
    fetchMock.mockResolvedValue(json(200, { access_token: 'new', expires_in: 3600 }));
    await deviceTokenSource.getAccessToken();
    expect(store.get(SPOTIFY_DEVICE_KEY)).toMatchObject({ refreshToken: 'old-refresh' });
  });

  it('renews a token Spotify refused even if it looks valid', async () => {
    store.set(SPOTIFY_DEVICE_KEY, connection());
    fetchMock.mockResolvedValue(json(200, { access_token: 'new', expires_in: 3600 }));
    expect(await deviceTokenSource.getAccessToken({ refused: 'old-access' })).toEqual({ ok: true, data: 'new' });
  });

  it('forgets the connection only when the grant is refused', async () => {
    store.set(SPOTIFY_DEVICE_KEY, connection({ expiresAt: 0 }));
    fetchMock.mockResolvedValueOnce(json(500, {}));
    expect(await deviceTokenSource.getAccessToken()).toEqual({ ok: false, failure: 'API_ERROR' });
    fetchMock.mockRejectedValueOnce(new TypeError('offline'));
    expect(await deviceTokenSource.getAccessToken()).toEqual({ ok: false, failure: 'NETWORK' });
    expect(store.has(SPOTIFY_DEVICE_KEY)).toBe(true);

    fetchMock.mockResolvedValueOnce(json(400, { error: 'invalid_grant' }));
    expect(await deviceTokenSource.getAccessToken()).toEqual({ ok: false, failure: 'RECONNECT_REQUIRED' });
    expect(store.has(SPOTIFY_DEVICE_KEY)).toBe(false);
  });

  it('stays disconnected when a renewal was already under way', async () => {
    store.set(SPOTIFY_DEVICE_KEY, connection({ expiresAt: 0 }));
    fetchMock.mockResolvedValue(json(200, { access_token: 'new', expires_in: 3600 }));
    await Promise.all([deviceTokenSource.getAccessToken(), deviceTokenSource.disconnect()]);
    expect(store.has(SPOTIFY_DEVICE_KEY)).toBe(false);
  });
});
