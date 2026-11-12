export type FieldKind = 'text' | 'concealed' | 'totp' | 'url' | 'email' | 'phone' | 'date' | 'multiline';
export type ItemType = 'login' | 'note' | 'card' | 'identity' | 'wifi';

export interface Field {
  id: string;
  label: string;
  kind: FieldKind;
  value: string;
}

export interface Section {
  id: string;
  title: string;
  fields: Field[];
}

export interface HistoryEntry {
  fieldId: string;
  label: string;
  value: string;
  changedAt: string;
}

export interface Item {
  type: ItemType;
  title: string;
  fields: Field[];
  sections: Section[];
  notes: string;
  history: HistoryEntry[];
  seq: number;
  trashedAt?: string;
}

export interface VaultItem {
  vaultId: string;
  id: string;
  revision: number;
  item: Item;
}

const HISTORY_LIMIT = 20;
const LATEST_DATE = Date.UTC(9999, 0, 1);
const KINDS: FieldKind[] = ['text', 'concealed', 'totp', 'url', 'email', 'phone', 'date', 'multiline'];
const TYPES: ItemType[] = ['login', 'note', 'card', 'identity', 'wifi'];

type Template = { label: string; fields: Omit<Field, 'value'>[] };

export const TEMPLATES: Record<ItemType, Template> = {
  login: {
    label: 'Login',
    fields: [
      { id: 'username', label: 'Benutzername', kind: 'text' },
      { id: 'password', label: 'Passwort', kind: 'concealed' },
      { id: 'website', label: 'Website', kind: 'url' },
    ],
  },
  note: { label: 'Sichere Notiz', fields: [] },
  card: {
    label: 'Kreditkarte',
    fields: [
      { id: 'cardholder', label: 'Karteninhaber', kind: 'text' },
      { id: 'number', label: 'Kartennummer', kind: 'concealed' },
      { id: 'expiry', label: 'Gültig bis', kind: 'text' },
      { id: 'cvc', label: 'Prüfnummer', kind: 'concealed' },
      { id: 'pin', label: 'PIN', kind: 'concealed' },
    ],
  },
  identity: {
    label: 'Identität',
    fields: [
      { id: 'name', label: 'Name', kind: 'text' },
      { id: 'birthday', label: 'Geburtsdatum', kind: 'date' },
      { id: 'address', label: 'Adresse', kind: 'multiline' },
      { id: 'phone', label: 'Telefon', kind: 'phone' },
      { id: 'email', label: 'E-Mail', kind: 'email' },
    ],
  },
  wifi: {
    label: 'WLAN',
    fields: [
      { id: 'ssid', label: 'Netzwerkname', kind: 'text' },
      { id: 'password', label: 'Passwort', kind: 'concealed' },
      { id: 'security', label: 'Sicherheit', kind: 'text' },
    ],
  },
};

export const KIND_LABELS: Record<FieldKind, string> = {
  text: 'Text',
  concealed: 'Verborgen',
  totp: 'Einmalcode (2FA)',
  url: 'URL',
  email: 'E-Mail',
  phone: 'Telefon',
  date: 'Datum',
  multiline: 'Mehrzeiliger Text',
};

const TOTP_LABEL = /totp|einmalcode|2fa|one-time|authenticator/i;

export function isTotpField(f: Field): boolean {
  if (f.kind === 'totp') return true;
  if (f.kind !== 'concealed' || !f.value) return false;
  return /^otpauth:\/\/totp\//i.test(f.value.trim()) || (TOTP_LABEL.test(f.label) && /^[A-Za-z2-7=\s-]{16,}$/.test(f.value.trim()));
}

export function totpFields(item: Item): Field[] {
  return allFields(item).filter(isTotpField);
}

