import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSpotifyClient } from '../spotify-direct';

const fetchMock = vi.fn();
const getAccessToken = vi.fn();
const client = createSpotifyClient({ getAccessToken, disconnect: vi.fn() });

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });
const empty = (status = 204) => new Response(null, { status });
const calls = () =>
  fetchMock.mock.calls.map(
    ([url, init]) => `${init.method ?? 'GET'} ${String(url).replace('https://api.spotify.com/v1', '')}`,
  );
const replies = (...list: Response[]) => list.forEach((r) => fetchMock.mockResolvedValueOnce(r));

const rawTrack = {
  name: 'Song',
  artists: [{ name: 'A' }, { name: 'B' }],
  album: { name: 'Album', images: [{ url: 'https://img/art' }] },
  external_urls: { spotify: 'https://open.spotify.com/track/1' },
  duration_ms: 1000,
};

beforeEach(() => {
  fetchMock.mockReset();
  getAccessToken.mockReset().mockResolvedValue({ ok: true, data: 't1' });
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe('fetchNowPlaying', () => {
  it('maps a track', async () => {
    replies(json(200, { is_playing: true, progress_ms: 5, item: rawTrack }));
    expect(await client.fetchNowPlaying()).toEqual({
      ok: true,
      data: {
        isPlaying: true,
        progressMs: 5,
        track: {
          name: 'Song',
          artist: 'A, B',
          album: 'Album',
          albumArt: 'https://img/art',
          durationMs: 1000,
          url: 'https://open.spotify.com/track/1',
        },
      },
    });
  });

  it('shows a podcast episode under its show, and copes with missing links and art', async () => {
    replies(
      json(200, { is_playing: true, item: { type: 'episode', name: 'Ep', show: { name: 'Show' }, duration_ms: 1 } }),
    );
    expect(await client.fetchNowPlaying()).toMatchObject({
      data: { track: { artist: 'Show', albumArt: null, url: '' } },
    });
  });

  it('reads silence and adverts', async () => {
    replies(empty(), json(200, { is_playing: true, item: null }));
    expect(await client.fetchNowPlaying()).toMatchObject({ data: { isPlaying: false, track: null } });
    expect(await client.fetchNowPlaying()).toMatchObject({ data: { isPlaying: true, track: null } });
  });

  it('renews the token once after a 401, then gives up', async () => {
    getAccessToken.mockResolvedValueOnce({ ok: true, data: 't1' }).mockResolvedValueOnce({ ok: true, data: 't2' });
    replies(empty(401), empty(401));
    expect(await client.fetchNowPlaying()).toEqual({ ok: false, failure: 'RECONNECT_REQUIRED' });
    expect(getAccessToken.mock.calls).toEqual([[{ refused: undefined }], [{ refused: 't1' }]]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('passes on a token failure without calling Spotify', async () => {
    getAccessToken.mockResolvedValue({ ok: false, failure: 'NOT_CONNECTED' });
    expect(await client.fetchNowPlaying()).toEqual({ ok: false, failure: 'NOT_CONNECTED' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    [429, 'RATE_LIMITED'],
    [403, 'FORBIDDEN'],
    [502, 'API_ERROR'],
  ])('reports status %i as %s', async (status, failure) => {
    replies(empty(status));
    expect(await client.fetchNowPlaying()).toEqual({ ok: false, failure });
  });

  it('reports an unreachable Spotify', async () => {
    fetchMock.mockRejectedValue(new TypeError('offline'));
    expect(await client.fetchNowPlaying()).toEqual({ ok: false, failure: 'NETWORK' });
  });
});

describe('sendPlaybackCommand', () => {
  const active = () => json(200, { device: { id: 'd1' } });

  it('targets the active device', async () => {
    replies(active(), empty());
    expect(await client.sendPlaybackCommand('next')).toEqual({ ok: true, data: null });
    expect(calls()).toEqual(['GET /me/player', 'POST /me/player/next?device_id=d1']);
  });

  it('transfers playback to an idle device, skipping unusable ones', async () => {
    replies(empty(), json(200, { devices: [{ id: null }, { id: 'r', is_restricted: true }, { id: 'd2' }] }), empty());
    await client.sendPlaybackCommand('play');
    expect(calls()[2]).toBe('PUT /me/player');
    expect(JSON.parse(fetchMock.mock.calls[2][1].body as string)).toEqual({ device_ids: ['d2'], play: true });
  });

  it.each([
    [[], 'NO_DEVICE'],
    [[{ id: 'r', is_restricted: true }], 'RESTRICTED'],
  ])('explains having no usable device', async (devices, failure) => {
    replies(empty(), json(200, { devices }));
    expect(await client.sendPlaybackCommand('play')).toEqual({ ok: false, failure });
  });

  it('tells a missing Premium subscription apart', async () => {
    replies(active(), json(403, { error: { reason: 'PREMIUM_REQUIRED' } }));
    expect(await client.sendPlaybackCommand('next')).toEqual({ ok: false, failure: 'PREMIUM_REQUIRED' });
  });

  it('treats pausing an already paused player as done', async () => {
    replies(active(), json(403, { error: { message: 'Restriction violated' } }), json(200, { is_playing: false }));
    expect(await client.sendPlaybackCommand('pause')).toEqual({ ok: true, data: null });
  });

  it('keeps a restriction as an error when the state does not match', async () => {
    replies(active(), json(403, { error: { message: 'Restriction violated' } }), json(200, { is_playing: true }));
    expect(await client.sendPlaybackCommand('pause')).toEqual({ ok: false, failure: 'RESTRICTED' });
  });

  it('reports a device that vanished before the command', async () => {
    replies(active(), empty(404));
    expect(await client.sendPlaybackCommand('next')).toEqual({ ok: false, failure: 'NO_DEVICE' });
  });
});

describe('fetchTopTracks', () => {
  it('bounds the limit and maps the tracks', async () => {
    replies(json(200, { items: [rawTrack] }));
    const result = await client.fetchTopTracks(500);
    expect(calls()[0]).toBe('GET /me/top/tracks?limit=50&time_range=short_term');
    expect(result).toMatchObject({ ok: true, data: [{ name: 'Song' }] });
  });
});
