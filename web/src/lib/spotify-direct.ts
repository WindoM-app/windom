/**
 * The Spotify Web API called from the extension (#575). Same result shapes as
 * `spotify-api.ts`, which goes through the WindoM server; the device and command
 * handling follows the server's `spotify.service.ts`.
 */
import type { NowPlaying, PlaybackAction, SpotifyFailure, SpotifyResult, SpotifyTrack } from './spotify-api';
import type { SpotifyTokenSource } from './spotify-token';

const API = 'https://api.spotify.com/v1';
const TIMEOUT_MS = 10_000;

interface RawTrack {
  name: string;
  artists: Array<{ name: string }>;
  album: { name: string; images: Array<{ url: string }> };
  /** Missing for local files. */
  external_urls?: { spotify?: string };
  duration_ms: number;
}

/** A podcast episode; only returned when `additional_types=episode` is asked for. */
interface RawEpisode {
  type: 'episode';
  name: string;
  show?: { name: string; images?: Array<{ url: string }> };
  images?: Array<{ url: string }>;
  external_urls?: { spotify?: string };
  duration_ms: number;
}

interface Device {
  id: string | null;
  is_active?: boolean;
  /** Spotify accepts no Web API commands for a restricted device. */
  is_restricted?: boolean;
}

interface PlayerState {
  is_playing?: boolean;
  device?: Device;
}

const COMMANDS: Record<PlaybackAction, { method: 'PUT' | 'POST'; path: string }> = {
  play: { method: 'PUT', path: '/me/player/play' },
  pause: { method: 'PUT', path: '/me/player/pause' },
  next: { method: 'POST', path: '/me/player/next' },
  previous: { method: 'POST', path: '/me/player/previous' },
};

const fail = (failure: SpotifyFailure) => ({ ok: false as const, failure });

function toTrack(item: RawTrack | RawEpisode): SpotifyTrack {
  const common = { name: item.name, durationMs: item.duration_ms, url: item.external_urls?.spotify ?? '' };
  if ('type' in item && item.type === 'episode') {
    const show = item.show?.name ?? '';
    return {
      ...common,
      artist: show,
      album: show,
      albumArt: item.images?.[0]?.url ?? item.show?.images?.[0]?.url ?? null,
    };
  }
  const track = item as RawTrack;
  return {
    ...common,
    artist: track.artists.map((a) => a.name).join(', '),
    album: track.album.name,
    albumArt: track.album.images[0]?.url ?? null,
  };
}

function failureForStatus(status: number): SpotifyFailure {
  if (status === 401) return 'RECONNECT_REQUIRED';
  if (status === 403) return 'FORBIDDEN';
  if (status === 429) return 'RATE_LIMITED';
  return 'API_ERROR';
}

