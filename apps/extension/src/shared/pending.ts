import { PENDING_KEY, PENDING_KEEP_MS, type PendingSave } from './messages';

export type PendingByHost = Record<string, PendingSave>;

function valid(p: unknown): p is PendingSave {
  if (!p || typeof p !== 'object') return false;
  const { url, username, password, at } = p as Record<string, unknown>;
  return typeof url === 'string' && typeof username === 'string' && typeof password === 'string' && typeof at === 'number';
}

export function freshPending(stored: unknown, now: number): PendingByHost {
  const out: PendingByHost = {};
  if (!stored || typeof stored !== 'object' || Array.isArray(stored)) return out;
  for (const [host, p] of Object.entries(stored as Record<string, unknown>)) {
    if (valid(p) && now - p.at < PENDING_KEEP_MS) out[host] = p;
  }
  return out;
}

export async function loadPending(): Promise<PendingByHost> {
  const stored = (await chrome.storage.session.get(PENDING_KEY))[PENDING_KEY];
  return freshPending(stored, Date.now());
}

async function store(all: PendingByHost) {
  if (Object.keys(all).length === 0) await chrome.storage.session.remove(PENDING_KEY);
  else await chrome.storage.session.set({ [PENDING_KEY]: all });
}

export async function putPending(host: string, pending: PendingSave) {
  await store({ ...(await loadPending()), [host]: pending });
}

export async function dropPending(host: string) {
  const all = await loadPending();
  delete all[host];
  await store(all);
}

export async function prunePending() {
  await store(await loadPending());
}

export function newestPending(all: PendingByHost): PendingSave | null {
  return Object.values(all).sort((a, b) => b.at - a.at)[0] ?? null;
}
