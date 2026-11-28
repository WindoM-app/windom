import { useState } from 'react';
import { useSpotify, type SpotifyProblem } from '../../hooks/useSpotify';
import { useLiquidGlass } from '../../hooks/useLiquidGlass';
import { SPOTIFY_FAILURES } from '../../lib/spotify-api';
import { SETTINGS_EVENT } from '../../lib/settings-events';

export function SpotifyPlayer() {
  const glassRef = useLiquidGlass<HTMLDivElement>('dock');
  const { isPlaying, progressMs, track, spotifyConnected, problem, busy, control, openSpotify, refreshIfStale } =
    useSpotify();
  const [hovered, setHovered] = useState(false);

  if (!spotifyConnected) return null;

  const pct = track && track.durationMs > 0 ? Math.min(100, (progressMs / track.durationMs) * 100) : 0;
  const nowPlaying = track
    ? [track.name, track.artist].filter(Boolean).join(' · ')
    : isPlaying
      ? 'Playing'
      : 'Nothing playing';
  const toggleLabel = isPlaying ? 'Pause' : 'Play';
  // Something the user's click led to stays visible after the pointer leaves.
  const pinned = problem !== null && (problem.kind === 'starting' || problem.source === 'command');

  return (
    <div
      ref={glassRef}
      className={`spotify-dock glass-dock${hovered || pinned ? ' spotify-dock--open' : ''}`}
      role="group"
      aria-label="Spotify player"
      onMouseEnter={() => {
        setHovered(true);
        refreshIfStale();
      }}
      onMouseLeave={() => setHovered(false)}
      onFocus={refreshIfStale}
    >
      {/* Disc button - always visible, anchored to left. aria-disabled, so focus stays put. */}
      <button
        type="button"
        className="spotify-dock-disc-btn"
        onClick={() => void control(isPlaying ? 'pause' : 'play')}
        title={`${toggleLabel} · ${nowPlaying}`}
        aria-label={toggleLabel}
        aria-busy={busy}
        aria-disabled={busy}
      >
        <div className={`spotify-dock-disc${isPlaying ? ' spinning' : ''}`}>
          {track?.albumArt ? (
            <img src={track.albumArt} alt="" className="spotify-dock-art" />
          ) : (
            <div className="spotify-dock-art-placeholder">
              <NoteIcon />
            </div>
          )}
        </div>
        {isPlaying && (
          <div className="spotify-dock-eq-overlay">
            <span className="spotify-eq-bar" />
            <span className="spotify-eq-bar" />
            <span className="spotify-eq-bar" />
          </div>
        )}
      </button>

      {/* Expandable right panel - hidden until hover */}
      <div className="spotify-dock-expand">
        <div className="spotify-dock-expand-inner">
          <button
            type="button"
            className="spotify-dock-ctrl"
            onClick={() => void control('previous')}
            title="Previous"
            aria-label="Previous track"
            aria-disabled={busy}
          >
            <PrevIcon />
          </button>
          <button
            type="button"
            className="spotify-dock-ctrl"
            onClick={() => void control('next')}
            title="Next"
            aria-label="Next track"
            aria-disabled={busy}
          >
            <NextIcon />
          </button>
          <div className="spotify-dock-info">
            <div role="status">
              {problem ? (
                <ProblemLine problem={problem} onOpenSpotify={openSpotify} />
              ) : track?.url ? (
                <a
                  className="spotify-dock-track-name"
                  href={track.url}
                  target="_blank"
                  rel="noreferrer"
                  title={nowPlaying}
                  dir="auto"
                >
                  {nowPlaying}
                </a>
              ) : (
                <div className="spotify-dock-track-name" title={nowPlaying} dir="auto">
                  {nowPlaying}
                </div>
              )}
            </div>
            <div className="spotify-dock-progress-bar">
              <div className="spotify-dock-progress-fill" style={{ width: `${pct}%` }} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function ProblemLine({ problem, onOpenSpotify }: { problem: SpotifyProblem; onOpenSpotify: () => void }) {
  if (problem.kind === 'starting') return <div className="spotify-dock-track-name">Opening Spotify…</div>;

  const { short, long } = SPOTIFY_FAILURES[problem.kind];
  const action =
    problem.kind === 'NO_DEVICE'
      ? { label: 'Open Spotify', run: onOpenSpotify }
      : problem.kind === 'RECONNECT_REQUIRED' || problem.kind === 'NOT_CONNECTED'
        ? { label: 'Reconnect', run: () => document.dispatchEvent(new CustomEvent(SETTINGS_EVENT.OPEN_SPOTIFY)) }
        : null;

  if (action) {
    return (
      <button type="button" className="spotify-dock-action" onClick={action.run} title={long}>
        {action.label}
        <span className="sr-only">. {long}</span>
      </button>
    );
  }
  return (
    <div className="spotify-dock-error" title={long}>
      {short}
      <span className="sr-only">. {long}</span>
    </div>
  );
}

function NoteIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="rgba(255,255,255,0.5)"
      strokeWidth="2"
      strokeLinecap="round"
    >
      <path d="M9 18V5l12-2v13" />
      <circle cx="6" cy="18" r="3" />
      <circle cx="18" cy="16" r="3" />
    </svg>
  );
}

function PrevIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
      <polygon points="19,20 9,12 19,4" />
      <line x1="5" y1="4" x2="5" y2="20" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" fill="none" />
    </svg>
  );
}

function NextIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
      <polygon points="5,4 15,12 5,20" />
      <line x1="19" y1="4" x2="19" y2="20" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" fill="none" />
    </svg>
  );
}
