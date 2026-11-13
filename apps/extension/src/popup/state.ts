import { api, authed, setApiBase } from '@web/api';
import { cryptoCall } from '@web/crypto/client';
import { login } from '@web/session';
import { allFields, emptyItem, fieldValue, totpFields, type Item } from '@web/vault/item';
import { VaultsManager } from '@web/vault/manager';
import { hostOf } from '../shared/match';
import { AUTO_LOCK_MINUTES, PENDING_KEY, SESSION_KEY, type Login, type PendingSave, type Snapshot } from '../shared/messages';
import { dropPending, loadPending, newestPending } from '../shared/pending';

export interface Unlocked {
  snapshot: Snapshot;
  manager: VaultsManager;
}

export interface Prefs {
  server: string;
  email: string;
}

export async function loadPrefs(): Promise<Prefs> {
  const p = (await chrome.storage.local.get(['server', 'email'])) as Partial<Prefs>;
  return { server: p.server ?? '', email: p.email ?? '' };
}

export { InsecureServerError, normalizeServer } from '../shared/server';

function logins(manager: VaultsManager): Login[] {
  return manager
    .getSnapshot()
    .items.filter((v) => v.item.type === 'login')
    .map((v) => ({
      vaultId: v.vaultId,
      id: v.id,
      title: v.item.title,
      username: fieldValue(v.item, 'username'),
      password: fieldValue(v.item, 'password'),
      totp: totpFields(v.item)[0]?.value ?? '',
      urls: allFields(v.item)
        .filter((f) => f.kind === 'url' && f.value)
        .map((f) => f.value),
    }));
}

async function capture(base: Omit<Snapshot, 'logins' | 'spaces' | 'keys' | 'lastUsed'>, manager: VaultsManager, lastUsed = Date.now()): Promise<Snapshot> {
  const snapshot: Snapshot = {
    ...base,
    logins: logins(manager),
    spaces: manager.getSnapshot().vaults.map((v) => ({ id: v.id, name: v.name, canWrite: v.canWrite })),
    keys: await cryptoCall('exportVaultKeys'),
    lastUsed,
  };
  await chrome.storage.session.set({ [SESSION_KEY]: snapshot });
  return snapshot;
}

export async function unlock(server: string, email: string, password: string): Promise<Unlocked> {
  setApiBase(server);
  const session = await login(email, password);
  await session.vaults.sync();
  await chrome.storage.local.set({ server, email });
  const snapshot = await capture({ server, email, userId: session.userId, token: session.token }, session.vaults);
  return { snapshot, manager: session.vaults };
}

export function expired(snapshot: Snapshot, now: number): boolean {
  return now - snapshot.lastUsed > AUTO_LOCK_MINUTES * 60_000;
}

export async function restore(byUser: boolean): Promise<Unlocked | null> {
  const stored = (await chrome.storage.session.get(SESSION_KEY))[SESSION_KEY] as Snapshot | undefined;
  if (!stored) return null;
  if (expired(stored, Date.now())) {
    await chrome.storage.session.remove([SESSION_KEY, PENDING_KEY]);
    return null;
  }
  setApiBase(stored.server);
  await cryptoCall('importVaultKeys', { keys: stored.keys });
  const manager = new VaultsManager(stored.userId, authed(stored.token), cryptoCall, undefined, undefined, false);
  await manager.sync();
  const snapshot = await capture(stored, manager, byUser ? Date.now() : stored.lastUsed);
  return { snapshot, manager };
}

export async function refresh(u: Unlocked): Promise<Unlocked> {
  await u.manager.sync();
  return { ...u, snapshot: await capture(u.snapshot, u.manager) };
}

export async function lockAll(u: Unlocked | null) {
  await chrome.storage.session.remove([SESSION_KEY, PENDING_KEY]);
  await cryptoCall('lock');
  if (u) await api.logout(u.snapshot.token).catch(() => undefined);
}

export async function pendingSave(host: string | null): Promise<PendingSave | null> {
  const all = await loadPending();
  return (host ? all[host] : undefined) ?? newestPending(all);
}

export async function dismissPending(pending: PendingSave) {
  const host = hostOf(pending.url);
  if (host) await dropPending(host);
}

export function existingFor(snapshot: Snapshot, pending: PendingSave): Login | undefined {
  const host = hostOf(pending.url);
  return snapshot.logins.find((l) => l.urls.some((u) => hostOf(u) === host) && l.username === pending.username);
}

export function itemFromPending(pending: PendingSave): Item {
  const item = emptyItem('login');
  const url = new URL(pending.url);
  item.title = url.hostname.replace(/^www\./, '');
  item.fields = item.fields.map((f) =>
    f.id === 'username' ? { ...f, value: pending.username } : f.id === 'password' ? { ...f, value: pending.password } : f.id === 'website' ? { ...f, value: url.origin } : f,
  );
  return item;
}

export async function activeTab(): Promise<chrome.tabs.Tab | undefined> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}
