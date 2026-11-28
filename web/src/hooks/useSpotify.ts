import { useState, useEffect, useRef, useCallback } from 'react';
import { apiGet } from '../lib/api';
import { useSettingsSection } from '../contexts/SettingsContext';
import {
  SPOTIFY_TICKER_INTERVAL_MS,
  SPOTIFY_POLL_INTERVAL_MS,
  SPOTIFY_CONFIRM_DELAYS_MS,
  SPOTIFY_DEVICE_RETRY_MS,
  SPOTIFY_DEVICE_ATTEMPTS,
  SPOTIFY_STALE_MS,
  SPOTIFY_RATE_LIMIT_BACKOFF_MS,
  SPOTIFY_COMMAND_ERROR_MS,
} from '../lib/timing-constants';
import { startVisibleInterval } from '../lib/visible-interval';
import {
  fetchNowPlaying,
  openSpotifyWebPlayer,
  sendPlaybackCommand,
  type NowPlaying,
  type PlaybackAction,
  type SpotifyFailure,
  type SpotifyResult,
  type SpotifyTrack,
} from '../lib/spotify-api';

export type { SpotifyTrack } from '../lib/spotify-api';

export type SpotifyProblem =
  | { kind: 'starting' }
  | { kind: SpotifyFailure; source: 'poll' }
  | { kind: SpotifyFailure; source: 'command'; at: number };

const NOTHING: NowPlaying = { isPlaying: false, progressMs: 0, track: null };

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Whether what Spotify reports already shows the effect of `action`. */
function reflects(action: PlaybackAction, before: NowPlaying, now: NowPlaying): boolean {
  if (action === 'play') return now.isPlaying;
  if (action === 'pause') return !now.isPlaying;
  const changed = now.track?.url !== before.track?.url || now.track?.name !== before.track?.name;
  // "Previous" restarts the same track when it is more than a few seconds in.
  return changed || (action === 'previous' && now.progressMs < before.progressMs);
}

/** A poll that worked settles earlier problems, but not ones the user still has to act on. */
function problemAfterPoll(problem: SpotifyProblem | null, data: NowPlaying): SpotifyProblem | null {
  if (!problem || problem.kind === 'starting') return problem;
  if (problem.source === 'poll') return null;
  if (problem.kind === 'NO_DEVICE') return data.isPlaying ? null : problem;
  return Date.now() - problem.at < SPOTIFY_COMMAND_ERROR_MS ? problem : null;
}