export function newId(): string {
  const b = globalThis.crypto.getRandomValues(new Uint8Array(16));
  b[6] = ((b[6] ?? 0) & 0x0f) | 0x40;
  b[8] = ((b[8] ?? 0) & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

export function emptyItem(type: ItemType): Item {
  return {
    type,
    title: '',
    fields: TEMPLATES[type].fields.map((f) => ({ ...f, value: '' })),
    sections: [],
    notes: '',
    history: [],
    seq: 0,
  };
}

const str = (v: unknown) => (typeof v === 'string' ? v : '');
const obj = (v: unknown) => (v && typeof v === 'object' ? (v as Record<string, unknown>) : {});

function parseField(raw: unknown): Field {
  const o = obj(raw);
  const kind = KINDS.includes(o.kind as FieldKind) ? (o.kind as FieldKind) : 'text';
  return { id: str(o.id) || newId(), label: str(o.label), kind, value: str(o.value) };
}

export function parseItem(json: string): Item {
  const o = obj(JSON.parse(json));
  const type = TYPES.includes(o.type as ItemType) ? (o.type as ItemType) : 'login';
  const arr = (v: unknown) => (Array.isArray(v) ? v : []);
  return {
    type,
    title: str(o.title),
    fields: arr(o.fields).map(parseField),
    sections: arr(o.sections).map((s) => {
      const so = obj(s);
      return { id: str(so.id) || newId(), title: str(so.title), fields: arr(so.fields).map(parseField) };
    }),
    notes: str(o.notes),
    history: arr(o.history).map((h) => {
      const ho = obj(h);
      return { fieldId: str(ho.fieldId), label: str(ho.label), value: str(ho.value), changedAt: str(ho.changedAt) };
    }),
    seq: Number.isSafeInteger(o.seq) && (o.seq as number) > 0 ? (o.seq as number) : 0,
    ...(typeof o.trashedAt === 'string' && Math.abs(Date.parse(o.trashedAt)) < LATEST_DATE ? { trashedAt: o.trashedAt } : {}),
  };
}

export function allFields(item: Item): Field[] {
  return [...item.fields, ...item.sections.flatMap((s) => s.fields)];
}

export function fieldValue(item: Item, id: string): string {
  return allFields(item).find((f) => f.id === id)?.value ?? '';
}

function dedupeHistory(history: HistoryEntry[], current: Item): HistoryEntry[] {
  const live = new Set(allFields(current).map((f) => `${f.id}\0${f.value}`));
  const seen = new Set<string>();
  return history
    .filter((h) => {
      const key = `${h.fieldId}\0${h.value}`;
      if (!h.value || live.has(key) || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, HISTORY_LIMIT);
}

export function withHistory(previous: Item | undefined, next: Item, now = new Date()): Item {
  const changed: HistoryEntry[] = [];
  if (previous) {
    const nextById = new Map(allFields(next).map((f) => [f.id, f]));
    for (const old of allFields(previous)) {
      if (old.kind !== 'concealed' || !old.value) continue;
      if (nextById.get(old.id)?.value === old.value) continue;
      changed.push({ fieldId: old.id, label: old.label, value: old.value, changedAt: now.toISOString() });
    }
  }
  const seq = Math.max(previous?.seq ?? 0, next.seq ?? 0) + 1;
  return { ...next, history: dedupeHistory([...changed, ...next.history], next), seq };
}

export function resolveConflict(remote: Item, local: Item, now = new Date()): Item {
  return withHistory(remote, { ...local, history: [...local.history, ...remote.history] }, now);
}

const SEARCHABLE: FieldKind[] = ['text', 'url', 'email', 'phone'];

export function matchesSearch(item: Item, query: string): boolean {
  const q = query.trim().toLocaleLowerCase('de');
  if (!q) return true;
  const hay = [item.title, ...allFields(item).filter((f) => SEARCHABLE.includes(f.kind)).map((f) => f.value)];
  return hay.some((v) => v.toLocaleLowerCase('de').includes(q));
}

export function subtitle(item: Item): string {
  const first = item.fields.find((f) => (f.kind === 'text' || f.kind === 'email' || f.kind === 'url') && f.value);
  return first?.value ?? TEMPLATES[item.type].label;
}

export function normalizeUrl(input: string): string {
  const url = input.trim();
  if (!url) return '';
  return /^[a-z][a-z0-9+.-]*:/i.test(url) ? url : `https://${url}`;
}

export function safeHref(field: Field): string | null {
  const v = field.value.trim();
  if (!v) return null;
  if (field.kind === 'email') return /^[^\s@]+@[^\s@]+$/.test(v) ? `mailto:${v}` : null;
  if (field.kind === 'phone') return /^[+0-9 ()/-]{3,}$/.test(v) ? `tel:${v.replace(/[^+0-9]/g, '')}` : null;
  if (field.kind !== 'url') return null;
  try {
    const parsed = new URL(normalizeUrl(v));
    return parsed.protocol === 'https:' || parsed.protocol === 'http:' ? parsed.href : null;
  } catch {
    return null;
  }
}

export function cleanItem(item: Item): Item {
  const fix = (f: Field): Field => ({ ...f, label: f.label.trim(), value: f.kind === 'url' ? normalizeUrl(f.value) : f.value });
  return {
    ...item,
    title: item.title.trim(),
    fields: item.fields.map(fix),
    sections: item.sections
      .map((s) => ({ ...s, title: s.title.trim(), fields: s.fields.map(fix).filter((f) => f.label || f.value) }))
      .filter((s) => s.title || s.fields.length),
  };
}

export type CharClass = 'lower' | 'upper' | 'digit' | 'symbol';

export function charClass(c: string): CharClass {
  if (/[0-9]/.test(c)) return 'digit';
  if (/[A-Z]/.test(c)) return 'upper';
  if (/[a-z]/.test(c)) return 'lower';
  return 'symbol';
}
