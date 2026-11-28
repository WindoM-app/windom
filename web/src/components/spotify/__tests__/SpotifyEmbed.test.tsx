import { render, screen, fireEvent, act, cleanup } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { store, listeners } = vi.hoisted(() => ({
  store: new Map<string, unknown>(),
  listeners: new Set<(changes: Record<string, { newValue?: unknown }>) => void>(),
}));
vi.mock('../../../lib/chrome-storage', () => {
  const emit = (key: string) => listeners.forEach((l) => l({ [key]: { newValue: store.get(key) } }));
  return {
    localStore: {
      get: async (key: string, fallback: unknown) => store.get(key) ?? fallback,
      set: async (key: string, value: unknown) => {
        store.set(key, value);
        emit(key);
        return true;
      },
      remove: async (key: string) => {
        store.delete(key);
        emit(key);
        return true;
      },
      onChange: (callback: (changes: Record<string, { newValue?: unknown }>) => void) => {
        listeners.add(callback);
        return () => listeners.delete(callback);
      },
    },
  };
});

import { SpotifyEmbed } from '../SpotifyEmbed';
import { SpotifyEmbedSettings } from '../../settings/sections/SpotifyEmbedSettings';

const ID = '4cOdK2wGLETKBW3PvgPWqT';
const KEY = 'windom_spotify_embed';

/** One shared bus, delivering to every channel but the sender, as the browser does. */
class FakeChannel {
  static open = new Set<FakeChannel>();
  onmessage: ((e: { data: unknown }) => void) | null = null;
  constructor() {
    FakeChannel.open.add(this);
  }
  postMessage(data: unknown) {
    FakeChannel.open.forEach((c) => c !== this && c.onmessage?.({ data }));
  }
  close() {
    FakeChannel.open.delete(this);
  }
}

const flush = () => act(async () => {});
const frames = () => screen.queryAllByTitle('Spotify player') as HTMLIFrameElement[];

function playback(frame: HTMLIFrameElement, isPaused: boolean, origin = 'https://open.spotify.com') {
  act(() => {
    window.dispatchEvent(
      new MessageEvent('message', {
        origin,
        source: frame.contentWindow,
        data: { type: 'playback_update', payload: { isPaused } },
      }),
    );
  });
}

beforeEach(() => {
  store.clear();
  listeners.clear();
  FakeChannel.open.clear();
  vi.stubGlobal('BroadcastChannel', FakeChannel);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('SpotifyEmbed', () => {
  it('loads nothing from Spotify until a link is saved', async () => {
    render(<SpotifyEmbed />);
    await flush();
    expect(frames()).toHaveLength(0);
  });

  it('ignores a stored value that is not a Spotify item', async () => {
    store.set(KEY, 'https://evil.example/track/x');
    render(<SpotifyEmbed />);
    await flush();
    expect(frames()).toHaveLength(0);
  });

  it('shows a link saved in settings, and removes it again', async () => {
    render(
      <>
        <SpotifyEmbed />
        <SpotifyEmbedSettings />
      </>,
    );
    await flush();
    fireEvent.change(screen.getByLabelText('Play a Spotify link'), {
      target: { value: `https://open.spotify.com/playlist/${ID}?si=1` },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Show player' }));
    await flush();
    expect(frames()[0].src).toBe(`https://open.spotify.com/embed/playlist/${ID}`);
    expect(store.get(KEY)).toBe(`spotify:playlist:${ID}`);

    fireEvent.click(screen.getByRole('button', { name: 'Remove player' }));
    await flush();
    expect(frames()).toHaveLength(0);
    expect(store.has(KEY)).toBe(false);
  });

  it('says so when the link is not from Spotify, and saves nothing', async () => {
    render(<SpotifyEmbedSettings />);
    await flush();
    fireEvent.change(screen.getByLabelText('Play a Spotify link'), { target: { value: 'https://example.com' } });
    fireEvent.click(screen.getByRole('button', { name: 'Show player' }));
    await flush();
    expect(screen.getByRole('alert').textContent).toContain('not a Spotify link');
    expect(store.has(KEY)).toBe(false);
  });

  it('pauses the tab that was playing when another one starts', async () => {
    store.set(KEY, `spotify:track:${ID}`);
    render(
      <>
        <SpotifyEmbed />
        <SpotifyEmbed />
      </>,
    );
    await flush();
    const [first, second] = frames();
    const toFirst = vi.spyOn(first.contentWindow!, 'postMessage');
    const toSecond = vi.spyOn(second.contentWindow!, 'postMessage');

    playback(first, false);
    expect(toFirst).not.toHaveBeenCalled();
    expect(toSecond).not.toHaveBeenCalled();

    playback(second, false);
    expect(toFirst).toHaveBeenCalledExactlyOnceWith({ command: 'toggle' }, 'https://open.spotify.com');
    expect(toSecond).not.toHaveBeenCalled();
  });

  it('ignores playback messages from another origin', async () => {
    store.set(KEY, `spotify:track:${ID}`);
    render(
      <>
        <SpotifyEmbed />
        <SpotifyEmbed />
      </>,
    );
    await flush();
    const [first, second] = frames();
    playback(first, false);
    const toFirst = vi.spyOn(first.contentWindow!, 'postMessage');
    playback(second, false, 'https://evil.example');
    expect(toFirst).not.toHaveBeenCalled();
  });
});
