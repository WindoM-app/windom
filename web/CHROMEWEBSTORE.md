# Chrome Web Store submission notes

What to paste into the Developer Dashboard. Update this file whenever
`manifest.json` changes, and keep it in step with the permission table in the
[privacy policy](https://windom.app/privacy) (source in
[WindoM-app/website](https://github.com/WindoM-app/website), English and Hebrew).

## Single purpose

WindoM replaces the new tab page with a personal dashboard: clock, weather,
tasks, quick links, search, and optional calendar, music, code review and market
widgets.

## Permission justifications

| Permission           | Justification                                                                                                                                                                                                             |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `storage`            | Saves the user's settings, tasks and quick links, and syncs settings between the user's browsers.                                                                                                                         |
| `unlimitedStorage`   | Stores wallpapers the user uploads and cached images, which can exceed the default quota.                                                                                                                                 |
| `tabs`               | Lists open tabs in the tab sidebar and in search, switches to the chosen tab, runs the search overlay's tab commands, opens or switches to the Spotify web player from the player, and closes a duplicate WindoM new tab. |
| `identity`           | Runs the sign-in and account-connection windows for Google, Google Calendar and Spotify.                                                                                                                                  |
| `history` (optional) | Shows recently visited sites and history matches in search. Requested only when the user turns the History app on, and given back when it is turned off.                                                                  |

## Content script (`http://*/*`, `https://*/*`)

The search overlay opens with Ctrl+Cmd+H on whatever page the user is viewing,
so the shortcut listener has to be present on every page. Until the shortcut is
pressed the script only listens for it. It runs in the top frame only. The one
thing it reads from the page is the text direction; it does not read, store or
send page content.

## Host permissions

| Host                           | Justification                                                                       |
| ------------------------------ | ----------------------------------------------------------------------------------- |
| `api.unsplash.com`             | Fetches background photographs.                                                     |
| `api.open-meteo.com`           | Fetches the weather forecast.                                                       |
| `geocoding-api.open-meteo.com` | Turns the city the user types into coordinates.                                     |
| `nominatim.openstreetmap.org`  | Turns coordinates into a place name, after the user allows location.                |
| `ipapi.co`                     | Rough location when the user has allowed location but the browser cannot get a fix. |
| `duckduckgo.com`               | Search suggestions as the user types in the search box.                             |
| `windom-api.fly.dev`           | The WindoM server: optional account, settings sync and connected services.          |
| `query1.finance.yahoo.com`     | Stock search and quotes for the user's watchlist.                                   |
| `api.coingecko.com`            | Cryptocurrency prices for the user's watchlist.                                     |

## Data use disclosures

- No analytics, advertising or tracking. Data is not sold, and is used only for
  the features the user turns on.
- An account is optional. Google Calendar access is read-only.
- Open tabs and history are read in the browser to show them to the user and are
  not sent to the WindoM server.
- Text typed into the search box is sent to DuckDuckGo for suggestions.

The privacy policy is the full statement: <https://windom.app/privacy>.

## Before submitting

- [ ] Every entry in `manifest.json` has a row above, and no row is left over.
- [ ] The privacy policy's permission table matches.
- [ ] Screenshots show the current interface.
