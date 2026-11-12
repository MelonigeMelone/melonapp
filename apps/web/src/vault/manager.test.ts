import { describe, expect, it } from 'vitest';
import { ApiError, type Api, type RemoteMember, type RemoteVault } from '../api';
import { VaultsManager } from './manager';
import { memoryLog } from './seen';

const ME = 'me';
const MIA = 'mia';

function member(user_id: string, public_key: string, has_key = true): RemoteMember {
  return { user_id, email: `${user_id}@example.test`, role: user_id === ME ? 'owner' : 'editor', public_key, has_key, key_version: has_key ? 1 : null };
}

class FakeServer {
  sealedFor: string[] = [];
  rotations = 0;
  vaults: RemoteVault[] = [
    {
      id: 'personal',
      personal: true,
      encrypted_meta: JSON.stringify({ name: '' }),
      key_version: 1,
      revision: 1,
      rotation_needed: false,
      role: 'owner',
      encrypted_vault_key: 'k',
      member_key_version: 1,
      members: [member(ME, 'ME-KEY')],
    },
    {
      id: 'family',
      personal: false,
      encrypted_meta: JSON.stringify({ name: 'Familie' }),
      key_version: 1,
      revision: 1,
      rotation_needed: false,
      role: 'owner',
      encrypted_vault_key: 'k',
      member_key_version: 1,
      members: [member(ME, 'ME-KEY'), member(MIA, 'MIA-KEY')],
    },
  ];

  vault(id: string): RemoteVault {
    const v = this.vaults.find((x) => x.id === id);
    if (!v) throw new ApiError(404, 'vault_not_found');
    return v;
  }

  api(): Api {
    return {
      listVaults: async () => ({ vaults: structuredClone(this.vaults) }),
      listItems: async () => ({ items: [], latest_revision: 0, has_more: false }),
      updateVault: async (id: string, body: { encrypted_meta: string; key_version: number }) => {
        const v = this.vault(id);
        v.encrypted_meta = body.encrypted_meta;
        v.revision += 1;
        return { revision: v.revision };
      },
      grantKey: async (id: string, userId: string) => {
        this.sealedFor.push(userId);
        const m = this.vault(id).members.find((x) => x.user_id === userId);
        if (m) m.has_key = true;
      },
      addMember: async (_id: string, body: { user_id: string }) => {
        this.sealedFor.push(body.user_id);
      },
      rotate: async (id: string, body: { members: { user_id: string }[] }) => {
        this.rotations += 1;
        this.sealedFor.push(...body.members.map((m) => m.user_id));
        this.vault(id).rotation_needed = false;
      },
    } as unknown as Api;
  }
}

function setup() {
  const server = new FakeServer();
  const crypto = (async (method: string, args: Record<string, unknown>) => {
    switch (method) {
      case 'hasVault':
        return true;
      case 'decryptMeta':
        return args.data;
      case 'encryptMeta':
        return args.plaintext;
      case 'sealFor':
        return `sealed:${String(args.publicKey)}`;
      case 'decryptItems':
        return [];
      case 'rotate':
        return {
          encryptedMeta: args.meta,
          members: (args.members as { userId: string }[]).map((m) => ({ user_id: m.userId, encrypted_vault_key: 'k2' })),
          items: [],
        };
      case 'fingerprint':
        return `code:${String(args.publicKey)}`;
      default:
        throw new Error(`unexpected ${method}`);
    }
  }) as unknown as ConstructorParameters<typeof VaultsManager>[2];
  const manager = new VaultsManager(ME, server.api(), crypto, memoryLog(), () => new Date('2026-11-12T10:00:00Z'));
  return { server, manager };
}

function swapMiasKey(server: FakeServer) {
  for (const v of server.vaults) for (const m of v.members) if (m.user_id === MIA) m.public_key = 'ATTACKER-KEY';
}

describe('verified security codes in the vaults manager', () => {
  it('stores the mark encrypted in the personal vault and keeps its name', async () => {
    const { server, manager } = setup();
    await manager.sync();
    await manager.renameVault('personal', 'Meins');
    await manager.setVerified(MIA, 'MIA-KEY');
    expect(manager.getSnapshot().verified[MIA]).toEqual({ publicKey: 'MIA-KEY', at: '2026-11-12T10:00:00.000Z' });
    expect(JSON.parse(server.vault('personal').encrypted_meta)).toMatchObject({ name: 'Meins' });
    await manager.renameVault('personal', 'Wieder meins');
    expect(manager.getSnapshot().verified[MIA]?.publicKey).toBe('MIA-KEY');
    await manager.setVerified(MIA, null);
    expect(manager.getSnapshot().verified[MIA]).toBeUndefined();
  });

  it('does not hand the vault key to a swapped key when granting access', async () => {
    const { server, manager } = setup();
    await manager.sync();
    await manager.setVerified(MIA, 'MIA-KEY');
    swapMiasKey(server);
    server.vault('family').members.find((m) => m.user_id === MIA)!.has_key = false;
    await expect(manager.sync()).rejects.toMatchObject({ code: 'key_changed' });
    expect(server.sealedFor).not.toContain(MIA);
  });

  it('does not seal a new vault key to a swapped key when rotating', async () => {
    const { server, manager } = setup();
    await manager.sync();
    await manager.setVerified(MIA, 'MIA-KEY');
    swapMiasKey(server);
    server.vault('family').rotation_needed = true;
    await expect(manager.sync()).rejects.toMatchObject({ code: 'key_changed' });
    expect(server.rotations).toBe(0);
  });

  it('does not add a known user whose key changed since it was verified', async () => {
    const { server, manager } = setup();
    server.vault('family').members = [member(ME, 'ME-KEY')];
    await manager.sync();
    await manager.setVerified(MIA, 'MIA-KEY');
    const found = { user_id: MIA, email: 'mia@example.test', public_key: 'ATTACKER-KEY', fingerprint: 'x' };
    await expect(manager.addKnownMember('family', found, 'editor')).rejects.toMatchObject({ code: 'key_changed' });
    expect(server.sealedFor).not.toContain(MIA);
  });

  it('shares again after the new code is checked, and leaves unverified people alone', async () => {
    const { server, manager } = setup();
    await manager.sync();
    await manager.setVerified(MIA, 'MIA-KEY');
    swapMiasKey(server);
    server.vault('family').members.find((m) => m.user_id === MIA)!.has_key = false;
    await expect(manager.sync()).rejects.toMatchObject({ code: 'key_changed' });
    await manager.setVerified(MIA, 'ATTACKER-KEY');
    expect(server.sealedFor).toContain(MIA);

    const other = setup();
    other.server.vault('family').members.find((m) => m.user_id === MIA)!.has_key = false;
    await other.manager.sync();
    expect(other.server.sealedFor).toContain(MIA);
  });
});
