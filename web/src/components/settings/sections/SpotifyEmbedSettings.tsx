import { useState, type FormEvent } from 'react';
import { useSpotifyEmbedItem } from '../../../hooks/useSpotifyEmbed';

/** The player that works without any account: paste a link, get Spotify's embed. */
export function SpotifyEmbedSettings() {
  const { item, save, remove } = useSpotifyEmbedItem();
  const [link, setLink] = useState('');
  const [invalid, setInvalid] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const saved = await save(link);
    setInvalid(!saved);
    if (saved) setLink('');
  }

  return (
    <form className="settings-group" onSubmit={(e) => void handleSubmit(e)} noValidate>
      <label className="settings-label" htmlFor="spotify-embed-link">
        Play a Spotify link
      </label>
      <p id="spotify-embed-hint" className="settings-hint" style={{ marginBottom: '8px', lineHeight: '1.6' }}>
        No account needed. Paste a song, album, playlist or podcast link and a Spotify player appears in the bottom
        corner of this device. Spotify may play only previews if you are not signed in to Spotify in this browser.
      </p>
      <div className="settings-row-with-btn spotify-embed-row">
        <input
          id="spotify-embed-link"
          type="url"
          className="settings-input"
          placeholder="https://open.spotify.com/playlist/…"
          value={link}
          onChange={(e) => {
            setLink(e.target.value);
            setInvalid(false);
          }}
          aria-invalid={invalid}
          aria-describedby={invalid ? 'spotify-embed-error' : 'spotify-embed-hint'}
          autoComplete="off"
          spellCheck={false}
          dir="ltr"
        />
        <button type="submit" className="settings-save-btn" disabled={!link.trim()}>
          Show player
        </button>
      </div>
      {invalid && (
        <p id="spotify-embed-error" className="integration-error" role="alert">
          That is not a Spotify link. In Spotify choose Share, then Copy link.
        </p>
      )}
      {item && (
        <button type="button" className="auth-required-link" onClick={() => void remove()}>
          Remove player
        </button>
      )}
    </form>
  );
}
