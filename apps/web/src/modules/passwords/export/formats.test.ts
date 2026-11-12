import { describe, expect, it } from 'vitest';
import { emptyItem, fieldValue, newId, type Item, type VaultItem } from '../../../vault/item';
import { parseCsvExport } from '../import/formats';
import { bitwardenCsv, fileName, melonPayload, parseMelonPayload } from './formats';

function login(): Item {
  const item = emptyItem('login');
  item.title = 'Bank, "privat"';
  item.notes = 'Zeile 1\nZeile 2';
  item.fields = item.fields.map((f) =>
    f.id === 'username' ? { ...f, value: 'mia@example.test' } : f.id === 'password' ? { ...f, value: '=p,a"ss\nword' } : f.id === 'website' ? { ...f, value: 'https://bank.example' } : f,
  );
  item.sections = [
    {
      id: newId(),
      title: 'Mehr',
      fields: [
        { id: newId(), label: 'Website', kind: 'url', value: 'https://app.bank.example' },
        { id: newId(), label: 'Einmalcode', kind: 'totp', value: 'JBSWY3DPEHPK3PXP' },
        { id: newId(), label: 'PIN', kind: 'concealed', value: '1234' },
      ],
    },
  ];
  item.history = [{ fieldId: 'password', label: 'Passwort', value: 'alt', changedAt: '2026-01-01T00:00:00.000Z' }];
  item.seq = 4;
  return item;
}

function card(): Item {
  const item = emptyItem('card');
  item.title = 'Visa';
  item.fields = item.fields.map((f) => (f.id === 'number' ? { ...f, value: '4111 1111 1111 1111' } : f));
  return item;
}

const vault = (item: Item, vaultId = 'v1'): VaultItem => ({ vaultId, id: newId(), revision: 1, item });
const names = (id: string) => (id === 'v1' ? 'Persönlich' : 'Familie');

describe('MelonApp export payload', () => {
  it('keeps every item completely, including history and sections', () => {
    const items = [vault(login()), vault(card(), 'v2')];
    const json = melonPayload(items, names, new Date('2026-11-12T10:00:00Z'));
    expect(JSON.parse(json)).toMatchObject({ app: 'MelonApp', version: 1, exportedAt: '2026-11-12T10:00:00.000Z' });
    expect(JSON.parse(json).items.map((i: { vault: string }) => i.vault)).toEqual(['Persönlich', 'Familie']);
    expect(parseMelonPayload(json)).toEqual(items.map((i) => i.item));
  });

  it('rejects files that are not a MelonApp export', () => {
    expect(() => parseMelonPayload('{"app":"Other","version":1,"items":[]}')).toThrow('invalid_export');
    expect(() => parseMelonPayload('{"app":"MelonApp","version":2,"items":[]}')).toThrow('invalid_export');
  });
});

describe('CSV export', () => {
  it('is read back by the Bitwarden import with all login data', () => {
    const csv = bitwardenCsv([vault(login()), vault(card())], names);
    const parsed = parseCsvExport(csv);
    expect(parsed.source).toBe('bitwarden');
    const [back, note] = parsed.items;
    expect(back?.title).toBe('Bank, "privat"');
    expect(fieldValue(back!, 'username')).toBe('mia@example.test');
    expect(fieldValue(back!, 'password')).toBe('=p,a"ss\nword');
    expect(fieldValue(back!, 'website')).toBe('https://bank.example');
    expect(back?.notes).toContain('Zeile 1\nZeile 2');
    expect(note?.title).toBe('Visa');
  });

  it('writes logins with all websites and the 2FA key, and other types as notes with their fields', () => {
    const csv = bitwardenCsv([vault(login()), vault(card())], names);
    const [header, first, second] = csv.split('\r\n');
    expect(header).toBe('folder,favorite,type,name,notes,fields,reprompt,login_uri,login_username,login_password,login_totp');
    expect(csv).toContain('"https://bank.example,https://app.bank.example"');
    expect(csv).toContain('JBSWY3DPEHPK3PXP');
    expect(csv).toContain('PIN: 1234');
    expect(first).toMatch(/^Persönlich,,login,/);
    expect(csv).toMatch(/Persönlich,,note,Visa,,Kartennummer: 4111 1111 1111 1111,0,,,,/);
    expect(second).toBeDefined();
  });

  it('marks unencrypted files in their name', () => {
    expect(fileName('csv', new Date('2026-11-12T10:00:00Z'))).toBe('melonapp-export-2026-11-12-UNVERSCHLUESSELT.csv');
    expect(fileName('melon', new Date('2026-11-12T10:00:00Z'))).toBe('melonapp-export-2026-11-12.melon.json');
  });
});
