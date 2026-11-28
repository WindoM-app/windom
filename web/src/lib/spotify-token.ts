/** Where a Spotify access token comes from: this device now, the WindoM account later (#575). */
import type { SpotifyResult } from './spotify-api';

export interface SpotifyTokenSource {
  /**
   * An access token that is still valid. Pass the token Spotify just refused as
   * `refused` to get a newer one.
   */
  getAccessToken(options?: { refused?: string }): Promise<SpotifyResult<string>>;
  disconnect(): Promise<void>;
}
