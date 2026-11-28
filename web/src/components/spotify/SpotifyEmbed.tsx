import { useOnePlayingTab, useSpotifyEmbedItem } from '../../hooks/useSpotifyEmbed';
import { embedSrc } from '../../lib/spotify-embed';
import type { SpotifyItem } from '../../lib/spotify-uri';

/** Spotify's own player for the saved link. Nothing is loaded until a link is saved. */
export function SpotifyEmbed() {
  const { item } = useSpotifyEmbedItem();
  return item ? <EmbedFrame item={item} /> : null;
}

function EmbedFrame({ item }: { item: SpotifyItem }) {
  const frameRef = useOnePlayingTab();
  return (
    <div className="spotify-embed">
      <iframe
        // A new frame per link, so nothing from the previous one lingers.
        key={`${item.type}:${item.id}`}
        ref={frameRef}
        src={embedSrc(item)}
        title="Spotify player"
        allow="autoplay; encrypted-media; clipboard-write"
      />
    </div>
  );
}
