import { eq, and, desc } from 'drizzle-orm';
import { db } from '../db/client.js';
import { oauthAccounts } from '../db/schema.js';
import { getValidAccessToken } from './token-refresh.service.js';
import { spotifyPkceRefreshStrategy, spotifySharedAppRefreshStrategy } from './token-refresh.strategies.js';
import { config } from '../config.js';
import { SPOTIFY_API, MAX_TOP_TRACKS, DEFAULT_TOP_TRACKS } from '../types/constants.js';
import type { Result } from '../types/auth.types.js';
import type { OAuthError } from '../types/oauth.types.js';
import { fetchWithTimeout } from '../lib/external-fetch.js';

export type SpotifyError =
  OAuthError | 'NOT_CONNECTED' | 'NO_DEVICE' | 'PREMIUM_REQUIRED' | 'RESTRICTED' | 'RATE_LIMITED';

export type PlaybackCommand = 'play' | 'pause' | 'next' | 'previous';

export const VALID_TIME_RANGES = ['short_term', 'medium_term', 'long_term'] as const;
export type TimeRange = (typeof VALID_TIME_RANGES)[number];

export interface SpotifyTrack {
  name: string;
  artist: string;
  album: string;
  albumArt: string | null;
  durationMs: number;
  url: string;
}

export interface NowPlayingResult {
  isPlaying: boolean;
  progressMs?: number;
  track: SpotifyTrack | null;
}

interface RawSpotifyTrack {
  name: string;
  artists: Array<{ name: string }>;
  album: { name: string; images: Array<{ url: string }> };
  /** Missing for local files. */
  external_urls?: { spotify?: string };
  duration_ms: number;
}

/** A podcast episode; only returned when `additional_types=episode` is asked for. */
interface RawSpotifyEpisode {
  type: 'episode';
  name: string;
  show?: { name: string; images?: Array<{ url: string }> };
  images?: Array<{ url: string }>;
  external_urls?: { spotify?: string };
  duration_ms: number;
}

interface SpotifyNowPlayingResponse {
  is_playing: boolean;
  progress_ms: number;
  item: RawSpotifyTrack | RawSpotifyEpisode | null;
}

interface SpotifyTopTracksResponse {
  items: RawSpotifyTrack[];
}

interface SpotifyDevice {
  id: string | null;
  is_active?: boolean;
  /** Spotify accepts no Web API commands for a restricted device. */
  is_restricted?: boolean;
}

interface SpotifyPlayerState {
  is_playing?: boolean;
  device?: SpotifyDevice;
}

interface SpotifyDevicesResponse {
  devices: SpotifyDevice[];
}

const COMMAND_CONFIG: Record<PlaybackCommand, { method: 'PUT' | 'POST'; endpoint: string }> = {
  play: { method: 'PUT', endpoint: '/me/player/play' },
  pause: { method: 'PUT', endpoint: '/me/player/pause' },
  next: { method: 'POST', endpoint: '/me/player/next' },
  previous: { method: 'POST', endpoint: '/me/player/previous' },
};

function normalizeTrack(item: RawSpotifyTrack): SpotifyTrack {
  return {
    name: item.name,
    artist: item.artists.map((a) => a.name).join(', '),
    album: item.album.name,
    albumArt: item.album.images[0]?.url ?? null,
    durationMs: item.duration_ms,
    url: item.external_urls?.spotify ?? '',
  };
}

function normalizeItem(item: RawSpotifyTrack | RawSpotifyEpisode): SpotifyTrack {
  if (!('type' in item) || item.type !== 'episode') return normalizeTrack(item as RawSpotifyTrack);
  const show = item.show?.name ?? '';
  return {
    name: item.name,
    artist: show,
    album: show,
    albumArt: item.images?.[0]?.url ?? item.show?.images?.[0]?.url ?? null,
    durationMs: item.duration_ms,
    url: item.external_urls?.spotify ?? '',
  };
}

/** The failures every Spotify endpoint shares. */
function errorForStatus(status: number): SpotifyError {
  if (status === 401) return 'TOKEN_REFRESH_REVOKED';
  if (status === 403) return 'FORBIDDEN';
  if (status === 429) return 'RATE_LIMITED';
  return 'API_ERROR';
}

