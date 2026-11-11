import { unzipSync, strFromU8 } from 'fflate';
import { emptyItem, newId, normalizeUrl, type Field, type FieldKind, type Item, type ItemType, type Section } from '../../../vault/item';
import { parseCsv, toRecords } from './csv';

export type SourceId = 'apple' | 'onepassword-csv' | 'onepassword-1pux' | 'chrome' | 'firefox' | 'bitwarden';

export const SOURCE_LABELS: Record<SourceId, string> = {
  apple: 'Apple Passwörter',
  'onepassword-csv': '1Password (CSV)',
  'onepassword-1pux': '1Password (1PUX)',
  chrome: 'Chrome, Edge oder Brave',
  firefox: 'Firefox',
  bitwarden: 'Bitwarden',
};

export interface ImportResult {
  source: SourceId;
  items: Item[];
  skippedArchived: number;
}

export class ImportError extends Error {}

function hostOf(url: string): string {
  try {
    return new URL(normalizeUrl(url)).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

function field(label: string, kind: FieldKind, value: string): Field {
  return { id: newId(), label, kind, value };
}

interface LoginParts {
  title?: string;
  username?: string;
  password?: string;
  urls?: string[];
  notes?: string;
  otp?: string;
  extra?: Section[];
}

function login(p: LoginParts): Item {
  const item = emptyItem('login');
  const urls = (p.urls ?? []).map((u) => u.trim()).filter(Boolean);
  const set = (id: string, value: string | undefined) =>
    (item.fields = item.fields.map((f) => (f.id === id ? { ...f, value: value ?? '' } : f)));
  set('username', p.username);
  set('password', p.password);
  set('website', urls[0] ? normalizeUrl(urls[0]) : '');
  item.title = p.title?.trim() || hostOf(urls[0] ?? '') || p.username?.trim() || 'Ohne Titel';
  item.notes = p.notes ?? '';
  const sections: Section[] = [];
  const more = urls.slice(1).map((u) => field('Website', 'url', normalizeUrl(u)));
  if (more.length) sections.push({ id: newId(), title: 'Weitere Websites', fields: more });
  if (p.otp) sections.push({ id: newId(), title: 'Einmalcode', fields: [field('TOTP-Schlüssel', 'concealed', p.otp)] });
  item.sections = [...sections, ...(p.extra ?? [])];
  return item;
}

function note(title: string, notes: string, extra: Section[] = []): Item {
  return { ...emptyItem('note'), title: title.trim() || 'Ohne Titel', notes, sections: extra };
}

function bitwardenFields(raw: string): Section[] {
  const fields = raw
    .split(/\r?\n/)
    .map((line) => line.match(/^([^:]+):\s?(.*)$/))
    .filter((m): m is RegExpMatchArray => !!m)
    .map((m) => field((m[1] ?? '').trim(), 'text', m[2] ?? ''));
  return fields.length ? [{ id: newId(), title: 'Weitere Felder', fields }] : [];
}

function detectCsv(headers: string[]): SourceId | null {
  const has = (...h: string[]) => h.every((x) => headers.includes(x));
  if (has('login_uri', 'login_username', 'login_password')) return 'bitwarden';
  if (has('url', 'username', 'password', 'httprealm')) return 'firefox';
  if (has('title', 'url', 'username', 'password') && has('archived')) return 'onepassword-csv';
  if (has('title', 'url', 'username', 'password')) return 'apple';
  if (has('name', 'url', 'username', 'password')) return 'chrome';
  return null;
}

export function parseCsvExport(text: string): ImportResult {
  const { headers, records } = toRecords(parseCsv(text));
  const source = detectCsv(headers);
  if (!source) throw new ImportError('unknown_format');
  let skippedArchived = 0;
  const items: Item[] = [];
  for (const r of records) {
    const get = (k: string) => r[k] ?? '';
    switch (source) {
      case 'apple':
        items.push(login({ title: get('title'), urls: [get('url')], username: get('username'), password: get('password'), notes: get('notes'), otp: get('otpauth') }));
        break;
      case 'onepassword-csv':
        if (/^(true|1|yes)$/i.test(get('archived'))) {
          skippedArchived++;
          break;
        }
        items.push(login({ title: get('title'), urls: get('url').split(/[\n,]/), username: get('username'), password: get('password'), notes: get('notes'), otp: get('otpauth') }));
        break;
      case 'chrome':
        items.push(login({ title: get('name'), urls: [get('url')], username: get('username'), password: get('password'), notes: get('note') }));
        break;
      case 'firefox':
        if (get('url').startsWith('chrome://')) break;
        items.push(login({ urls: [get('url')], username: get('username'), password: get('password') }));
        break;
      case 'bitwarden': {
        const extra = bitwardenFields(get('fields'));
        if (get('type') === 'note') items.push(note(get('name'), get('notes'), extra));
        else if (get('type') === 'login' || !get('type'))
          items.push(login({ title: get('name'), urls: get('login_uri').split(','), username: get('login_username'), password: get('login_password'), notes: get('notes'), otp: get('login_totp'), extra }));
        break;
      }
    }
  }
  return { source, items: items.filter((i) => i.title || i.fields.some((f) => f.value)), skippedArchived };
}

type Json = Record<string, unknown>;
const obj = (v: unknown): Json => (v && typeof v === 'object' ? (v as Json) : {});
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const str = (v: unknown): string => (typeof v === 'string' ? v : typeof v === 'number' ? String(v) : '');

const CATEGORY: Record<string, ItemType> = { '001': 'login', '005': 'login', '002': 'card', '003': 'note', '004': 'identity', '109': 'wifi' };

const TEMPLATE_IDS: Partial<Record<ItemType, Record<string, string>>> = {
  card: { cardholder: 'cardholder', ccnum: 'number', cvv: 'cvc', expiry: 'expiry', pin: 'pin' },
  identity: { birthdate: 'birthday', address: 'address', defphone: 'phone', cellphone: 'phone', email: 'email' },
  wifi: { network_name: 'ssid', wireless_password: 'password', wireless_security: 'security' },
};

function isoDate(seconds: number): string {
  return new Date(seconds * 1000).toISOString().slice(0, 10);
}

function convertValue(raw: unknown): { kind: FieldKind; value: string } | null {
  const v = obj(raw);
  const [key, inner] = Object.entries(v)[0] ?? [];
  if (key === undefined) return null;
  switch (key) {
    case 'concealed':
    case 'totp':
    case 'creditCardNumber':
      return { kind: 'concealed', value: str(inner) };
    case 'url':
      return { kind: 'url', value: str(inner) };
    case 'email':
      return { kind: 'email', value: typeof inner === 'string' ? inner : str(obj(inner).email_address) };
    case 'phone':
      return { kind: 'phone', value: str(inner) };
    case 'date':
      return typeof inner === 'number' ? { kind: 'date', value: isoDate(inner) } : { kind: 'text', value: str(inner) };
    case 'monthYear': {
      const n = str(inner);
      return { kind: 'text', value: n.length === 6 ? `${n.slice(4)}/${n.slice(0, 4)}` : n };
    }
    case 'address': {
      const a = obj(inner);
      const lines = [str(a.street), [str(a.zip), str(a.city)].filter(Boolean).join(' '), str(a.state), str(a.country)].filter(Boolean);
      return { kind: 'multiline', value: lines.join('\n') };
    }
    default:
      return { kind: 'text', value: str(inner) };
  }
}

function convert1puxItem(raw: unknown): Item | null {
  const it = obj(raw);
  const overview = obj(it.overview);
  const details = obj(it.details);
  const type = CATEGORY[str(it.categoryUuid)] ?? 'note';
  const title = str(overview.title);
  const notes = str(details.notesPlain);
  const urls = [str(overview.url), ...arr(overview.urls).map((u) => str(obj(u).url))].filter(Boolean);
  const unique = [...new Set(urls)];

  const loginFields = arr(details.loginFields).map(obj);
  const byDesignation = (d: string) => str(loginFields.find((f) => str(f.designation) === d)?.value);
  const mapping = TEMPLATE_IDS[type] ?? {};

  let item: Item = type === 'login' ? login({ title, urls: unique, username: byDesignation('username'), password: byDesignation('password') || str(details.password), notes }) : { ...emptyItem(type), title: title || 'Ohne Titel', notes };

  const nameParts: string[] = [];
  const sections: Section[] = [];
  for (const rawSection of arr(details.sections)) {
    const s = obj(rawSection);
    const fields: Field[] = [];
    for (const rawField of arr(s.fields)) {
      const f = obj(rawField);
      const id = str(f.id);
      const converted = convertValue(f.value);
      if (!converted || !converted.value) continue;
      if (type === 'identity' && ['firstname', 'initial', 'lastname'].includes(id)) {
        nameParts.push(converted.value);
        continue;
      }
      const target = mapping[id];
      if (target && item.fields.some((x) => x.id === target && !x.value)) {
        item = { ...item, fields: item.fields.map((x) => (x.id === target ? { ...x, value: converted.value } : x)) };
        continue;
      }
      if (str(f.title).toLowerCase() === 'one-time password' || Object.keys(obj(f.value))[0] === 'totp') {
        fields.push(field('TOTP-Schlüssel', 'concealed', converted.value));
        continue;
      }
      fields.push(field(str(f.title) || 'Feld', converted.kind, converted.value));
    }
    if (fields.length) sections.push({ id: newId(), title: str(s.title), fields });
  }
  if (nameParts.length) item = { ...item, fields: item.fields.map((x) => (x.id === 'name' ? { ...x, value: nameParts.join(' ') } : x)) };

  const history = arr(details.passwordHistory)
    .map(obj)
    .map((h) => ({ fieldId: 'password', label: 'Passwort', value: str(h.value), changedAt: typeof h.time === 'number' ? new Date(h.time * 1000).toISOString() : '' }))
    .filter((h) => h.value);

  return { ...item, sections: [...item.sections, ...sections], history };
}

export function parse1pux(bytes: Uint8Array): ImportResult {
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(bytes);
  } catch {
    throw new ImportError('unreadable_1pux');
  }
  const data = files['export.data'];
  if (!data) throw new ImportError('unreadable_1pux');
  const parsed = obj(JSON.parse(strFromU8(data)));
  let skippedArchived = 0;
  const items: Item[] = [];
  for (const account of arr(parsed.accounts)) {
    for (const vault of arr(obj(account).vaults)) {
      for (const rawItem of arr(obj(vault).items)) {
        if (str(obj(rawItem).state) === 'archived') {
          skippedArchived++;
          continue;
        }
        const item = convert1puxItem(rawItem);
        if (item) items.push(item);
      }
    }
  }
  return { source: 'onepassword-1pux', items, skippedArchived };
}

export async function readExport(file: File): Promise<ImportResult> {
  if (file.name.toLowerCase().endsWith('.1pux')) return parse1pux(new Uint8Array(await file.arrayBuffer()));
  return parseCsvExport(await file.text());
}

export function dedupeKey(item: Item): string {
  const value = (id: string) => item.fields.find((f) => f.id === id)?.value.trim().toLowerCase() ?? '';
  return [item.type, item.title.trim().toLowerCase(), value('username'), hostOf(value('website'))].join('\u0000');
}