export function useSpotify() {
  const integrations = useSettingsSection('integrations');
  const spotifyConnected = integrations.spotify.connected;
  const [state, setState] = useState<NowPlaying>(NOTHING);
  const [problem, setProblem] = useState<SpotifyProblem | null>(null);
  const [busy, setBusy] = useState(false);

  const stateRef = useRef(state);
  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  /** Bumped by every command and on teardown: answers to older questions are dropped. */
  const epochRef = useRef(0);
  const busyRef = useRef(false);
  /** True from a command until Spotify reflects it, so a poll cannot undo the click. */
  const settlingRef = useRef(false);
  const polledAtRef = useRef(0);
  const pollingRef = useRef(false);
  const blockedUntilRef = useRef(0);
  /** The reported position and when it was read; the progress bar counts from here. */
  const anchorRef = useRef({ progressMs: 0, at: 0 });

  const apply = useCallback((data: NowPlaying) => {
    anchorRef.current = { progressMs: data.progressMs, at: Date.now() };
    stateRef.current = data;
    setState(data);
  }, []);

  const refresh = useCallback(async () => {
    if (pollingRef.current || settlingRef.current || Date.now() < blockedUntilRef.current) return;
    pollingRef.current = true;
    const epoch = epochRef.current;
    const result = await fetchNowPlaying();
    pollingRef.current = false;
    if (epoch !== epochRef.current) return;
    polledAtRef.current = Date.now();

    if (result.ok) {
      apply(result.data);
      setProblem((p) => problemAfterPoll(p, result.data));
      return;
    }
    if (result.failure === 'RATE_LIMITED') blockedUntilRef.current = Date.now() + SPOTIFY_RATE_LIMIT_BACKOFF_MS;
    // Keep the last track on screen, but stop claiming it is advancing.
    setState((prev) => ({ ...prev, isPlaying: false }));
    setProblem({ kind: result.failure, source: 'poll' });
  }, [apply]);

  /** For when the user is about to look at, or click, the player. */
  const refreshIfStale = useCallback(() => {
    if (Date.now() - polledAtRef.current > SPOTIFY_STALE_MS) void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!spotifyConnected) return;
    void refresh();
    const stopPolling = startVisibleInterval(() => void refresh(), SPOTIFY_POLL_INTERVAL_MS);
    const onVisibilityChange = () => {
      if (!document.hidden) refreshIfStale();
    };
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      stopPolling();
      document.removeEventListener('visibilitychange', onVisibilityChange);
      epochRef.current += 1;
      busyRef.current = false;
      settlingRef.current = false;
      pollingRef.current = false;
      apply(NOTHING);
      setProblem(null);
      setBusy(false);
    };
  }, [spotifyConnected, refresh, refreshIfStale, apply]);

  const durationMs = state.track?.durationMs ?? 0;
  useEffect(() => {
    if (!state.isPlaying || durationMs <= 0) return;
    const id = setInterval(() => {
      const { progressMs, at } = anchorRef.current;
      const next = Math.min(progressMs + (Date.now() - at), durationMs);
      setState((prev) => ({ ...prev, progressMs: next }));
      // The next track has started; do not wait for the next poll to show it.
      if (next >= durationMs) void refresh();
    }, SPOTIFY_TICKER_INTERVAL_MS);
    return () => clearInterval(id);
  }, [state.isPlaying, state.track?.url, durationMs, refresh]);

  /** Opens the web player and retries until it shows up as a device. */
  const playOnWebPlayer = useCallback(async (epoch: number): Promise<SpotifyResult<null>> => {
    setProblem({ kind: 'starting' });
    let result: SpotifyResult<null> = { ok: false, failure: 'NO_DEVICE' };
    try {
      await openSpotifyWebPlayer({ focus: false });
    } catch {
      return result;
    }
    for (let attempt = 0; attempt < SPOTIFY_DEVICE_ATTEMPTS; attempt += 1) {
      await sleep(SPOTIFY_DEVICE_RETRY_MS);
      if (epoch !== epochRef.current) break;
      result = await sendPlaybackCommand('play');
      if (result.ok || result.failure !== 'NO_DEVICE') break;
    }
    return result;
  }, []);

  const confirm = useCallback(
    async (epoch: number, action: PlaybackAction, before: NowPlaying) => {
      for (const [i, delay] of SPOTIFY_CONFIRM_DELAYS_MS.entries()) {
        await sleep(delay);
        if (epoch !== epochRef.current) return;
        const result = await fetchNowPlaying();
        if (epoch !== epochRef.current) return;
        const last = i === SPOTIFY_CONFIRM_DELAYS_MS.length - 1;
        if (!result.ok) continue;
        const done = reflects(action, before, result.data);
        if (!done && !last) continue;
        apply(result.data);
        // Accepted but silent: the browser can keep a background web player from
        // starting audio until the user has been to its tab.
        if (!done && action === 'play') setProblem({ kind: 'NO_DEVICE', source: 'command', at: Date.now() });
        break;
      }
      settlingRef.current = false;
    },
    [apply],
  );

  const control = useCallback(
    async (action: PlaybackAction) => {
      // One command at a time: a second click must not race the first.
      if (busyRef.current) return;
      busyRef.current = true;
      settlingRef.current = true;
      const epoch = ++epochRef.current;
      const before = stateRef.current;
      setBusy(true);
      setProblem(null);
      // Show the effect of play and pause at once.
      if (action === 'play' || action === 'pause') apply({ ...before, isPlaying: action === 'play' });

      let result = await sendPlaybackCommand(action);
      if (epoch === epochRef.current && !result.ok && result.failure === 'NO_DEVICE' && action === 'play') {
        result = await playOnWebPlayer(epoch);
      }
      if (epoch !== epochRef.current) return;
      busyRef.current = false;
      setBusy(false);

      if (!result.ok) {
        settlingRef.current = false;
        apply(before);
        setProblem({ kind: result.failure, source: 'command', at: Date.now() });
        // The click may have failed because the screen was out of date.
        void refresh();
        return;
      }
      setProblem(null);
      await confirm(epoch, action, before);
    },
    [apply, confirm, playOnWebPlayer, refresh],
  );

  const openSpotify = useCallback(() => void openSpotifyWebPlayer({ focus: true }), []);

  return { ...state, spotifyConnected, problem, busy, control, openSpotify, refreshIfStale };
}

export function useSpotifyTopTracks() {
  const integrations = useSettingsSection('integrations');
  const spotifyConnected = integrations.spotify.connected;
  const [tracks, setTracks] = useState<SpotifyTrack[]>([]);

  useEffect(() => {
    if (!spotifyConnected) {
      setTracks([]);
      return;
    }
    void (async () => {
      try {
        const data = await apiGet<{ tracks: SpotifyTrack[] }>('/spotify/top-tracks?limit=10&time_range=short_term');
        setTracks(data.tracks);
      } catch {
        setTracks([]);
      }
    })();
  }, [spotifyConnected]);

  return { tracks };
}