/** A Spotify call that answers null, rather than throwing, when the network fails. */
async function spotifyFetch(token: string, path: string, init: RequestInit = {}): Promise<Response | null> {
  try {
    return await fetchWithTimeout(`${SPOTIFY_API}${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${token}`, ...(init.body ? { 'Content-Type': 'application/json' } : {}) },
    });
  } catch {
    return null;
  }
}

async function getSpotifyToken(userId: string): Promise<Result<string, SpotifyError>> {
  const [account] = await db
    .select()
    .from(oauthAccounts)
    .where(and(eq(oauthAccounts.userId, userId), eq(oauthAccounts.provider, 'spotify')))
    // Linking a second Spotify account adds a row; the newest link is the one meant.
    .orderBy(desc(oauthAccounts.updatedAt))
    .limit(1);

  if (!account) return { ok: false, error: 'NOT_CONNECTED' };

  // PKCE (BYOA) mode: use the user's own client_id in the token body - no shared Authorization header.
  // Legacy mode: use the shared app's Basic auth header.
  const strategy = account.providerClientId
    ? spotifyPkceRefreshStrategy(account.providerClientId)
    : spotifySharedAppRefreshStrategy({
        clientId: config.SPOTIFY_CLIENT_ID,
        clientSecret: config.SPOTIFY_CLIENT_SECRET,
      });
  const tokenResult = await getValidAccessToken(account, strategy);

  if (!tokenResult.ok) return { ok: false, error: tokenResult.error };
  return { ok: true, data: tokenResult.data };
}

/** The device a command should target: the active one, else the first that takes commands. */
async function resolveDevice(token: string): Promise<Result<{ id: string; isActive: boolean }, SpotifyError>> {
  const playerRes = await spotifyFetch(token, '/me/player');
  if (!playerRes) return { ok: false, error: 'API_ERROR' };
  if (playerRes.ok && playerRes.status !== 204) {
    const { device } = (await playerRes.json()) as SpotifyPlayerState;
    if (device?.id && !device.is_restricted) return { ok: true, data: { id: device.id, isActive: true } };
  }

  const devicesRes = await spotifyFetch(token, '/me/player/devices');
  if (!devicesRes) return { ok: false, error: 'API_ERROR' };
  if (!devicesRes.ok) return { ok: false, error: errorForStatus(devicesRes.status) };

  const { devices } = (await devicesRes.json()) as SpotifyDevicesResponse;
  const usable = devices.filter((d): d is SpotifyDevice & { id: string } => !!d.id && !d.is_restricted);
  const device = usable.find((d) => d.is_active) ?? usable[0];
  if (!device) return { ok: false, error: devices.length ? 'RESTRICTED' : 'NO_DEVICE' };
  return { ok: true, data: { id: device.id, isActive: device.is_active === true } };
}

/**
 * Why Spotify answered a command with 403. It uses the status both for accounts
 * without Premium and for commands that do not fit the current state, such as
 * pausing what is already paused - which is not a failure for the user.
 */
async function explainForbidden(
  token: string,
  command: PlaybackCommand,
  res: Response,
): Promise<Result<void, SpotifyError>> {
  const body = (await res.json().catch(() => null)) as { error?: { reason?: string; message?: string } } | null;
  const detail = `${body?.error?.reason ?? ''} ${body?.error?.message ?? ''}`;
  if (/premium/i.test(detail)) return { ok: false, error: 'PREMIUM_REQUIRED' };

  if (command === 'play' || command === 'pause') {
    const stateRes = await spotifyFetch(token, '/me/player');
    if (stateRes?.ok && stateRes.status !== 204) {
      const state = (await stateRes.json()) as SpotifyPlayerState;
      if (state.is_playing === (command === 'play')) return { ok: true, data: undefined };
    }
  }
  return { ok: false, error: /restriction/i.test(detail) ? 'RESTRICTED' : 'FORBIDDEN' };
}

// Short: it only has to absorb several tabs polling at once.
const NOW_PLAYING_TTL_MS = 5_000;
/**
 * After a command Spotify keeps reporting the previous state for a moment, so
 * nothing read in this window is worth keeping.
 */
const COMMAND_SETTLE_MS = 5_000;
const nowPlayingCache = new Map<string, { data: Result<NowPlayingResult, SpotifyError>; expiresAt: number }>();
const settlingUntil = new Map<string, number>();

