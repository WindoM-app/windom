import { useEffect, useRef } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useSettings } from '../contexts/SettingsContext';
import { apiGet } from '../lib/api';
import { createLogger } from '../lib/logger';
import { setGmailAvailable } from '../lib/server-features';

const log = createLogger('integrations');

interface IntegrationsResponse {
  google: { connected: boolean; scopes: string[] };
  spotify: { connected: boolean };
  github: { connected: boolean };
  /** Absent on servers older than the Gmail feature flag; treated as on. */
  features?: { gmail?: boolean };
}

const PROVIDERS = ['calendar', 'spotify', 'gmail', 'github'] as const;
type Provider = (typeof PROVIDERS)[number];

/**
 * Syncs calendar/spotify connected state from the server once both
 * settings storage and auth init have finished. Clears both flags on logout.
 *
 * Must be called inside a component below both AuthProvider and SettingsProvider.
 */
export function useIntegrationSync() {
  const { user, authLoading } = useAuth();
  const { settings, updateMultiple, loaded: settingsLoaded } = useSettings();
  const userId = user?.id;

  // The effect below must merge into the *current* integrations section
  // (updateMultiple replaces each provider's sub-object wholesale), but must not
  // re-run when that section changes: it writes the section itself, so depending
  // on it would loop. A ref gives the effect the latest value without making it
  // a trigger. It is read when the write happens, so a response that lands after
  // a settings change merges into the newer section rather than a stale render's.
  const integrationsRef = useRef(settings.integrations);
  useEffect(() => {
    integrationsRef.current = settings.integrations;
  }, [settings.integrations]);

  useEffect(() => {
    if (!settingsLoaded || authLoading) return;

    // Only a changed flag is worth a write: every write also uploads the section.
    const apply = (flags: Record<Provider, boolean>) => {
      const current = integrationsRef.current;
      if (PROVIDERS.every((p) => current[p].connected === flags[p])) return;
      void updateMultiple({
        integrations: {
          ...current,
          calendar: { ...current.calendar, connected: flags.calendar },
          spotify: { ...current.spotify, connected: flags.spotify },
          gmail: { ...current.gmail, connected: flags.gmail },
          github: { ...current.github, connected: flags.github },
        },
      });
    };

    if (!userId) {
      apply({ calendar: false, spotify: false, gmail: false, github: false });
      return;
    }

    let cancelled = false;

    void (async () => {
      try {
        const { google, spotify, github, features } = await apiGet<IntegrationsResponse>('/integrations');
        if (cancelled) return;
        // A server with Gmail off never grants the scope, so a stale `connected`
        // flag from before it was turned off would keep the widget polling an
        // endpoint that now refuses it.
        // A server predating the flag sends no `features` block at all; it is
        // the only case where absence means "on".
        const gmailOffered = features ? features.gmail === true : true;
        setGmailAvailable(gmailOffered);
        const hasGmailScope = gmailOffered && google.scopes.some((s) => s.includes('gmail'));
        apply({
          calendar: google.connected,
          spotify: spotify.connected,
          gmail: google.connected && hasGmailScope,
          github: github.connected,
        });
      } catch (err: unknown) {
        log.error('Failed to sync integration status:', err);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [userId, settingsLoaded, authLoading, updateMultiple]);
}
