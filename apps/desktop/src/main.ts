import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { setNativeRequest } from '../../web/src/api';
import { setNativePlatform } from '../../web/src/platform';
import { open, type Session } from '../../web/src/session';
import './mobile.css';

setNativeRequest((method, path, opts) => invoke('api_request', { method, path, opts }));
const platform = {
  server: await invoke<string>('get_server'),
  async setServer(value: string) {
    await invoke('set_server', { value });
    platform.server = value;
  },
  async enableBiometric(session: Session) {
    const { vaults, ...metadata } = session;
    await invoke('biometric_enable', { metadata });
  },
  async unlockBiometric() {
    const s = await invoke<Omit<Session, 'vaults'>>('biometric_unlock');
    return open(s.email, s.userId, s.token, s);
  },
  async disableBiometric() { await invoke('biometric_disable'); },
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
