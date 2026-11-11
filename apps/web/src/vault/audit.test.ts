import { describe, expect, it } from 'vitest';
import { audit, breachCount, countInRange, findBreached } from './audit';
import { emptyItem, type VaultItem } from './item';
import { baseWord, estimateStrength } from './strength';

function login(id: string, password: string): VaultItem {
  const item = emptyItem('login');
  item.title = id;
  item.fields = item.fields.map((f) => (f.id === 'password' ? { ...f, value: password } : f));
  return { vaultId: 'v', id, revision: 1, item };
}

describe('strength', () => {
  it('rates common passwords and their variants as weak', () => {
    for (const pw of ['passwort', 'Passwort123!', 'hallo123', 'qwertz', 'Schalke04', 'iloveyou2026']) {
      expect(estimateStrength(pw).level, pw).toBe('weak');
    }
    expect(baseWord('Passwort123!')).toBe('passwort');
  });

  it('penalises short, repeated and sequential passwords', () => {
    expect(estimateStrength('Ab1!').level).toBe('weak');
    expect(estimateStrength('aaaaaaaaaaaaaaaa').level).toBe('weak');
    expect(estimateStrength('abcdefghijklmnop').level).not.toBe('strong');
    expect(estimateStrength('Ab1!').hint).toContain('Zu kurz');
    expect(estimateStrength('buecher!').level).toBe('weak');
  });

  it('rates generated and passphrase-style passwords as strong', () => {
    expect(estimateStrength('jX;*;F:sMjYs-*-eCK74').level).toBe('strong');
    expect(estimateStrength('korrekt pferd batterie heftklammer').level).toBe('strong');
  });
});

describe('audit', () => {
  it('finds weak and reused passwords', () => {
    const report = audit([login('a', 'hallo123'), login('b', 'gleich-und-lang-2026!'), login('c', 'gleich-und-lang-2026!'), login('d', ''), login('e', 'jX;*;F:sMjYs-*-eCK74')]);
    expect(report.checked).toBe(4);
    expect(report.weak.map((v) => v.id)).toEqual(['a']);
    expect(report.reused.map((g) => g.map((v) => v.id))).toEqual([['b', 'c']]);
  });
});

describe('breach check (k-anonymity)', () => {
  it('sends only the first five hash characters and compares the rest locally', async () => {
    const requested: string[] = [];
    const fake = (async (url: string) => {
      requested.push(url);
      return new Response('1E4C9B93F3F0682250B6CF8331B7EE68FD8:3861493\r\nFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF:0\r\n');
    }) as typeof fetch;
    expect(await breachCount('password', fake)).toBe(3861493);
    expect(requested).toEqual(['https://api.pwnedpasswords.com/range/5BAA6']);
    expect(new URL(requested[0] ?? '').pathname).toBe('/range/5BAA6');
  });

  it('ignores padding entries and checks each password once', async () => {
    let calls = 0;
    const fake = (async () => {
      calls++;
      return new Response('0000000000000000000000000000000000:0\n');
    }) as typeof fetch;
    const hits = await findBreached([login('a', 'x-1'), login('b', 'x-1'), login('c', 'y-2')], undefined, fake);
    expect(hits).toEqual([]);
    expect(calls).toBe(2);
    expect(countInRange('ABC:0\nDEF:5', 'DEF')).toBe(5);
  });
});
