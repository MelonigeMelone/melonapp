import { describe, expect, it } from 'vitest';
import { emptyItem, parseItem, type VaultItem } from './item';
import { expired, fromTrash, isTrashed, purgeDate, toTrash, TRASH_DAYS } from './trash';

const at = new Date('2026-11-12T10:00:00Z');

describe('trash', () => {
  it('marks, restores and survives the round trip through encryption', () => {
    const item = { ...emptyItem('login'), title: 'Bank' };
    const trashed = toTrash(item, at);
    expect(isTrashed(trashed)).toBe(true);
    expect(parseItem(JSON.stringify(trashed)).trashedAt).toBe('2026-11-12T10:00:00.000Z');
    const back = fromTrash(trashed);
    expect(isTrashed(back)).toBe(false);
    expect('trashedAt' in back).toBe(false);
    expect(back).toEqual(item);
  });

  it(`deletes for good after ${TRASH_DAYS} days`, () => {
    const entry = (vaultId: string, trashedAt?: string): VaultItem => ({
      vaultId,
      id: vaultId,
      revision: 1,
      item: { ...emptyItem('note'), ...(trashedAt ? { trashedAt } : {}) },
    });
    expect(purgeDate(toTrash(emptyItem('note'), at))?.toISOString()).toBe('2026-12-12T10:00:00.000Z');
    const items = [entry('old', '2026-10-01T00:00:00Z'), entry('fresh', '2026-11-10T00:00:00Z'), entry('live')];
    expect(expired(items, at).map((v) => v.id)).toEqual(['old']);
  });

  it('ignores invalid trash marks from other clients', () => {
    expect(parseItem('{"title":"x","trashedAt":"gestern"}').trashedAt).toBeUndefined();
    expect(parseItem('{"title":"x","trashedAt":5}').trashedAt).toBeUndefined();
    expect(parseItem('{"title":"x","trashedAt":"+275760-09-13T00:00:00Z"}').trashedAt).toBeUndefined();
  });
});
