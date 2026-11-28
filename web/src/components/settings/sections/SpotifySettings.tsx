import { useState } from 'react';
import { useSettings } from '../../../contexts/SettingsContext';
import { useAuth } from '../../../contexts/AuthContext';
import { useSpotifyConnection, useSpotifySetup } from '../../../hooks/useSpotifyConnection';
import { COPY_CONFIRM_DURATION_MS } from '../../../lib/timing-constants';
import { getAuthRedirectUrl } from '../../../lib/oauth-connection';
import { SpotifyLogo } from '../../spotify/SpotifyLogo';

// ── State 1: No client ID saved ─────────────────────────────────────────────

function NoClientIdState({ onSaved }: { onSaved: () => void }) {
  const { user } = useAuth();
  const alreadyLinked = useSettings().settings.integrations.spotify.connected;
  const [clientIdInput, setClientIdInput] = useState('');
  const [copied, setCopied] = useState(false);
  const { busy, error, setError, connect } = useSpotifyConnection({ afterConnect: onSaved, saveClientId: true });

  const redirectUri = getAuthRedirectUrl();

  async function handleCopy() {
    await navigator.clipboard.writeText(redirectUri);
    setCopied(true);
    setTimeout(() => setCopied(false), COPY_CONFIRM_DURATION_MS);
  }

  function handleSaveAndConnect() {
    const trimmed = clientIdInput.trim();
    if (!trimmed) return;
    void connect(trimmed);
  }

  return (
    <div>
      <div className="settings-group">
        <label className="settings-label">Connect Spotify</label>
        <p className="settings-hint" style={{ marginBottom: '16px', lineHeight: '1.6' }}>
          Connect your own free Spotify Developer app - no shared quota, works for everyone.
        </p>
        {alreadyLinked && (
          <p className="settings-hint" style={{ marginBottom: '16px', lineHeight: '1.6' }}>
            Your account is already linked to Spotify. To reconnect from this browser, enter the same Client ID.
          </p>
        )}

        <ol style={{ paddingLeft: '18px', margin: '0 0 16px', lineHeight: '1.7' }} className="settings-hint">
          <li>
            Go to{' '}
            <a
              href="https://developer.spotify.com/dashboard"
              target="_blank"
              rel="noreferrer"
              style={{ color: 'var(--brand-spotify)' }}
            >
              developer.spotify.com/dashboard
            </a>{' '}
            and create a free app.
          </li>
          <li>In your app settings, add this Redirect URI:</li>
        </ol>

        <div className="settings-row-with-btn" style={{ marginBottom: '16px' }}>
          <input
            type="text"
            readOnly
            spellCheck={false}
            autoComplete="off"
            aria-label="Redirect URI"
            value={redirectUri}
            className="settings-input"
            style={{ flex: 1, fontSize: '12px', fontFamily: 'monospace', opacity: 0.8, cursor: 'text' }}
            onFocus={(e) => e.currentTarget.select()}
          />
          <button
            type="button"
            className="settings-save-btn"
            style={{ flexShrink: 0, padding: '8px 12px', fontSize: '12px' }}
            onClick={handleCopy}
          >
            {copied ? 'Copied!' : 'Copy'}
          </button>
        </div>

        <ol start={3} style={{ paddingLeft: '18px', margin: '0 0 12px', lineHeight: '1.7' }} className="settings-hint">
          <li>Copy your Client ID from the app dashboard and paste it below.</li>
        </ol>

        <input
          type="text"
          placeholder="Spotify Client ID"
          spellCheck={false}
          autoComplete="off"
          aria-label="Spotify Client ID"
          value={clientIdInput}
          onChange={(e) => {
            setClientIdInput(e.target.value);
            setError('');
          }}
          className="settings-input"
          style={{ marginBottom: '8px', fontFamily: 'monospace', fontSize: '13px' }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') handleSaveAndConnect();
          }}
        />
        {error && (
          <p className="auth-field-error" role="alert" style={{ marginBottom: '8px' }}>
            {error}
          </p>
        )}
        <button
          type="button"
          className="integration-connect-btn"
          disabled={busy || !clientIdInput.trim() || !user}
          onClick={handleSaveAndConnect}
          style={{ width: '100%' }}
        >
          {busy ? 'Connecting…' : 'Save & Connect'}
        </button>
        {!user && (
          <p className="settings-hint" style={{ marginTop: '8px', opacity: 0.6 }}>
            Sign in to your WindoM account first to connect Spotify.
          </p>
        )}
      </div>
    </div>
  );
}

