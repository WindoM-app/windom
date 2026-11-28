import { useCallback, useEffect, useRef, useState } from 'react';
import {
  loadEmbedItem,
  onEmbedItemChange,
  readEmbedPlaying,
  removeEmbedItem,
  saveEmbedItem,
  toggleEmbed,
} from '../lib/spotify-embed';
import { parseSpotifyLink, type SpotifyItem } from '../lib/spotify-uri';

const CHANNEL = 'windom-spotify-embed';

/** The link saved for the embedded player, shared by every WindoM tab. */
export function useSpotifyEmbedItem() {
  const [item, setItem] = useState<SpotifyItem | null>(null);

  useEffect(() => {
    let current = true;
    const unsubscribe = onEmbedItemChange((next) => {
      current = false;
      setItem(next);
    });
    void loadEmbedItem().then((saved) => {
      if (current) setItem(saved);
    });
    return () => {
      current = false;
      unsubscribe();
    };
  }, []);

  /** Save a pasted link. `false` means it is not a Spotify link. */
  const save = useCallback(async (link: string) => {
    const parsed = parseSpotifyLink(link);
    if (!parsed) return false;
    await saveEmbedItem(parsed);
    setItem(parsed);
    return true;
  }, []);

  const remove = useCallback(async () => {
    await removeEmbedItem();
    setItem(null);
  }, []);

  return { item, save, remove };
}

/** One WindoM tab plays at a time: when another starts, this one pauses. */
export function useOnePlayingTab() {
  const frameRef = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    const channel = new BroadcastChannel(CHANNEL);
    let playing = false;
    const onFrame = (event: MessageEvent) => {
      const next = readEmbedPlaying(event, frameRef.current);
      if (next === null || next === playing) return;
      playing = next;
      if (playing) channel.postMessage('playing');
    };
    channel.onmessage = () => {
      if (!playing) return;
      playing = false;
      toggleEmbed(frameRef.current);
    };
    window.addEventListener('message', onFrame);
    return () => {
      window.removeEventListener('message', onFrame);
      channel.close();
    };
  }, []);

  return frameRef;
}