function cacheNowPlaying(userId: string, data: NowPlayingResult): Result<NowPlayingResult, SpotifyError> {
  const result: Result<NowPlayingResult, SpotifyError> = { ok: true, data };
  const until = settlingUntil.get(userId) ?? 0;
  if (Date.now() >= until) {
    settlingUntil.delete(userId);
    nowPlayingCache.set(userId, { data: result, expiresAt: Date.now() + NOW_PLAYING_TTL_MS });
  }
  return result;
}

export async function getNowPlaying(userId: string): Promise<Result<NowPlayingResult, SpotifyError>> {
  const cached = nowPlayingCache.get(userId);
  if (cached && Date.now() < cached.expiresAt) return cached.data;

  const tokenResult = await getSpotifyToken(userId);
  if (!tokenResult.ok) return { ok: false, error: tokenResult.error };
  const token = tokenResult.data;

  const res = await spotifyFetch(token, '/me/player/currently-playing?additional_types=episode');
  if (!res) return { ok: false, error: 'API_ERROR' };

  if (res.status === 204) return cacheNowPlaying(userId, { isPlaying: false, track: null });
  if (!res.ok) return { ok: false, error: errorForStatus(res.status) };

  const data = (await res.json()) as SpotifyNowPlayingResponse;
  // An advert has no item but is still playing.
  if (!data.item) return cacheNowPlaying(userId, { isPlaying: data.is_playing === true, track: null });

  return cacheNowPlaying(userId, {
    isPlaying: data.is_playing,
    progressMs: data.progress_ms ?? 0,
    track: normalizeItem(data.item),
  });
}

/** Invalidate the now-playing cache for a user (e.g. on disconnect). */
export function invalidateNowPlayingCache(userId: string): void {
  nowPlayingCache.delete(userId);
}

/** Clear the entire now-playing cache. Only intended for use in tests. */
export function clearNowPlayingCacheForTest(): void {
  nowPlayingCache.clear();
  settlingUntil.clear();
}

export async function getTopTracks(
  userId: string,
  limit: number,
  timeRange: string,
): Promise<Result<SpotifyTrack[], SpotifyError>> {
  const tokenResult = await getSpotifyToken(userId);
  if (!tokenResult.ok) return { ok: false, error: tokenResult.error };
  const token = tokenResult.data;

  const safeLimit = Math.min(MAX_TOP_TRACKS, Math.max(1, limit || DEFAULT_TOP_TRACKS));
  const safeRange: TimeRange = VALID_TIME_RANGES.includes(timeRange as TimeRange)
    ? (timeRange as TimeRange)
    : 'short_term';

  const params = new URLSearchParams({ limit: String(safeLimit), time_range: safeRange });
  const res = await spotifyFetch(token, `/me/top/tracks?${params}`);
  if (!res) return { ok: false, error: 'API_ERROR' };
  if (!res.ok) return { ok: false, error: errorForStatus(res.status) };

  const data = (await res.json()) as SpotifyTopTracksResponse;
  return { ok: true, data: (data.items ?? []).map(normalizeTrack) };
}

export async function sendPlaybackCommand(
  userId: string,
  command: PlaybackCommand,
): Promise<Result<void, SpotifyError>> {
  const tokenResult = await getSpotifyToken(userId);
  if (!tokenResult.ok) return { ok: false, error: tokenResult.error };
  const token = tokenResult.data;

  const device = await resolveDevice(token);
  if (!device.ok) return device;
  const { id, isActive } = device.data;

  // An idle device has nothing to resume; transferring playback to it does.
  const { method, endpoint } = COMMAND_CONFIG[command];
  const res =
    command === 'play' && !isActive
      ? await spotifyFetch(token, '/me/player', {
          method: 'PUT',
          body: JSON.stringify({ device_ids: [id], play: true }),
        })
      : await spotifyFetch(token, `${endpoint}?device_id=${encodeURIComponent(id)}`, { method });
  if (!res) return { ok: false, error: 'API_ERROR' };

  if (!res.ok) {
    if (res.status === 403) return explainForbidden(token, command, res);
    // 404 is Spotify's "no active device": it vanished between lookup and command.
    return { ok: false, error: res.status === 404 ? 'NO_DEVICE' : errorForStatus(res.status) };
  }

  // The command just made every cached answer wrong.
  invalidateNowPlayingCache(userId);
  settlingUntil.set(userId, Date.now() + COMMAND_SETTLE_MS);
  return { ok: true, data: undefined };
}
