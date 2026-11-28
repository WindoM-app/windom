/**
 * Spotify's embedded player: the saved link (this device only), the iframe
 * address, and the messages exchanged with the frame. No sign-in or token, and
 * nothing from Spotify runs in this page.
 */
import { localStore } from './chrome-storage';
import { parseSpotifyLink, toSpotifyUri, type SpotifyItem } from './spotify-uri';

export const SPOTIFY_EMBED_ORIGIN = 'https://open.spotify.com';
const STORAGE_KEY = 'windom_spotify_embed';

export const embedSrc = ({ type, id }: SpotifyItem) => `${SPOTIFY_EMBED_ORIGIN}/embed/${type}/${id}`;

/** Storage is read back through the parser: a bad value shows no player. */
function fromStored(value: unknown): SpotifyItem | null {
  return typeof value === 'string' ? parseSpotifyLink(value) : null;
}

export async function loadEmbedItem(): Promise<SpotifyItem | null> {
  return fromStored(await localStore.get<unknown>(STORAGE_KEY, null));
}

export const saveEmbedItem = (item: SpotifyItem) => localStore.set(STORAGE_KEY, toSpotifyUri(item));

export const removeEmbedItem = () => localStore.remove(STORAGE_KEY);

/** Follow changes made here or in another tab. Returns the unsubscribe. */
export function onEmbedItemChange(callback: (item: SpotifyItem | null) => void): () => void {
  return localStore.onChange((changes) => {
    if (STORAGE_KEY in changes) callback(fromStored(changes[STORAGE_KEY].newValue));
  });
}

/**
 * Whether `event` says the frame is playing or paused; `null` for anything else,
 * including every message that is not from this exact frame on Spotify's origin.
 */
export function readEmbedPlaying(event: MessageEvent, frame: HTMLIFrameElement | null): boolean | null {
  if (event.origin !== SPOTIFY_EMBED_ORIGIN || !frame || event.source !== frame.contentWindow) return null;
  const data = event.data as { type?: unknown; payload?: { isPaused?: unknown } } | null;
  if (data?.type !== 'playback_update' || typeof data.payload?.isPaused !== 'boolean') return null;
  return !data.payload.isPaused;
}

/** The embed has no "pause" that has been verified to work; toggle only while it plays. */
export function toggleEmbed(frame: HTMLIFrameElement | null): void {
  frame?.contentWindow?.postMessage({ command: 'toggle' }, SPOTIFY_EMBED_ORIGIN);
}
