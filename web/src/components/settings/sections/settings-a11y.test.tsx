import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { defaultSettings } from '../../../types/settings';
import { ClockSettings } from './ClockSettings';

vi.mock('../../../contexts/SettingsContext', () => ({
  useSettings: () => ({
    settings: { ...defaultSettings, clock: { ...defaultSettings.clock, timeFormat: '24h', showDate: true } },
    update: vi.fn(),
  }),
}));
afterEach(cleanup);

describe('settings form accessibility', () => {
  it('names each segmented control and exposes the chosen option', () => {
    render(<ClockSettings />);
    expect(screen.getByRole('group', { name: 'Time Format' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '24-hour' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('button', { name: '12-hour' }).getAttribute('aria-pressed')).toBe('false');
  });

  it('names the date format select by its visible label', () => {
    render(<ClockSettings />);
    expect(screen.getByRole('button', { name: /^Date Format/ })).toBeTruthy();
  });
});
