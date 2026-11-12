import { describe, expect, it } from 'vitest';
import { passkeyItem, passkeyOf, type Item, type VaultItem } from './item';
import type { Snapshot, VaultView } from './manager';
import { importPasskeys, vaultPasskeys, type PendingPasskey } from './passkeys';

const view = (id: string, personal: boolean, canWrite = true) => ({ id, name: id, personal, canWrite }) as unknown as VaultView;

function pending(file: string, credentialId: string, privateKey = 'a2V5'): PendingPasskey {
  return { file, rp: 'webauthn.io', userName: 'mia', credentialId, userHandle: 'aA', privateKey };
}

function fake(snapshot: Partial<Snapshot>, fail = new Set<string>()) {
  const saved: { vaultId: string; item: Item }[] = [];
  const state: Snapshot = { vaults: [view('shared', false), view('personal', true)], items: [], trash: [], verified: {}, verifiedReady: true, ...snapshot };
  return {
    saved,
    getSnapshot: () => state,
    saveItem: async (vaultId: string, id: string | null, item: Item) => {
      if (id !== null) throw new Error('only creates');
      if (fail.has(passkeyOf(item)?.credentialId ?? '')) throw new Error('network');
      saved.push({ vaultId, item });
      return `new-${saved.length}`;
    },
  };
}

const stored = (vaultId: string, credentialId: string): VaultItem => ({
  vaultId,
  id: credentialId,
  revision: 1,
  item: passkeyItem({ rp: 'webauthn.io', userName: 'mia', credentialId, userHandle: 'aA', privateKey: 'a2V5' }),
});

describe('importPasskeys', () => {
  it('saves new passkeys into the personal vault and acknowledges their files', async () => {
    const vaults = fake({});
    const done = await importPasskeys(vaults, [pending('a.enc', 'AAA'), pending('b.enc', 'BBB')]);
    expect(done).toEqual(['a.enc', 'b.enc']);
    expect(vaults.saved.map((s) => s.vaultId)).toEqual(['personal', 'personal']);
    expect(passkeyOf(vaults.saved[0]!.item)?.credentialId).toBe('AAA');
  });

  it('does not duplicate passkeys already in the personal vault or deliberately trashed there', async () => {
    const vaults = fake({ items: [stored('personal', 'AAA')], trash: [stored('personal', 'BBB')] });
    const done = await importPasskeys(vaults, [pending('a.enc', 'AAA'), pending('b.enc', 'BBB'), pending('c.enc', 'CCC'), pending('d.enc', 'CCC')]);
    expect(done).toEqual(['a.enc', 'b.enc', 'c.enc', 'd.enc']);
    expect(vaults.saved.map((s) => passkeyOf(s.item)?.credentialId)).toEqual(['CCC']);
  });

  it('does not let a shared-vault item with the same credential ID swallow a new passkey', async () => {
    const planted = stored('shared', 'AAA');
    planted.item.fields = planted.item.fields.map((f) => (f.id === 'privateKey' ? { ...f, value: 'YXR0YWNrZXI' } : f));
    const vaults = fake({ items: [planted], trash: [stored('shared', 'BBB')] });
    const done = await importPasskeys(vaults, [pending('a.enc', 'AAA'), pending('b.enc', 'BBB')]);
    expect(done).toEqual(['a.enc', 'b.enc']);
    expect(vaults.saved.map((s) => [s.vaultId, passkeyOf(s.item)?.credentialId])).toEqual([['personal', 'AAA'], ['personal', 'BBB']]);
  });

  it('imports again when the personal vault holds the same ID with a different key', async () => {
    const other = stored('personal', 'AAA');
    other.item.fields = other.item.fields.map((f) => (f.id === 'privateKey' ? { ...f, value: 'b3RoZXI' } : f));
    const vaults = fake({ items: [other] });
    expect(await importPasskeys(vaults, [pending('a.enc', 'AAA')])).toEqual(['a.enc']);
    expect(vaults.saved).toHaveLength(1);
  });

  it('keeps a partially readable device file', async () => {
    const vaults = fake({});
    expect(await importPasskeys(vaults, [{ ...pending('legacy.enc', 'AAA'), partial: true }])).toEqual([]);
    expect(vaults.saved).toHaveLength(1);
  });

  it('keeps a file when any passkey in it could not be saved', async () => {
    const vaults = fake({}, new Set(['BBB']));
    const done = await importPasskeys(vaults, [pending('legacy.enc', 'AAA'), pending('legacy.enc', 'BBB'), pending('c.enc', 'CCC')]);
    expect(done).toEqual(['c.enc']);
  });

  it('keeps everything when there is no writable personal vault', async () => {
    const vaults = fake({ vaults: [view('personal', true, false)] });
    expect(await importPasskeys(vaults, [pending('a.enc', 'AAA')])).toEqual([]);
    expect(vaults.saved).toEqual([]);
  });

  it('ignores malformed entries without acknowledging them', async () => {
    const vaults = fake({});
    expect(await importPasskeys(vaults, [pending('bad.enc', 'AAA', 'not base64!')])).toEqual([]);
  });
});

describe('vaultPasskeys', () => {
  it('publishes valid passkeys from all vaults, personal ones first', () => {
    const broken = stored('personal', 'BROKEN');
    broken.item.fields = broken.item.fields.map((f) => (f.id === 'privateKey' ? { ...f, value: '' } : f));
    const vaults = [view('shared', false), view('personal', true)];
    expect(vaultPasskeys([stored('shared', 'AAA'), stored('personal', 'BBB'), broken], vaults).map((p) => p.credentialId)).toEqual(['BBB', 'AAA']);
  });
});
