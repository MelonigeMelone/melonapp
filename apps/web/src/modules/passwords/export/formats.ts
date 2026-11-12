import { allFields, parseItem, type Field, type Item, type VaultItem } from '../../../vault/item';

export interface ExportPayload {
  app: 'MelonApp';
  version: 1;
  exportedAt: string;
  items: { vault: string; item: Item }[];
}

export function melonPayload(items: VaultItem[], vaultName: (id: string) => string, now = new Date()): string {
  const payload: ExportPayload = {
    app: 'MelonApp',
    version: 1,
    exportedAt: now.toISOString(),
    items: items.map((v) => ({ vault: vaultName(v.vaultId), item: v.item })),
  };
  return JSON.stringify(payload);
}

export function parseMelonPayload(json: string): Item[] {
  const raw: unknown = JSON.parse(json);
  const o = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  if (o.app !== 'MelonApp' || o.version !== 1 || !Array.isArray(o.items)) throw new Error('invalid_export');
  return o.items.map((entry) => {
    const e = entry && typeof entry === 'object' ? (entry as Record<string, unknown>) : {};
    return { ...parseItem(JSON.stringify(e.item ?? {})), seq: 0 };
  });
}

const COLUMNS = ['folder', 'favorite', 'type', 'name', 'notes', 'fields', 'reprompt', 'login_uri', 'login_username', 'login_password', 'login_totp'];

const SECRET_COLUMNS = new Set([9, 10]);

function inert(value: string): string {
  return /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
}

function cell(value: string, column: number): string {
  const safe = SECRET_COLUMNS.has(column) ? value : inert(value);
  return /[",\r\n]|^\s|\s$/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

function lines(fields: Field[]): string {
  return fields.filter((f) => f.value).map((f) => `${f.label}: ${f.value}`).join('\n');
}

function row(v: VaultItem, folder: string): string[] {
  const { item } = v;
  const fields = allFields(item);
  if (item.type !== 'login') {
    return [folder, '', 'note', item.title, item.notes, lines(fields), '0', '', '', '', ''];
  }
  const byId = (id: string) => item.fields.find((f) => f.id === id);
  const urls = fields.filter((f) => f.kind === 'url' && f.value).map((f) => f.value);
  const totp = fields.find((f) => f.kind === 'totp' && f.value);
  const used = new Set([byId('username'), byId('password'), totp, ...fields.filter((f) => f.kind === 'url')]);
  return [
    folder,
    '',
    'login',
    item.title,
    item.notes,
    lines(fields.filter((f) => !used.has(f))),
    '0',
    urls.join(','),
    byId('username')?.value ?? '',
    byId('password')?.value ?? '',
    totp?.value ?? '',
  ];
}

export function bitwardenCsv(items: VaultItem[], vaultName: (id: string) => string): string {
  const rows = [COLUMNS, ...items.map((v) => row(v, vaultName(v.vaultId)))];
  return `${rows.map((r) => r.map((value, column) => cell(value, column)).join(',')).join('\r\n')}\r\n`;
}

export function fileName(kind: 'melon' | 'csv', now = new Date()): string {
  const day = now.toISOString().slice(0, 10);
  return kind === 'melon' ? `melonapp-export-${day}.melon.json` : `melonapp-export-${day}-UNVERSCHLUESSELT.csv`;
}

export function download(name: string, content: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