// ── State 2: Client ID saved but not connected ──────────────────────────────

function SavedNotConnectedState({
  clientId,
  onConnected,
  onChangeApp,
}: {
  clientId: string;
  onConnected: () => void;
  onChangeApp: () => void;
}) {
  const { busy, error, connect } = useSpotifyConnection({ afterConnect: onConnected });

  return (
    <div className="settings-group">
      <label className="settings-label">Spotify</label>
      <div className="integration-card">
        <div className="integration-icon spotify">
          <SpotifyLogo size={21} />
        </div>
        <div className="integration-info">
          <div className="integration-name">Spotify</div>
          <div className="integration-status">Not connected</div>
        </div>
        <button
          type="button"
          className="integration-connect-btn"
          disabled={busy}
          onClick={() => void connect(clientId)}
        >
          {busy ? '…' : 'Connect'}
        </button>
      </div>
      {error && <p className="integration-error">{error}</p>}
      <p className="settings-hint" style={{ marginTop: '8px' }}>
        App: <code style={{ fontSize: '12px', opacity: 0.8 }}>{clientId.slice(0, 8)}…</code>{' '}
        <button type="button" className="auth-required-link" onClick={onChangeApp} style={{ fontSize: '12px' }}>
          Change app
        </button>
      </p>
    </div>
  );
}

// ── State 3: Connected ──────────────────────────────────────────────────────

function ConnectedState({ clientId, onDisconnected }: { clientId: string; onDisconnected: () => void }) {
  const { settings, update } = useSettings();
  const { busy, error, connect, disconnect } = useSpotifyConnection({ afterDisconnect: onDisconnected });
  const showTopTracks = settings.integrations.spotify.showTopTracks;

  return (
    <div className="settings-group">
      <label className="settings-label">Spotify</label>
      <div className="integration-card">
        <div className="integration-icon spotify">
          <SpotifyLogo size={21} />
        </div>
        <div className="integration-info">
          <div className="integration-name">Spotify</div>
          <div className="integration-status connected">Connected</div>
        </div>
        <button type="button" className="integration-disconnect-btn" disabled={busy} onClick={() => void disconnect()}>
          {busy ? '…' : 'Disconnect'}
        </button>
      </div>
      {error && <p className="integration-error">{error}</p>}
      <p className="settings-hint" style={{ marginTop: '8px' }}>
        App: <code style={{ fontSize: '12px' }}>{clientId.slice(0, 8)}…</code>
        {clientId && (
          <>
            {' '}
            <button
              type="button"
              className="auth-required-link"
              style={{ fontSize: '12px' }}
              disabled={busy}
              onClick={() => void connect(clientId)}
            >
              Reconnect
            </button>
          </>
        )}
      </p>
      <p className="settings-hint" style={{ marginTop: '4px' }}>
        Spotify ends access after six months. Reconnect when the player says you are signed out.
      </p>

      <div className="settings-group" style={{ marginTop: '16px' }}>
        <label className="settings-label">Sidebar</label>
        <label className="visibility-row" style={{ cursor: 'pointer' }}>
          <span className="visibility-row-label">Show top tracks in sidebar</span>
          <label className="toggle-switch">
            <input
              type="checkbox"
              checked={showTopTracks}
              onChange={(e) =>
                void update('integrations', {
                  spotify: { ...settings.integrations.spotify, showTopTracks: e.target.checked },
                })
              }
            />
            <span className="toggle-track">
              <span className="toggle-knob" />
            </span>
          </label>
        </label>
      </div>
    </div>
  );
}

// ── Root component ──────────────────────────────────────────────────────────

export function SpotifySettings() {
  const { state: uiState, setState: setUiState, clientId: savedClientId, changeApp } = useSpotifySetup();

  if (uiState === 'loading') {
    return (
      <p className="settings-label" style={{ opacity: 0.5 }}>
        Loading…
      </p>
    );
  }

  if (uiState === 'no-client-id') {
    return <NoClientIdState onSaved={() => setUiState('connected')} />;
  }

  if (uiState === 'saved-not-connected') {
    return (
      <SavedNotConnectedState
        clientId={savedClientId}
        onConnected={() => setUiState('connected')}
        onChangeApp={() => void changeApp()}
      />
    );
  }

  return <ConnectedState clientId={savedClientId} onDisconnected={() => setUiState('no-client-id')} />;
}
