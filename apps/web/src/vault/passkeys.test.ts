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
  const state: Snapshot = { vaults: [view('shared', false), view('personal', true)], items: [], trash: [], ...snapshot };
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

  it('does not duplicate passkeys already in the vault or deliberately trashed', async () => {
    const vaults = fake({ items: [stored('shared', 'AAA')], trash: [stored('personal', 'BBB')] });
    const done = await importPasskeys(vaults, [pending('a.enc', 'AAA'), pending('b.enc', 'BBB'), pending('c.enc', 'CCC'), pending('d.enc', 'CCC')]);
    expect(done).toEqual(['a.enc', 'b.enc', 'c.enc', 'd.enc']);
    expect(vaults.saved.map((s) => passkeyOf(s.item)?.credentialId)).toEqual(['CCC']);
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
  it('publishes valid passkeys from all vaults but nothing from the trash', () => {
    const broken = stored('personal', 'BROKEN');
    broken.item.fields = broken.item.fields.map((f) => (f.id === 'privateKey' ? { ...f, value: '' } : f));
    expect(vaultPasskeys([stored('shared', 'AAA'), stored('personal', 'BBB'), broken]).map((p) => p.credentialId)).toEqual(['AAA', 'BBB']);
  });
});
