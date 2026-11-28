/**
 * Hosts Spotify's Web Playback SDK for the WindoM extension, which may not run
 * remote code in its own pages. Framed by the extension and talks only to it:
 * no storage, no analytics, no requests of its own. The access token is handed
 * straight to the SDK and not kept.
 */
(() => {
  const EXTENSION_ORIGIN = 'chrome-extension://comcnbccalbfcegbmaemancbhgpijkpb';
  const ERRORS = {
    initialization_error: 'initialization',
    authentication_error: 'authentication',
    account_error: 'account',
    playback_error: 'playback',
    autoplay_failed: 'autoplay',
  };
  // Opened directly, there is nobody to talk to.
  if (window.parent === window) return;

  const post = (message) => window.parent.postMessage(message, EXTENSION_ORIGIN);
  let sdkReady = false;
  let wanted = false;
  let player = null;
  /** Token callbacks the SDK is waiting on. */
  let waiting = [];

  function start() {
    if (!sdkReady || !wanted || player) return;
    player = new window.Spotify.Player({
      name: 'WindoM',
      volume: 0.5,
      getOAuthToken: (callback) => {
        waiting.push(callback);
        post({ type: 'token-request' });
      },
    });
    player.addListener('ready', ({ device_id }) => post({ type: 'ready', deviceId: device_id }));
    player.addListener('not_ready', () => post({ type: 'not-ready' }));
    for (const [event, kind] of Object.entries(ERRORS)) {
      player.addListener(event, (error) => post({ type: 'error', kind, message: error?.message ?? '' }));
    }
    // Enough to resume at the same place after the extension closes this page.
    player.addListener('player_state_changed', (state) => {
      if (!state) return post({ type: 'state', idle: true });
      post({
        type: 'state',
        idle: false,
        paused: state.paused,
        positionMs: state.position,
        trackUri: state.track_window?.current_track?.uri ?? null,
        contextUri: state.context?.uri ?? null,
      });
    });
    player.connect().then((connected) => {
      if (!connected) post({ type: 'error', kind: 'initialization', message: 'connect refused' });
    });
  }

  window.onSpotifyWebPlaybackSDKReady = () => {
    sdkReady = true;
    start();
  };

  window.addEventListener('message', (event) => {
    if (event.origin !== EXTENSION_ORIGIN || event.source !== window.parent) return;
    const message = event.data;
    if (message?.type === 'init') {
      wanted = true;
      start();
    } else if (message?.type === 'token' && typeof message.token === 'string') {
      waiting.splice(0).forEach((callback) => callback(message.token));
    } else if (message?.type === 'disconnect') {
      wanted = false;
      waiting = [];
      player?.disconnect();
      player = null;
    }
  });

  post({ type: 'hello' });
})();
