import { describe, expect, it } from 'vitest';
import {
  CREATABLE_TYPES,
  passkeyItem,
  passkeyOf,
  visibleFields,
  charClass,
  cleanItem,
  emptyItem,
  fieldValue,
  isTotpField,
  matchesSearch,
  newId,
  parseItem,
  resolveConflict,
  safeHref,
  withHistory,
  type Item,
} from './item';

const now = new Date('2026-11-11T12:00:00Z');

function login(password: string, extra: Partial<Item> = {}): Item {
  const item = emptyItem('login');
  item.title = 'GitHub';
  item.fields = item.fields.map((f) => (f.id === 'password' ? { ...f, value: password } : f));
  return { ...item, ...extra };
}

describe('item model', () => {
  it('builds items from type templates', () => {
    expect(emptyItem('card').fields.map((f) => f.id)).toEqual(['cardholder', 'number', 'expiry', 'cvc', 'pin']);
    expect(emptyItem('note').fields).toEqual([]);
  });

  it('records changed hidden fields, including custom ones', () => {
    const before = login('old', {
      sections: [{ id: 's', title: 'Extra', fields: [{ id: 'pin', label: 'PIN', kind: 'concealed', value: '1234' }] }],
    });
    const after = login('new', {
      sections: [{ id: 's', title: 'Extra', fields: [{ id: 'pin', label: 'PIN', kind: 'concealed', value: '9999' }] }],
    });
    const result = withHistory(before, after, now);
    expect(result.history.map((h) => [h.fieldId, h.value])).toEqual([
      ['password', 'old'],
      ['pin', '1234'],
    ]);
    expect(withHistory(result, result, now).history).toHaveLength(2);
  });

  it('does not record visible fields or keep the current value in history', () => {
    const before = login('same');
    const after = { ...login('same'), title: 'Renamed' };
    expect(withHistory(before, after, now).history).toEqual([]);
    const back = withHistory(login('b', { history: [{ fieldId: 'password', label: 'Passwort', value: 'a', changedAt: '' }] }), login('a'), now);
    expect(back.history.map((h) => h.value)).toEqual(['b']);
  });

  it('keeps the losing side of a conflict', () => {
    const merged = resolveConflict(login('remote'), login('local', { notes: 'mine' }), now);
    expect(fieldValue(merged, 'password')).toBe('local');
    expect(merged.notes).toBe('mine');
    expect(merged.history[0]?.value).toBe('remote');
  });

  it('parses unknown and broken data defensively', () => {
    const item = parseItem('{"type":"spaceship","title":"A","fields":[{"label":"X","kind":"laser","value":"1"},null],"sections":"no"}');
    expect(item.type).toBe('login');
    expect(item.fields[0]).toMatchObject({ label: 'X', kind: 'text', value: '1' });
    expect(item.fields[1]?.kind).toBe('text');
    expect(item.sections).toEqual([]);
  });

  it('searches visible fields but never hidden ones', () => {
    const item = login('geheim123', {
      sections: [{ id: 's', title: '', fields: [{ id: 'x', label: 'Kundennummer', kind: 'text', value: 'K-4711' }] }],
    });
    item.fields[0] = { ...item.fields[0]!, value: 'melone' };
    expect(matchesSearch(item, 'git')).toBe(true);
    expect(matchesSearch(item, 'melo')).toBe(true);
    expect(matchesSearch(item, '4711')).toBe(true);
    expect(matchesSearch(item, 'geheim')).toBe(false);
  });

  it('only creates safe links', () => {
    const f = (kind: 'url' | 'email' | 'phone' | 'text', value: string) => ({ id: 'f', label: '', kind, value });
    expect(safeHref(f('url', 'github.com'))).toBe('https://github.com/');
    expect(safeHref(f('url', 'javascript:alert(1)'))).toBeNull();
    expect(safeHref(f('url', 'data:text/html,x'))).toBeNull();
    expect(safeHref(f('email', 'a@b.de'))).toBe('mailto:a@b.de');
    expect(safeHref(f('email', 'a@b.de?x=javascript:'))).toBe('mailto:a@b.de?x=javascript:');
    expect(safeHref(f('phone', '+49 (30) 123-45'))).toBe('tel:+493012345');
    expect(safeHref(f('phone', 'javascript:1'))).toBeNull();
    expect(safeHref(f('text', 'https://x.de'))).toBeNull();
  });

  it('cleans empty custom sections and normalizes urls', () => {
    const item = login('x', {
      sections: [
        { id: 'a', title: ' ', fields: [{ id: 'f', label: '', kind: 'text', value: '' }] },
        { id: 'b', title: 'Konto', fields: [{ id: 'u', label: 'Portal', kind: 'url', value: 'bank.de' }] },
      ],
    });
    const clean = cleanItem(item);
    expect(clean.sections).toHaveLength(1);
    expect(clean.sections[0]?.fields[0]?.value).toBe('https://bank.de');
  });

  it('creates random version 4 uuids', () => {
    const ids = new Set(Array.from({ length: 50 }, newId));
    expect(ids.size).toBe(50);
    for (const id of ids) expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it('recognises one-time code fields, including ones imported before the totp kind existed', () => {
    const f = (label: string, kind: 'concealed' | 'totp' | 'text', value: string) => ({ id: 'x', label, kind, value });
    expect(isTotpField(f('Einmalcode', 'totp', 'JBSWY3DPEHPK3PXP'))).toBe(true);
    expect(isTotpField(f('TOTP-Schlüssel', 'concealed', 'JBSWY3DPEHPK3PXP'))).toBe(true);
    expect(isTotpField(f('Irgendwas', 'concealed', 'otpauth://totp/x?secret=JBSWY3DPEHPK3PXP'))).toBe(true);
    expect(isTotpField(f('PIN', 'concealed', '1234'))).toBe(false);
    expect(isTotpField(f('Notiz', 'text', 'otpauth://totp/x'))).toBe(false);
  });

  it('classifies characters for the password display', () => {
    expect([...'aZ7%'].map(charClass)).toEqual(['lower', 'upper', 'digit', 'symbol']);
  });
});

describe('passkey items', () => {
  const data = { rp: 'webauthn.io', userName: 'mia', credentialId: 'Y3JlZA', userHandle: 'aGFuZGxl', privateKey: 'a2V5' };

  it('round-trips through storage and keeps the type', () => {
    const item = passkeyItem(data);
    const back = parseItem(JSON.stringify(item));
    expect(back.type).toBe('passkey');
    expect(passkeyOf(back)).toEqual(data);
    expect(back.title).toBe('webauthn.io (mia)');
  });

  it('hides the private key from visible fields and search', () => {
    const item = passkeyItem(data);
    expect(visibleFields(item).map((f) => f.id)).not.toContain('privateKey');
    expect(matchesSearch(item, 'a2V5')).toBe(false);
    expect(matchesSearch(item, 'webauthn')).toBe(true);
  });

  it('rejects incomplete or malformed passkey data', () => {
    expect(passkeyOf(emptyItem('login'))).toBeNull();
    expect(passkeyOf(passkeyItem({ ...data, rp: '' }))).toBeNull();
    expect(passkeyOf(passkeyItem({ ...data, privateKey: 'not base64url!' }))).toBeNull();
    expect(passkeyOf(passkeyItem({ ...data, credentialId: '' }))).toBeNull();
  });

  it('cannot be created by hand', () => {
    expect(CREATABLE_TYPES).not.toContain('passkey');
  });
});
