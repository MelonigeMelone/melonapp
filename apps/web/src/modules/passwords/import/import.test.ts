import { strToU8, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { fieldValue, type Item } from '../../../vault/item';
import { parseCsv } from './csv';
import { dedupeKey, ImportError, parse1pux, parseCsvExport } from './formats';

const section = (item: Item, title: string) => item.sections.find((s) => s.title === title);

describe('csv parser', () => {
  it('handles quotes, escaped quotes, commas and newlines in fields', () => {
    const rows = parseCsv('a,b,c\r\n"x, y","He said ""hi""","line1\nline2"\r\n');
    expect(rows).toEqual([
      ['a', 'b', 'c'],
      ['x, y', 'He said "hi"', 'line1\nline2'],
    ]);
  });

  it('strips a byte order mark, skips blank lines and keeps empty fields', () => {
    expect(parseCsv('﻿a,b\n\n1,\n')).toEqual([
      ['a', 'b'],
      ['1', ''],
    ]);
  });

  it('accepts a last line without newline', () => {
    expect(parseCsv('a\n1')).toEqual([['a'], ['1']]);
  });
});

describe('csv formats', () => {
  it('reads Apple Passwords exports including 2FA secrets', () => {
    const r = parseCsvExport(
      'Title,URL,Username,Password,Notes,OTPAuth\n' +
        'GitHub,https://github.com/,melone,"p,w""1",Notiz,otpauth://totp/GitHub?secret=ABC\n' +
        ',https://www.example.org/login,mia,pw2,,\n',
    );
    expect(r.source).toBe('apple');
    expect(r.items).toHaveLength(2);
    const [gh, ex] = r.items as [Item, Item];
    expect(gh.title).toBe('GitHub');
    expect(fieldValue(gh, 'password')).toBe('p,w"1');
    expect(gh.notes).toBe('Notiz');
    expect(section(gh, 'Einmalcode')?.fields[0]).toMatchObject({ kind: 'totp', value: 'otpauth://totp/GitHub?secret=ABC' });
    expect(ex.title).toBe('example.org');
  });

  it('reads Chrome and Firefox exports', () => {
    const chrome = parseCsvExport('name,url,username,password,note\nBank,https://bank.de,k1,pw,hallo\n');
    expect(chrome.source).toBe('chrome');
    expect(chrome.items[0]).toMatchObject({ title: 'Bank', notes: 'hallo' });

    const firefox = parseCsvExport(
      '"url","username","password","httpRealm","formActionOrigin","guid","timeCreated","timeLastUsed","timePasswordChanged"\n' +
        '"https://shop.example.com","mia","geheim",,"https://shop.example.com","{1}","1","1","1"\n' +
        '"chrome://FirefoxAccounts","x","y",,,"{2}","1","1","1"\n',
    );
    expect(firefox.source).toBe('firefox');
    expect(firefox.items.map((i) => i.title)).toEqual(['shop.example.com']);
  });

  it('reads 1Password CSV and skips archived entries', () => {
    const r = parseCsvExport('Title,Url,Username,Password,OTPAuth,Favorite,Archived,Tags,Notes\nA,a.de,u,p,,false,false,,\nB,b.de,u,p,,false,true,,\n');
    expect(r.source).toBe('onepassword-csv');
    expect(r.items.map((i) => i.title)).toEqual(['A']);
    expect(r.skippedArchived).toBe(1);
  });

  it('reads Bitwarden logins, notes and custom fields', () => {
    const r = parseCsvExport(
      'folder,favorite,type,name,notes,fields,reprompt,login_uri,login_username,login_password,login_totp\n' +
        ',,login,Mail,,"PIN: 1234\nFrage: Hund",0,"https://mail.de,https://webmail.de",mia,pw,JBSWY3DP\n' +
        ',,note,WLAN Oma,Passwort ist melone123,,0,,,,\n',
    );
    expect(r.source).toBe('bitwarden');
    const [mail, wlan] = r.items as [Item, Item];
    expect(section(mail, 'Weitere Felder')?.fields.map((f) => [f.label, f.value])).toEqual([
      ['PIN', '1234'],
      ['Frage', 'Hund'],
    ]);
    expect(section(mail, 'Weitere Websites')?.fields[0]?.value).toBe('https://webmail.de');
    expect(section(mail, 'Einmalcode')?.fields[0]?.value).toBe('JBSWY3DP');
    expect(wlan).toMatchObject({ type: 'note', title: 'WLAN Oma', notes: 'Passwort ist melone123' });
  });

  it('rejects unknown files', () => {
    expect(() => parseCsvExport('foo,bar\n1,2\n')).toThrow(ImportError);
  });

  it('finds duplicates regardless of case and www', () => {
    const r = parseCsvExport('name,url,username,password\nGitHub,https://www.github.com,Melone,a\ngithub,https://github.com/login,melone,b\n');
    expect(dedupeKey(r.items[0]!)).toBe(dedupeKey(r.items[1]!));
  });
});

describe('1password 1pux', () => {
  const pux = (items: unknown[]) =>
    zipSync({
      'export.attributes': strToU8('{"version":3}'),
      'export.data': strToU8(JSON.stringify({ accounts: [{ vaults: [{ attrs: { name: 'Private' }, items }] }] })),
    });

  it('converts logins, cards, identities, notes and custom sections', () => {
    const r = parse1pux(
      pux([
        {
          categoryUuid: '001',
          state: 'active',
          overview: { title: 'GitHub', url: 'https://github.com', urls: [{ url: 'https://github.com' }, { url: 'https://gist.github.com' }] },
          details: {
            loginFields: [
              { designation: 'username', value: 'melone' },
              { designation: 'password', value: 'neu' },
            ],
            notesPlain: 'Notiz',
            sections: [{ title: 'Sicherheit', fields: [{ title: 'Recovery', id: 'r', value: { concealed: 'R-1' } }, { title: 'one-time password', id: 'o', value: { totp: 'otpauth://x' } }] }],
            passwordHistory: [{ value: 'alt', time: 1700000000 }],
          },
        },
        {
          categoryUuid: '002',
          state: 'active',
          overview: { title: 'Visa' },
          details: {
            sections: [
              {
                title: '',
                fields: [
                  { id: 'cardholder', title: 'cardholder name', value: { string: 'Mia Melone' } },
                  { id: 'ccnum', title: 'number', value: { creditCardNumber: '4111111111111111' } },
                  { id: 'cvv', title: 'verification number', value: { concealed: '123' } },
                  { id: 'expiry', title: 'expiry date', value: { monthYear: 202812 } },
                  { id: 'bank', title: 'Bank', value: { string: 'Sparkasse' } },
                ],
              },
            ],
          },
        },
        {
          categoryUuid: '004',
          state: 'active',
          overview: { title: 'Ich' },
          details: {
            sections: [
              {
                title: 'Identification',
                fields: [
                  { id: 'firstname', value: { string: 'Mia' } },
                  { id: 'lastname', value: { string: 'Melone' } },
                  { id: 'birthdate', value: { date: 946684800 } },
                  { id: 'email', value: { email: { email_address: 'mia@example.com' } } },
                  { id: 'address', value: { address: { street: 'Hauptstr. 1', zip: '10115', city: 'Berlin', country: 'de' } } },
                ],
              },
            ],
          },
        },
        { categoryUuid: '003', state: 'active', overview: { title: 'Tresorcode' }, details: { notesPlain: '1-2-3' } },
        { categoryUuid: '001', state: 'archived', overview: { title: 'Alt' }, details: {} },
      ]),
    );
    expect(r.skippedArchived).toBe(1);
    const [gh, card, me, memo] = r.items as [Item, Item, Item, Item];

    expect(fieldValue(gh, 'username')).toBe('melone');
    expect(fieldValue(gh, 'password')).toBe('neu');
    expect(section(gh, 'Weitere Websites')?.fields[0]?.value).toBe('https://gist.github.com');
    expect(section(gh, 'Sicherheit')?.fields.map((f) => [f.label, f.kind, f.value])).toEqual([
      ['Recovery', 'concealed', 'R-1'],
      ['Einmalcode', 'totp', 'otpauth://x'],
    ]);
    expect(gh.history).toEqual([{ fieldId: 'password', label: 'Passwort', value: 'alt', changedAt: '2023-11-14T22:13:20.000Z' }]);

    expect(card.type).toBe('card');
    expect(fieldValue(card, 'cardholder')).toBe('Mia Melone');
    expect(fieldValue(card, 'number')).toBe('4111111111111111');
    expect(fieldValue(card, 'cvc')).toBe('123');
    expect(fieldValue(card, 'expiry')).toBe('12/2028');
    expect(card.sections[0]?.fields.map((f) => f.label)).toEqual(['Bank']);

    expect(me.type).toBe('identity');
    expect(fieldValue(me, 'name')).toBe('Mia Melone');
    expect(fieldValue(me, 'birthday')).toBe('2000-01-01');
    expect(fieldValue(me, 'email')).toBe('mia@example.com');
    expect(fieldValue(me, 'address')).toBe('Hauptstr. 1\n10115 Berlin\nde');

    expect(memo).toMatchObject({ type: 'note', title: 'Tresorcode', notes: '1-2-3' });
  });

  it('rejects files that are not 1PUX', () => {
    expect(() => parse1pux(strToU8('not a zip'))).toThrow(ImportError);
    expect(() => parse1pux(zipSync({ 'other.txt': strToU8('x') }))).toThrow(ImportError);
  });
});
