/** The WindoM server's Spotify endpoints, with failures as values the UI can branch on. */
import { apiFetch } from './api';
import { ensureTab } from './chrome-tabs';

export interface SpotifyTrack {
  name: string;
  artist: string;
  album: string;
  albumArt: string | null;
  durationMs: number;
  /** Empty for local files, which have no page. */
  url: string;
}

export interface NowPlaying {
  isPlaying: boolean;
  progressMs: number;
  /** Null when nothing is loaded, and during adverts. */
  track: SpotifyTrack | null;
}

export type PlaybackAction = 'play' | 'pause' | 'next' | 'previous';

/**
 * `short` fits the dock; `long` is the tooltip. SESSION is our own sign-in,
 * RECONNECT_REQUIRED is Spotify's.
 */
export const SPOTIFY_FAILURES = {
  NO_DEVICE: { short: 'No Spotify device', long: 'Open Spotify on a device, or here in the browser.' },
  RECONNECT_REQUIRED: {
    short: 'Spotify signed out',
    long: 'Spotify access has expired. Reconnect it in Settings.',
  },
  NOT_CONNECTED: { short: 'Not connected', long: 'Connect Spotify again in Settings.' },
  PREMIUM_REQUIRED: { short: 'Premium required', long: 'Spotify Premium is required for playback control.' },
  FORBIDDEN: {
    short: 'Spotify refused',
    long: 'Playback control needs Spotify Premium, and your account must be allowed to use your Spotify app.',
  },
  RESTRICTED: { short: 'Not allowed now', long: 'Spotify does not allow that on this device right now.' },
  RATE_LIMITED: { short: 'Spotify is busy', long: 'Too many requests. Try again in a minute.' },
  SESSION: { short: 'Signed out', long: 'Sign in again in Settings, under Account.' },
  NETWORK: { short: 'Offline', long: 'Could not reach the server. Check your connection.' },
  API_ERROR: { short: 'Spotify error', long: 'Spotify did not answer. Try again.' },
} as const;

export type SpotifyFailure = keyof typeof SPOTIFY_FAILURES;
export type SpotifyResult<T> = { ok: true; data: T } | { ok: false; failure: SpotifyFailure };

/** For a server that sends no `code`. */
const FAILURE_BY_STATUS: Record<number, SpotifyFailure> = {
  401: 'SESSION',
  403: 'FORBIDDEN',
  404: 'NOT_CONNECTED',
  409: 'RESTRICTED',
  422: 'NO_DEVICE',
  429: 'RATE_LIMITED',
};

async function request(path: string, options?: RequestInit): Promise<SpotifyResult<Response>> {
  let res: Response;
  try {
    res = await apiFetch(path, options);
  } catch {
    return { ok: false, failure: 'NETWORK' };
  }
  if (res.ok) return { ok: true, data: res };
  const { code } = (await res.json().catch(() => ({}))) as { code?: string };
  const known = code !== undefined && Object.prototype.hasOwnProperty.call(SPOTIFY_FAILURES, code);
  return {
    ok: false,
    failure: known ? (code as SpotifyFailure) : (FAILURE_BY_STATUS[res.status] ?? 'API_ERROR'),
  };
}

export async function fetchNowPlaying(): Promise<SpotifyResult<NowPlaying>> {
  const result = await request('/spotify/now-playing');
  if (!result.ok) return result;
  try {
    const body = (await result.data.json()) as Partial<NowPlaying>;
    return {
      ok: true,
      data: { isPlaying: body.isPlaying === true, progressMs: body.progressMs ?? 0, track: body.track ?? null },
    };
  } catch {
    return { ok: false, failure: 'API_ERROR' };
  }
}

export async function sendPlaybackCommand(action: PlaybackAction): Promise<SpotifyResult<null>> {
  const result = await request(`/spotify/${action}`, { method: 'POST' });
  return result.ok ? { ok: true, data: null } : result;
}

/** Spotify's web player registers the browser as a device once it has loaded. */
export function openSpotifyWebPlayer({ focus }: { focus: boolean }): Promise<void> {
  return ensureTab('https://open.spotify.com/', 'https://open.spotify.com/*', focus);
}
