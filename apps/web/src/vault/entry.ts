export const MODULE = 'passwords';
const HISTORY_LIMIT = 10;

export interface HistoryEntry {
  password: string;
  changedAt: string;
}

export interface PasswordEntry {
  title: string;
  username: string;
  password: string;
  urls: string[];
  notes: string;
  history: HistoryEntry[];
}

export interface VaultItem {
  id: string;
  revision: number;
  entry: PasswordEntry;
}

export function emptyEntry(): PasswordEntry {
  return { title: '', username: '', password: '', urls: [], notes: '', history: [] };
}

const asString = (v: unknown) => (typeof v === 'string' ? v : '');

export function parseEntry(json: string): PasswordEntry {
  const raw: unknown = JSON.parse(json);
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const history = Array.isArray(o.history)
    ? o.history
        .filter((h): h is Record<string, unknown> => !!h && typeof h === 'object')
        .map((h) => ({ password: asString(h.password), changedAt: asString(h.changedAt) }))
    : [];
  return {
    title: asString(o.title),
    username: asString(o.username),
    password: asString(o.password),
    urls: Array.isArray(o.urls) ? o.urls.map(asString).filter(Boolean) : [],
    notes: asString(o.notes),
    history,
  };
}

function dedupeHistory(history: HistoryEntry[], current: string): HistoryEntry[] {
  const seen = new Set<string>([current]);
  return history
    .filter((h) => {
      if (seen.has(h.password)) return false;
      seen.add(h.password);
      return true;
    })
    .slice(0, HISTORY_LIMIT);
}

export function withHistory(
  previous: PasswordEntry | undefined,
  next: PasswordEntry,
  now = new Date(),
): PasswordEntry {
  const changed = previous && previous.password !== '' && previous.password !== next.password;
  const history = changed
    ? [{ password: previous.password, changedAt: now.toISOString() }, ...next.history]
    : next.history;
  return { ...next, history: dedupeHistory(history, next.password) };
}

export function resolveConflict(
  remote: PasswordEntry,
  local: PasswordEntry,
  now = new Date(),
): PasswordEntry {
  const merged = { ...local, history: [...local.history, ...remote.history] };
  return withHistory(remote, merged, now);
}

export function matchesSearch(entry: PasswordEntry, query: string): boolean {
  const q = query.trim().toLocaleLowerCase('de');
  if (!q) return true;
  return [entry.title, entry.username, ...entry.urls].some((f) =>
    f.toLocaleLowerCase('de').includes(q),
  );
}

export function normalizeUrl(input: string): string {
  const url = input.trim();
  if (!url) return '';
  return /^[a-z][a-z0-9+.-]*:/i.test(url) ? url : `https://${url}`;
}

export function safeHref(url: string): string | null {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:' ? parsed.href : null;
  } catch {
    return null;
  }
}

export function newItemId(): string {
  const b = globalThis.crypto.getRandomValues(new Uint8Array(16));
  b[6] = ((b[6] ?? 0) & 0x0f) | 0x40;
  b[8] = ((b[8] ?? 0) & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

export type CharClass = 'lower' | 'upper' | 'digit' | 'symbol';

export function charClass(c: string): CharClass {
  if (/[0-9]/.test(c)) return 'digit';
  if (/[A-Z]/.test(c)) return 'upper';
  if (/[a-z]/.test(c)) return 'lower';
  return 'symbol';
}
