import { fireEvent, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

const mount = vi.fn();
vi.mock('./mount', () => ({ mount }));

describe('content script', () => {
  it('loads and mounts the overlay once, only on the shortcut', async () => {
    await import('./index');
    fireEvent.keyDown(document, { key: 'h', ctrlKey: true });
    fireEvent.keyDown(document, { key: 'h' });
    expect(mount).not.toHaveBeenCalled();
    fireEvent.keyDown(document, { key: 'h', ctrlKey: true, metaKey: true });
    await waitFor(() => expect(mount).toHaveBeenCalledTimes(1));
    fireEvent.keyDown(document, { key: 'h', ctrlKey: true, metaKey: true });
    await Promise.resolve();
    expect(mount).toHaveBeenCalledTimes(1);
  });
});