export function createSpotifyClient(tokens: SpotifyTokenSource) {
  /** One request, retried once with a renewed token when Spotify answers 401. */
  async function call(path: string, init: RequestInit = {}): Promise<SpotifyResult<Response>> {
    let refused: string | undefined;
    for (;;) {
      const token = await tokens.getAccessToken({ refused });
      if (!token.ok) return token;
      let res: Response;
      try {
        res = await fetch(`${API}${path}`, {
          ...init,
          headers: {
            Authorization: `Bearer ${token.data}`,
            ...(init.body ? { 'Content-Type': 'application/json' } : {}),
          },
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
      } catch {
        return fail('NETWORK');
      }
      if (res.status !== 401 || refused !== undefined) return { ok: true, data: res };
      refused = token.data;
    }
  }

  /** A body that should be JSON; `null` when it is not. */
  const read = <T>(res: Response) =>
    res.json().then(
      (body) => body as T,
      () => null,
    );

  async function playerState(): Promise<SpotifyResult<PlayerState | null>> {
    const result = await call('/me/player');
    if (!result.ok) return result;
    const res = result.data;
    return { ok: true, data: res.ok && res.status !== 204 ? await read<PlayerState>(res) : null };
  }

  /** The device a command should target: the active one, else the first that takes commands. */
  async function resolveDevice(): Promise<SpotifyResult<{ id: string; isActive: boolean }>> {
    const state = await playerState();
    if (!state.ok) return state;
    const current = state.data?.device;
    if (current?.id && !current.is_restricted) return { ok: true, data: { id: current.id, isActive: true } };

    const result = await call('/me/player/devices');
    if (!result.ok) return result;
    if (!result.data.ok) return fail(failureForStatus(result.data.status));
    const body = await read<{ devices: Device[] }>(result.data);
    if (!body) return fail('API_ERROR');
    const usable = body.devices.filter((d): d is Device & { id: string } => !!d.id && !d.is_restricted);
    const device = usable.find((d) => d.is_active) ?? usable[0];
    if (!device) return fail(body.devices.length ? 'RESTRICTED' : 'NO_DEVICE');
    return { ok: true, data: { id: device.id, isActive: device.is_active === true } };
  }

  /**
   * Spotify answers 403 both for accounts without Premium and for commands that
   * do not fit the current state, such as pausing what is already paused.
   */
  async function explainForbidden(action: PlaybackAction, res: Response): Promise<SpotifyResult<null>> {
    const body = await read<{ error?: { reason?: string; message?: string } }>(res);
    const detail = `${body?.error?.reason ?? ''} ${body?.error?.message ?? ''}`;
    if (/premium/i.test(detail)) return fail('PREMIUM_REQUIRED');
    if (action === 'play' || action === 'pause') {
      const state = await playerState();
      if (state.ok && state.data?.is_playing === (action === 'play')) return { ok: true, data: null };
    }
    return fail(/restriction/i.test(detail) ? 'RESTRICTED' : 'FORBIDDEN');
  }

  return {
    async fetchNowPlaying(): Promise<SpotifyResult<NowPlaying>> {
      const result = await call('/me/player/currently-playing?additional_types=episode');
      if (!result.ok) return result;
      const res = result.data;
      if (res.status === 204) return { ok: true, data: { isPlaying: false, progressMs: 0, track: null } };
      if (!res.ok) return fail(failureForStatus(res.status));
      const body = await read<{ is_playing?: boolean; progress_ms?: number; item?: RawTrack | RawEpisode | null }>(res);
      if (!body) return fail('API_ERROR');
      // An advert has no item but is still playing.
      return {
        ok: true,
        data: {
          isPlaying: body.is_playing === true,
          progressMs: body.item ? (body.progress_ms ?? 0) : 0,
          track: body.item ? toTrack(body.item) : null,
        },
      };
    },

    async sendPlaybackCommand(action: PlaybackAction): Promise<SpotifyResult<null>> {
      const device = await resolveDevice();
      if (!device.ok) return device;
      const { id, isActive } = device.data;
      const { method, path } = COMMANDS[action];
      // An idle device has nothing to resume; transferring playback to it does.
      const result =
        action === 'play' && !isActive
          ? await call('/me/player', { method: 'PUT', body: JSON.stringify({ device_ids: [id], play: true }) })
          : await call(`${path}?device_id=${encodeURIComponent(id)}`, { method });
      if (!result.ok) return result;
      const res = result.data;
      if (res.ok) return { ok: true, data: null };
      if (res.status === 403) return explainForbidden(action, res);
      // 404 is Spotify's "no active device": it vanished between lookup and command.
      return fail(res.status === 404 ? 'NO_DEVICE' : failureForStatus(res.status));
    },

    async fetchTopTracks(limit = 10): Promise<SpotifyResult<SpotifyTrack[]>> {
      const safeLimit = Math.min(50, Math.max(1, Math.trunc(limit) || 10));
      const result = await call(`/me/top/tracks?limit=${safeLimit}&time_range=short_term`);
      if (!result.ok) return result;
      if (!result.data.ok) return fail(failureForStatus(result.data.status));
      const body = await read<{ items?: RawTrack[] }>(result.data);
      return body ? { ok: true, data: (body.items ?? []).map(toTrack) } : fail('API_ERROR');
    },
  };
}
