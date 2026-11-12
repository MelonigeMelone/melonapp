import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { setNativeRequest } from '../../web/src/api';
import { setNativePlatform } from '../../web/src/platform';
import { open, type Session } from '../../web/src/session';
import { importPasskeys, vaultPasskeys, type PendingPasskey } from '../../web/src/vault/passkeys';
import './mobile.css';

setNativeRequest((method, path, opts) => invoke('api_request', { method, path, opts }));
const platform = {
  server: await invoke<string>('get_server'),
  supportsAutofill: await invoke<boolean>('is_ios'),
  async publishAutofill(session: Session) {
    await session.vaults.sync();
    const entries = session.vaults.getSnapshot().items.filter((v) => v.item.type === 'login').map((v) => ({
      id: `${v.vaultId}/${v.id}`,
      user: v.item.fields.find((f) => f.id === 'username')?.value ?? '',
      password: v.item.fields.find((f) => f.id === 'password')?.value ?? '',
      urls: [...v.item.fields, ...v.item.sections.flatMap((section) => section.fields)].filter((f) => f.kind === 'url').map((f) => /^[a-z][a-z0-9+.-]*:/i.test(f.value) ? f.value : `https://${f.value}`),
    }));
    const passkeys = vaultPasskeys(session.vaults.getSnapshot().items);
    await invoke('autofill_publish', { userId: session.userId, entries, passkeys });
  },
  async syncPasskeys(session: Session) {
    if (!platform.supportsAutofill) return;
    await session.vaults.sync();
    const pending = await invoke<PendingPasskey[]>('passkeys_pending', { userId: session.userId });
    const done = pending.length ? await importPasskeys(session.vaults, pending) : [];
    if (done.length) await invoke('passkeys_acknowledge', { userId: session.userId, files: done });
    if (await invoke<boolean>('autofill_active', { userId: session.userId })) await platform.publishAutofill(session);
  },
  async setServer(value: string) {
    await invoke('set_server', { value });
    platform.server = value;
  },
  async enableBiometric(session: Session) {
    const { vaults, ...metadata } = session;
    await invoke('biometric_enable', { metadata });
  },
  async biometricStatus() { return invoke<boolean>('biometric_status'); },
  async unlockBiometric() {
    const s = await invoke<Omit<Session, 'vaults'>>('biometric_unlock');
    return open(s.email, s.userId, s.token, s);
  },
  async disableBiometric() { await invoke('biometric_disable'); },
  async biometricKeepsToken(token: string) { return invoke<boolean>('biometric_keeps_token', { token }); },
  async onLock(callback: () => void) { return listen('melon-locked', callback); },
};
setNativePlatform(platform);
let lastActivity = 0;
for (const event of ['pointerdown', 'keydown', 'touchstart', 'wheel']) {
  window.addEventListener(event, () => {
    if (Date.now() - lastActivity < 5000) return;
    lastActivity = Date.now();
    void invoke('crypto_call', { method: 'activity', args: null }).catch(() => undefined);
  }, { passive: true });
}
await import('../../web/src/main');
