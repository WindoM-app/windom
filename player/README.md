# Spotify player page (`player.windom.app`)

Chrome does not let an extension run remote code in its own pages, so Spotify's
Web Playback SDK runs here and the extension frames this page in a hidden
document. Part of [#576](https://github.com/WindoM-app/windom/issues/576).

## Hosting

Cloudflare Workers static assets (free plan), configured by
[`wrangler.jsonc`](../wrangler.jsonc) at the repository root and deployed by
Cloudflare's Git integration:

| Setting in the dashboard | Value |
|---|---|
| Project name | `windom-player` (must match `wrangler.jsonc`) |
| Production branch | `main` |
| Build command | empty |
| Deploy command | `npx wrangler deploy` |
| Preview builds | off |
| Build watch paths | `player/*`, `wrangler.jsonc` |

The deploy attaches `player.windom.app` itself. Do not enable analytics or any
other script injection.

## Rules

- Load nothing but `player.js` and `sdk.scdn.co`. `_headers` enforces it.
- Talk only to the store extension's origin. It appears in `player.js` and in
  `_headers`; they must match. An unpacked build has another ID unless its
  manifest carries the store's public `key`.
- Store nothing and keep no token.

## Messages

| From the page | To the page |
|---|---|
| `hello`, `token-request`, `ready {deviceId}`, `not-ready`, `error {kind, message}`, `state {idle, paused, positionMs, trackUri, contextUri}` | `init`, `token {token}`, `disconnect` |
