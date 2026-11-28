import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../services/spotify.service.js', () => ({
  getNowPlaying: vi.fn(),
  getTopTracks: vi.fn(),
  sendPlaybackCommand: vi.fn(),
}));

import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../app.js';
import { signAccessToken } from '../../lib/jwt.js';
import * as spotifyService from '../../services/spotify.service.js';

let app: FastifyInstance;
let authorization: string;

beforeAll(async () => {
  app = await buildApp({ logger: false, skipRateLimit: true });
  authorization = `Bearer ${await signAccessToken({
    sub: 'user-1',
    email: 'user@example.com',
    name: 'Alice',
    emailVerified: true,
  })}`;
});

afterAll(async () => app.close());
beforeEach(() => vi.clearAllMocks());

const get = (url: string) => app.inject({ method: 'GET', url, headers: { authorization } });
const post = (url: string) => app.inject({ method: 'POST', url, headers: { authorization } });

const track = {
  name: 'Song',
  artist: 'Artist',
  album: 'Album',
  albumArt: null,
  durationMs: 210000,
  url: 'https://open.spotify.com/track/1',
};

describe('GET /spotify/now-playing', () => {
  // The response schema used to list fields the service never returned, so the
  // serializer dropped `track` and every client showed "Nothing playing".
  it('sends the whole track through the response schema', async () => {
    const data = { isPlaying: true, progressMs: 12000, track };
    vi.mocked(spotifyService.getNowPlaying).mockResolvedValue({ ok: true, data });

    const res = await get('/spotify/now-playing');

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual(data);
  });

  it('sends a null track as null', async () => {
    const data = { isPlaying: false, track: null };
    vi.mocked(spotifyService.getNowPlaying).mockResolvedValue({ ok: true, data });

    expect((await get('/spotify/now-playing')).json()).toEqual(data);
  });
});

describe('Spotify error responses', () => {
  it.each([
    ['NOT_CONNECTED', 404, 'NOT_CONNECTED'],
    ['NO_DEVICE', 422, 'NO_DEVICE'],
    ['PREMIUM_REQUIRED', 403, 'PREMIUM_REQUIRED'],
    ['FORBIDDEN', 403, 'FORBIDDEN'],
    ['RESTRICTED', 409, 'RESTRICTED'],
    ['RATE_LIMITED', 429, 'RATE_LIMITED'],
    ['TOKEN_REFRESH_REVOKED', 401, 'RECONNECT_REQUIRED'],
    ['TOKEN_REFRESH_FAILED', 401, 'RECONNECT_REQUIRED'],
    ['TOKEN_REFRESH_NETWORK_ERROR', 502, 'API_ERROR'],
    ['API_ERROR', 502, 'API_ERROR'],
  ] as const)('maps %s to %i with a code the client can read', async (error, status, code) => {
    vi.mocked(spotifyService.sendPlaybackCommand).mockResolvedValue({ ok: false, error });

    const res = await post('/spotify/play');

    expect(res.statusCode).toBe(status);
    expect(res.json()).toMatchObject({ code });
  });
});

describe('GET /spotify/me', () => {
  it('reports the connection', async () => {
    vi.mocked(spotifyService.getNowPlaying).mockResolvedValue({ ok: true, data: { isPlaying: false, track: null } });

    expect((await get('/spotify/me')).json()).toEqual({ connected: true });
  });
});
