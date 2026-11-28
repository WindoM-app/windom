import { describe, expect, it } from 'vitest';
import { parseSpotifyLink, toSpotifyUri } from '../spotify-uri';

const ID = '4cOdK2wGLETKBW3PvgPWqT';

describe('parseSpotifyLink', () => {
  it.each([
    [`https://open.spotify.com/track/${ID}`, 'track'],
    [`https://open.spotify.com/playlist/${ID}?si=abc123`, 'playlist'],
    [`https://open.spotify.com/intl-de/album/${ID}`, 'album'],
    [`https://open.spotify.com/embed/artist/${ID}/`, 'artist'],
    [`  open.spotify.com/episode/${ID}  `, 'episode'],
    [`spotify:show:${ID}`, 'show'],
  ])('reads %s', (input, type) => {
    expect(parseSpotifyLink(input)).toEqual({ type, id: ID });
  });

  it.each([
    '',
    'not a link',
    'https://spotify.link/abc',
    `http://open.spotify.com/track/${ID}`,
    `https://open.spotify.com.evil.example/track/${ID}`,
    `https://evil.example/open.spotify.com/track/${ID}`,
    `javascript:alert(1)//open.spotify.com/track/${ID}`,
    `https://open.spotify.com/user/${ID}`,
    `https://open.spotify.com/track/${ID}/extra`,
    'https://open.spotify.com/track/short',
    `https://open.spotify.com/track/${ID.slice(0, 20)}%22%3E`,
    `spotify:user:${ID}`,
  ])('rejects %j', (input) => {
    expect(parseSpotifyLink(input)).toBeNull();
  });

  it('round-trips through the URI form used in storage', () => {
    expect(parseSpotifyLink(toSpotifyUri({ type: 'album', id: ID }))).toEqual({ type: 'album', id: ID });
  });
});
