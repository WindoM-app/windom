/** Spotify links and URIs, as the embedded player understands them. */

const TYPES = ['track', 'album', 'playlist', 'artist', 'episode', 'show'] as const;

export interface SpotifyItem {
  type: (typeof TYPES)[number];
  id: string;
}

const ID = /^[A-Za-z0-9]{22}$/;

function toItem(type: string | undefined, id: string | undefined): SpotifyItem | null {
  const known = TYPES.find((t) => t === type);
  return known && id && ID.test(id) ? { type: known, id } : null;
}

/**
 * Read a pasted `https://open.spotify.com/…` link or a `spotify:…` URI.
 * Anything else is rejected, so only a type and an id ever reach the iframe URL.
 */
export function parseSpotifyLink(input: string): SpotifyItem | null {
  const text = input.trim();
  const uri = /^spotify:([a-z]+):([^:]+)$/.exec(text);
  if (uri) return toItem(uri[1], uri[2]);

  let url: URL;
  try {
    url = new URL(text.startsWith('open.spotify.com/') ? `https://${text}` : text);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' || url.hostname !== 'open.spotify.com') return null;

  // Links may carry a language ("intl-de") or already point at the embed.
  const parts = url.pathname.split('/').filter((p) => p && p !== 'embed' && !p.startsWith('intl-'));
  return parts.length === 2 ? toItem(parts[0], parts[1]) : null;
}

export const toSpotifyUri = ({ type, id }: SpotifyItem) => `spotify:${type}:${id}`;
