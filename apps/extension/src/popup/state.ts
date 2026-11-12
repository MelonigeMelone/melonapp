import { api, authed, setApiBase } from '@web/api';
import { cryptoCall } from '@web/crypto/client';
import { login } from '@web/session';
import { allFields, emptyItem, fieldValue, totpFields, type Item } from '@web/vault/item';
import { VaultsManager } from '@web/vault/manager';
import { hostOf } from '../shared/match';
import { PENDING_KEY, SESSION_KEY, type Login, type PendingSave, type Snapshot } from '../shared/messages';

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

export function normalizeServer(input: string): string {
  const trimmed = input.trim().replace(/\/+$/, '');
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

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

async function capture(base: Omit<Snapshot, 'logins' | 'spaces' | 'keys' | 'lastUsed'>, manager: VaultsManager): Promise<Snapshot> {
  const snapshot: Snapshot = {
    ...base,
    logins: logins(manager),
    spaces: manager.getSnapshot().vaults.map((v) => ({ id: v.id, name: v.name, canWrite: v.canWrite })),
    keys: await cryptoCall('exportVaultKeys'),
    lastUsed: Date.now(),
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

export async function restore(): Promise<Unlocked | null> {
  const stored = (await chrome.storage.session.get(SESSION_KEY))[SESSION_KEY] as Snapshot | undefined;
  if (!stored) return null;
  setApiBase(stored.server);
  await cryptoCall('importVaultKeys', { keys: stored.keys });
  const manager = new VaultsManager(stored.userId, authed(stored.token), cryptoCall, undefined, undefined, false);
  await manager.sync();
  const snapshot = await capture(stored, manager);
  return { snapshot, manager };
}

export async function refresh(u: Unlocked): Promise<Unlocked> {
  await u.manager.sync();
  return { ...u, snapshot: await capture(u.snapshot, u.manager) };
}

export async function lockAll(u: Unlocked | null) {
  await chrome.storage.session.remove(SESSION_KEY);
  await cryptoCall('lock');
  if (u) await api.logout(u.snapshot.token).catch(() => undefined);
}

export async function pendingSave(): Promise<PendingSave | null> {
  return ((await chrome.storage.session.get(PENDING_KEY))[PENDING_KEY] as PendingSave | undefined) ?? null;
}

export async function dismissPending() {
  await chrome.storage.session.remove(PENDING_KEY);
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
