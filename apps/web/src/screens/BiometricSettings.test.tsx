import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { BiometricSettings } from './BiometricSettings';
import type { NativePlatform } from '../platform';
import type { Session } from '../session';

afterEach(cleanup);

const session = { userId: 'test-user', token: 'test-token' } as Session;

function platform(configured = false) {
  return {
    server: 'https://example.test',
    supportsAutofill: false as boolean,
    biometricStatus: vi.fn().mockResolvedValue(configured),
    enableBiometric: vi.fn().mockResolvedValue(undefined),
    disableBiometric: vi.fn().mockResolvedValue(undefined),
    publishAutofill: vi.fn().mockResolvedValue(undefined),
    syncPasskeys: vi.fn().mockResolvedValue(undefined),
    setServer: vi.fn(),
    unlockBiometric: vi.fn(),
    biometricKeepsToken: vi.fn(),
    onLock: vi.fn(),
    saveExport: vi.fn(),
  } satisfies NativePlatform;
}

describe('biometric settings', () => {
  it('loads persisted setup when reopened without prompting for biometric unlock', async () => {
    const native = platform(true);
    const first = render(<BiometricSettings platform={native} session={session} />);
    await screen.findByText('Einrichtung gespeichert');
    expect(screen.getByRole('button', { name: 'Deaktivieren' })).toBeTruthy();
    first.unmount();
    render(<BiometricSettings platform={native} session={session} />);
    await screen.findByText('Einrichtung gespeichert');
    expect(native.biometricStatus).toHaveBeenCalledTimes(2);
    expect(native.unlockBiometric).not.toHaveBeenCalled();
  });

  it('shows success only after native activation and a confirming status query', async () => {
    const native = platform();
    let complete!: () => void;
    native.enableBiometric.mockImplementation(() => new Promise<void>((resolve) => { complete = resolve; }));
    render(<BiometricSettings platform={native} session={session} />);
    await screen.findByText('Nicht eingerichtet');
    const button = screen.getByRole('button', { name: 'Auf diesem Gerät aktivieren' });
    fireEvent.click(button);
    fireEvent.click(button);
    expect(native.enableBiometric).toHaveBeenCalledTimes(1);
    expect((button as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByRole('status')).toBeNull();
    native.biometricStatus.mockResolvedValue(true);
    await act(async () => complete());
    await screen.findByText('Einrichtung gespeichert');
    expect(screen.getByRole('status').textContent).toContain('für dieses Konto');
  });

  it('does not claim success if activation returns but setup cannot be confirmed', async () => {
    const native = platform();
    render(<BiometricSettings platform={native} session={session} />);
    await screen.findByText('Nicht eingerichtet');
    fireEvent.click(screen.getByRole('button', { name: 'Auf diesem Gerät aktivieren' }));
    await screen.findByRole('alert');
    expect(screen.getByRole('alert').textContent).toContain('Einrichten nicht bestätigt');
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('keeps failed deactivation visible and confirms a successful retry', async () => {
    const native = platform(true);
    native.disableBiometric.mockRejectedValueOnce(new Error('cancelled'));
    render(<BiometricSettings platform={native} session={session} />);
    await screen.findByText('Einrichtung gespeichert');
    fireEvent.click(screen.getByRole('button', { name: 'Deaktivieren' }));
    await screen.findByRole('alert');
    expect(screen.getByText('Einrichtung gespeichert')).toBeTruthy();
    native.biometricStatus.mockResolvedValue(false);
    fireEvent.click(screen.getByRole('button', { name: 'Deaktivieren' }));
    await screen.findByText('Nicht eingerichtet');
    expect(screen.getByRole('status').textContent).toContain('deaktiviert');
  });

  it('shows unknown status after a read error and supports retry without guessing', async () => {
    const native = platform();
    native.biometricStatus.mockRejectedValueOnce(new Error('storage_unavailable'));
    render(<BiometricSettings platform={native} session={session} />);
    await screen.findByText('Status unbekannt');
    expect((screen.getByRole('button', { name: 'Auf diesem Gerät aktivieren' }) as HTMLButtonElement).disabled).toBe(true);
    native.biometricStatus.mockResolvedValue(true);
    fireEvent.click(screen.getByRole('button', { name: 'Status erneut prüfen' }));
    await screen.findByText('Einrichtung gespeichert');
  });

  it('ignores a delayed status response belonging to the previous account', async () => {
    const native = platform(false);
    let oldResponse!: (value: boolean) => void;
    native.biometricStatus.mockImplementationOnce(() => new Promise<boolean>((resolve) => { oldResponse = resolve; }));
    const view = render(<BiometricSettings platform={native} session={session} />);
    view.rerender(<BiometricSettings platform={native} session={{ ...session, userId: 'other', token: 'other-token' }} />);
    await screen.findByText('Nicht eingerichtet');
    await act(async () => oldResponse(true));
    expect(screen.queryByText('Einrichtung gespeichert')).toBeNull();
  });

  it('ignores an activation result after switching to another account', async () => {
    const native = platform(false);
    let complete!: () => void;
    native.enableBiometric.mockImplementation(() => new Promise<void>((resolve) => { complete = resolve; }));
    const view = render(<BiometricSettings platform={native} session={session} />);
    await screen.findByText('Nicht eingerichtet');
    fireEvent.click(screen.getByRole('button', { name: 'Auf diesem Gerät aktivieren' }));
    view.rerender(<BiometricSettings platform={native} session={{ ...session, userId: 'other', token: 'other-token' }} />);
    await screen.findByText('Nicht eingerichtet');
    await act(async () => complete());
    expect(screen.queryByRole('status')).toBeNull();
    expect(native.biometricStatus).toHaveBeenCalledTimes(2);
  });

  it('reports AutoFill failure inline without reporting a successful publication', async () => {
    const native = platform(true);
    native.supportsAutofill = true;
    native.publishAutofill.mockRejectedValue(new Error('biometric_unavailable'));
    render(<BiometricSettings platform={native} session={session} />);
    await screen.findByText('Einrichtung gespeichert');
    fireEvent.click(screen.getByRole('button', { name: 'Passwörter für iOS AutoFill aktualisieren' }));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('AutoFill konnte nicht aktualisiert'));
    expect(screen.queryByRole('status')).toBeNull();
  });
});
