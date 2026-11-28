/**
 * Sign-in to the user's own Spotify app, kept on this device (#575). PKCE, so
 * there is no client secret, and the tokens never reach the WindoM server.
 */
import { localStore } from './chrome-storage';
import { getAuthRedirectUrl, launchWebAuth } from './oauth-connection';
import { generateCodeChallenge, generateCodeVerifier } from './pkce';
import type { SpotifyResult } from './spotify-api';
import type { SpotifyTokenSource } from './spotify-token';

export const SPOTIFY_DEVICE_KEY = 'windom_spotify';
export const SPOTIFY_DEVICE_SCOPES = [
  'user-read-currently-playing',
  'user-read-playback-state',
  'user-modify-playback-state',
  'user-top-read',
].join(' ');

const AUTHORIZE_URL = 'https://accounts.spotify.com/authorize';
const TOKEN_URL = 'https://accounts.spotify.com/api/token';
const LOCK = 'windom-spotify-token';
/** Renew this long before expiry, so a token does not lapse mid-request. */
const EXPIRY_MARGIN_MS = 60_000;
const TOKEN_TIMEOUT_MS = 10_000;

export interface SpotifyDeviceConnection {
  v: 1;
  clientId: string;
  scopes: string;
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
}

interface TokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
  error?: string;
}

export async function loadDeviceConnection(): Promise<SpotifyDeviceConnection | null> {
  const stored = await localStore.get<Partial<SpotifyDeviceConnection> | null>(SPOTIFY_DEVICE_KEY, null);
  return stored?.v === 1 && stored.clientId && stored.refreshToken ? (stored as SpotifyDeviceConnection) : null;
}

/**
 * Every read-then-write of the connection goes through one lock, shared by all
 * tabs: Spotify may rotate the refresh token, and a late write must not bring
 * back a connection that was just removed.
 */
const exclusively = <T>(work: () => Promise<T>): Promise<T> => navigator.locks.request(LOCK, work) as Promise<T>;

async function requestToken(params: Record<string, string>): Promise<{ status: number; body: TokenResponse }> {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    body: new URLSearchParams(params),
    signal: AbortSignal.timeout(TOKEN_TIMEOUT_MS),
  });
  return { status: res.status, body: (await res.json().catch(() => ({}))) as TokenResponse };
}

async function save(connection: SpotifyDeviceConnection): Promise<void> {
  if (!(await localStore.set(SPOTIFY_DEVICE_KEY, connection))) {
    throw new Error('Could not save the Spotify sign-in on this device.');
  }
}

/** Open Spotify's consent window for the user's app and keep the resulting tokens. */
export async function signInOnDevice(clientId: string): Promise<void> {
  const redirectUri = getAuthRedirectUrl();
  const verifier = generateCodeVerifier();
  const state = generateCodeVerifier();
  const params = new URLSearchParams({
    client_id: clientId,
    response_type: 'code',
    redirect_uri: redirectUri,
    scope: SPOTIFY_DEVICE_SCOPES,
    state,
    code_challenge_method: 'S256',
    code_challenge: await generateCodeChallenge(verifier),
  });

  const returned = new URL(await launchWebAuth(`${AUTHORIZE_URL}?${params}`));
  // `state` ties the answer to this request; check it before trusting anything else.
  if (returned.searchParams.get('state') !== state) throw new Error('OAuth state mismatch');
  const code = returned.searchParams.get('code');
  if (!code) {
    const error = returned.searchParams.get('error');
    throw new Error(error === 'access_denied' ? 'Auth cancelled' : (error ?? 'Spotify sent no code'));
  }

  const { status, body } = await requestToken({
    client_id: clientId,
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri,
    code_verifier: verifier,
  });
  const { access_token, refresh_token, expires_in } = body;
  if (status !== 200 || !access_token || !refresh_token || !expires_in) {
    throw new Error(body.error ?? 'Spotify did not complete the sign-in');
  }
  await exclusively(() =>
    save({
      v: 1,
      clientId,
      scopes: body.scope ?? SPOTIFY_DEVICE_SCOPES,
      accessToken: access_token,
      refreshToken: refresh_token,
      expiresAt: Date.now() + expires_in * 1000,
    }),
  );
}

async function renew(connection: SpotifyDeviceConnection): Promise<SpotifyResult<string>> {
  let answer: Awaited<ReturnType<typeof requestToken>>;
  try {
    answer = await requestToken({
      client_id: connection.clientId,
      grant_type: 'refresh_token',
      refresh_token: connection.refreshToken,
    });
  } catch {
    return { ok: false, failure: 'NETWORK' };
  }
  const { status, body } = answer;
  // Only a refused grant ends the connection; anything else may pass.
  if (body.error === 'invalid_grant') {
    await localStore.remove(SPOTIFY_DEVICE_KEY);
    return { ok: false, failure: 'RECONNECT_REQUIRED' };
  }
  if (status === 429) return { ok: false, failure: 'RATE_LIMITED' };
  if (status !== 200 || !body.access_token || !body.expires_in) return { ok: false, failure: 'API_ERROR' };

  await save({
    ...connection,
    accessToken: body.access_token,
    refreshToken: body.refresh_token ?? connection.refreshToken,
    expiresAt: Date.now() + body.expires_in * 1000,
  });
  return { ok: true, data: body.access_token };
}

export const deviceTokenSource: SpotifyTokenSource = {
  getAccessToken({ refused } = {}) {
    return exclusively(async () => {
      const connection = await loadDeviceConnection();
      if (!connection) return { ok: false, failure: 'NOT_CONNECTED' };
      // Another tab may have renewed already; then the stored token is the new one.
      const usable = connection.accessToken !== refused && Date.now() < connection.expiresAt - EXPIRY_MARGIN_MS;
      return usable ? { ok: true, data: connection.accessToken } : renew(connection);
    });
  },

  async disconnect() {
    await exclusively(() => localStore.remove(SPOTIFY_DEVICE_KEY));
  },
};
