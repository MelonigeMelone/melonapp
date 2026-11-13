import { describe, expect, it } from 'vitest';
import { ApiError, type Api, type RemoteMember, type RemoteVault } from '../api';
import { VaultsManager } from './manager';
import { memoryLog, type SeenLog } from './seen';

const ME = 'me';
const MIA = 'mia';
const EVE = 'eve';

function member(user_id: string, public_key: string, has_key = true): RemoteMember {
  return { user_id, email: `${user_id}@example.test`, role: user_id === ME ? 'owner' : 'editor', public_key, has_key, key_version: has_key ? 1 : null };
}

function vault(id: string, personal: boolean, name: string, members: RemoteMember[]): RemoteVault {
  return {
    id,
    personal,
    encrypted_meta: JSON.stringify({ name }),
    key_version: 1,
    revision: 1,
    rotation_needed: false,
    role: 'owner',
    encrypted_vault_key: 'k',
    member_key_version: 1,
    members,
  };
}

class FakeServer {
  sealedFor: string[] = [];
  rotations = 0;
  vaults: RemoteVault[] = [
    vault('personal', true, '', [member(ME, 'ME-KEY')]),
    vault('family', false, 'Familie', [member(ME, 'ME-KEY'), member(MIA, 'MIA-KEY')]),
  ];

  vault(id: string): RemoteVault {
    const v = this.vaults.find((x) => x.id === id);
    if (!v) throw new ApiError(404, 'vault_not_found');
    return v;
  }

  family(): RemoteVault {
    return this.vault('family');
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
      rotate: async (id: string, body: { encrypted_meta: string; members: { user_id: string }[] }) => {
        this.rotations += 1;
        this.sealedFor.push(...body.members.map((m) => m.user_id));
        const v = this.vault(id);
        v.rotation_needed = false;
        v.encrypted_meta = body.encrypted_meta;
      },
      createInvite: async () => ({ id: 'inv-1', token: 'token', expires_in_days: 7 }),
      listInvites: async () => ({ invites: [{ id: 'inv-1', email: 'eve@example.test', role: 'editor', expires_in_hours: 100 }] }),
      deleteInvite: async () => undefined,
    } as unknown as Api;
  }
}

function setup(seen: SeenLog = memoryLog(), shareKeys = true) {
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
      case 'sealPrivate':
        return `private:${String(args.userId)}:${String(args.purpose)}:${String(args.plaintext)}`;
      case 'openPrivate': {
        const prefix = `private:${String(args.userId)}:${String(args.purpose)}:`;
        const data = String(args.data);
        if (!data.startsWith(prefix)) throw new Error('decrypt_failed');
        return data.slice(prefix.length);
      }
      case 'rotate':
        return {
          encryptedMeta: args.meta,
          members: (args.members as { userId: string }[]).map((m) => ({ user_id: m.userId, encrypted_vault_key: 'k2' })),
          items: [],
        };
      default:
        throw new Error(`unexpected ${method}`);
    }
  }) as unknown as ConstructorParameters<typeof VaultsManager>[2];
  const manager = new VaultsManager(ME, server.api(), crypto, seen, () => new Date('2026-11-12T10:00:00Z'), shareKeys);
  return { server, manager };
}

function swapMiasKey(server: FakeServer) {
  for (const v of server.vaults) for (const m of v.members) if (m.user_id === MIA) m.public_key = 'ATTACKER-KEY';
}

function miaWaitsForKey(server: FakeServer) {
  const m = server.family().members.find((x) => x.user_id === MIA);
  if (m) m.has_key = false;
}

async function verifiedSetup() {
  const s = setup();
  await s.manager.sync();
  await s.manager.setVerified(MIA, 'MIA-KEY');
  return s;
}

describe('verified security codes in the vaults manager', () => {
  it('stores the mark sealed with the account in the personal vault and keeps its name', async () => {
    const { server, manager } = setup();
    await manager.sync();
    await manager.renameVault('personal', 'Meins');
    await manager.setVerified(MIA, 'MIA-KEY');
    expect(manager.getSnapshot().verified[MIA]).toEqual({ publicKey: 'MIA-KEY', at: '2026-11-12T10:00:00.000Z' });
    const meta = JSON.parse(server.vault('personal').encrypted_meta);
    expect(meta.name).toBe('Meins');
    expect(meta.verified).toMatch(/^private:me:verified-codes:/);
    await manager.renameVault('personal', 'Wieder meins');
    expect(manager.getSnapshot().verified[MIA]?.publicKey).toBe('MIA-KEY');
    await manager.setVerified(MIA, null);
    expect(manager.getSnapshot().verified[MIA]).toBeUndefined();
  });

  it('shares with unverified members it already lists', async () => {
    const { server, manager } = setup();
    await manager.sync();
    miaWaitsForKey(server);
    await manager.sync();
    expect(server.sealedFor).toContain(MIA);
  });

  it('someone still waiting from before the member list existed needs a checked code', async () => {
    const { server, manager } = setup();
    miaWaitsForKey(server);
    await manager.sync();
    expect(server.sealedFor).not.toContain(MIA);
    await manager.setVerified(MIA, 'MIA-KEY');
    expect(server.sealedFor).toContain(MIA);
  });

  it('does not hand the vault key to a member the server invents', async () => {
    const { server, manager } = setup();
    await manager.sync();
    server.family().members.push(member(EVE, 'EVE-KEY', false));
    await manager.sync();
    expect(server.sealedFor).not.toContain(EVE);
  });

  it('does not seal a rotated key for a member the server invents', async () => {
    const { server, manager } = setup();
    await manager.sync();
    server.family().members.push(member(EVE, 'EVE-KEY', true));
    server.family().rotation_needed = true;
    await expect(manager.sync()).rejects.toMatchObject({ code: 'member_unconfirmed' });
    expect(server.rotations).toBe(0);
    expect(server.sealedFor).not.toContain(EVE);
  });

  it('grants invited people automatically and records them as members', async () => {
    const { server, manager } = setup();
    await manager.sync();
    await manager.invite('family', ' Eve@Example.test ', 'editor');
    server.family().members.push(member(EVE, 'EVE-KEY', false));
    await manager.sync();
    expect(server.sealedFor).toContain(EVE);
    const trust = JSON.parse(server.family().encrypted_meta).trust;
    expect(trust.members).toContain(EVE);
    expect(trust.invited).toEqual([]);
  });

  it('a revoked invitation no longer grants access', async () => {
    const { server, manager } = setup();
    await manager.sync();
    await manager.invite('family', 'eve@example.test', 'editor');
    await manager.revokeInvite('family', 'inv-1');
    server.family().members.push(member(EVE, 'EVE-KEY', false));
    await manager.sync();
    expect(server.sealedFor).not.toContain(EVE);
  });

  it('grants people whose code was checked even without an invitation', async () => {
    const { server, manager } = setup();
    await manager.sync();
    await manager.setVerified(EVE, 'EVE-KEY');
    server.family().members.push(member(EVE, 'EVE-KEY', false));
    await manager.sync();
    expect(server.sealedFor).toContain(EVE);
  });

  it('refuses a replayed or removed member list', async () => {
    const { server, manager } = setup();
    await manager.sync();
    const old = server.family().encrypted_meta;
    await manager.invite('family', 'lea@example.test', 'editor');
    server.family().encrypted_meta = old;
    server.family().members.push(member(EVE, 'EVE-KEY', true));
    server.family().rotation_needed = true;
    await expect(manager.sync()).rejects.toMatchObject({ code: 'members_unavailable' });
    server.family().encrypted_meta = JSON.stringify({ name: 'Familie' });
    await expect(manager.sync()).rejects.toMatchObject({ code: 'members_unavailable' });
    expect(server.rotations).toBe(0);
  });

  it('does not hand the vault key to a swapped key when granting access', async () => {
    const { server, manager } = await verifiedSetup();
    swapMiasKey(server);
    miaWaitsForKey(server);
    await expect(manager.sync()).rejects.toMatchObject({ code: 'key_changed' });
    expect(server.sealedFor).not.toContain(MIA);
  });

  it('checks keys even when the shared vault is listed before the personal one', async () => {
    const seen = memoryLog();
    const first = setup(seen);
    await first.manager.sync();
    await first.manager.setVerified(MIA, 'MIA-KEY');
    const { server, manager } = setup(seen);
    server.vault('personal').encrypted_meta = first.server.vault('personal').encrypted_meta;
    server.family().encrypted_meta = first.server.family().encrypted_meta;
    server.vaults.reverse();
    swapMiasKey(server);
    miaWaitsForKey(server);
    await expect(manager.sync()).rejects.toMatchObject({ code: 'key_changed' });
    expect(server.sealedFor).not.toContain(MIA);
  });

  it('does not seal a new vault key to a swapped key when rotating', async () => {
    const { server, manager } = await verifiedSetup();
    swapMiasKey(server);
    server.family().rotation_needed = true;
    await expect(manager.sync()).rejects.toMatchObject({ code: 'key_changed' });
    expect(server.rotations).toBe(0);
  });

  it('does not add a known user whose key changed since it was verified', async () => {
    const { server, manager } = await verifiedSetup();
    const found = { user_id: MIA, email: 'mia@example.test', public_key: 'ATTACKER-KEY', fingerprint: 'x' };
    await expect(manager.addKnownMember('family', found, 'editor')).rejects.toMatchObject({ code: 'key_changed' });
    expect(server.sealedFor).not.toContain(MIA);
  });

  it('shares nothing when the server hides the personal vault', async () => {
    const { server, manager } = await verifiedSetup();
    server.vaults = server.vaults.filter((v) => !v.personal);
    swapMiasKey(server);
    miaWaitsForKey(server);
    await expect(manager.sync()).rejects.toMatchObject({ code: 'verifications_unavailable' });
    expect(server.sealedFor).not.toContain(MIA);
  });

  it('shares nothing when the server drops the marks or replays older ones', async () => {
    const { server, manager } = await verifiedSetup();
    const before = server.vault('personal').encrypted_meta;
    await manager.setVerified(EVE, 'EVE-KEY');
    server.vault('personal').encrypted_meta = before;
    swapMiasKey(server);
    miaWaitsForKey(server);
    await expect(manager.sync()).rejects.toMatchObject({ code: 'verifications_unavailable' });
    server.vault('personal').encrypted_meta = JSON.stringify({ name: '' });
    await expect(manager.sync()).rejects.toMatchObject({ code: 'verifications_unavailable' });
    expect(server.sealedFor).not.toContain(MIA);
  });

  it('ignores a foreign vault passed off as personal and marks it cannot seal', async () => {
    const { server, manager } = await verifiedSetup();
    const forged = JSON.stringify({ name: '', verified: `private:${EVE}:verified-codes:{"counter":9,"marks":{}}` });
    server.vaults.unshift(vault('eves', true, '', [member(ME, 'ME-KEY'), member(EVE, 'EVE-KEY')]));
    server.vault('eves').encrypted_meta = forged;
    swapMiasKey(server);
    miaWaitsForKey(server);
    await expect(manager.sync()).rejects.toMatchObject({ code: 'key_changed' });
    server.vaults = server.vaults.filter((v) => v.id !== 'eves');
    server.vault('personal').encrypted_meta = forged;
    await expect(manager.sync()).rejects.toMatchObject({ code: 'verifications_unavailable' });
    expect(server.sealedFor).not.toContain(MIA);
  });

  it('shares again after the new code is checked', async () => {
    const { server, manager } = await verifiedSetup();
    swapMiasKey(server);
    miaWaitsForKey(server);
    await expect(manager.sync()).rejects.toMatchObject({ code: 'key_changed' });
    await manager.setVerified(MIA, 'ATTACKER-KEY');
    expect(server.sealedFor).toContain(MIA);
  });

  it('a device that missed newer marks catches up before writing, so no device gets stuck', async () => {
    const seenA = memoryLog();
    const a = setup(seenA);
    await a.manager.sync();
    await a.manager.setVerified(MIA, 'MIA-KEY');
    await a.manager.setVerified(EVE, 'EVE-KEY');
    const b = setup();
    b.server.vaults = a.server.vaults;
    await b.manager.sync();
    await a.manager.setVerified('lea', 'LEA-KEY');
    await b.manager.setVerified('max', 'MAX-KEY');
    await a.manager.sync();
    await b.manager.sync();
    expect(a.manager.getSnapshot().verifiedReady).toBe(true);
    expect(b.manager.getSnapshot().verifiedReady).toBe(true);
    expect(Object.keys(a.manager.getSnapshot().verified).sort()).toEqual(['eve', 'lea', 'max', 'mia']);
  });

  it('refuses to write marks it could not load fresh', async () => {
    const { server, manager } = await verifiedSetup();
    const api = server.api();
    (manager as unknown as { api: Api }).api = { ...api, listVaults: async () => Promise.reject(new Error('offline')) } as Api;
    await expect(manager.setVerified(EVE, 'EVE-KEY')).rejects.toMatchObject({ code: 'verifications_unavailable' });
  });

  it('after a server restore the user can adopt the stored marks and share again', async () => {
    const { server, manager } = await verifiedSetup();
    const restored = server.vault('personal').encrypted_meta;
    await manager.setVerified(EVE, 'EVE-KEY');
    server.vault('personal').encrypted_meta = restored;
    miaWaitsForKey(server);
    await expect(manager.sync()).rejects.toMatchObject({ code: 'verifications_unavailable' });
    expect(manager.getSnapshot().verifiedReady).toBe(false);
    await manager.adoptStoredMarks();
    expect(manager.getSnapshot().verifiedReady).toBe(true);
    expect(Object.keys(manager.getSnapshot().verified)).toEqual([MIA]);
    expect(server.sealedFor).toContain(MIA);
  });

  it('never hands the key of the personal vault to a member the server adds', async () => {
    const { server, manager } = setup();
    await manager.sync();
    const personal = server.vault('personal');
    personal.personal = false;
    personal.members.push(member(EVE, 'EVE-KEY', false));
    await manager.sync();
    expect(server.sealedFor).not.toContain(EVE);
    personal.members[1] = member(EVE, 'EVE-KEY', true);
    personal.rotation_needed = true;
    await expect(manager.sync()).rejects.toMatchObject({ code: 'member_unconfirmed' });
    expect(server.rotations).toBe(0);
  });

  it('removing a member takes it off the encrypted member list', async () => {
    const { server, manager } = setup();
    await manager.sync();
    await manager.removeMember('family', MIA);
    expect(JSON.parse(server.family().encrypted_meta).trust.members).toEqual([ME]);
  });

  it('a removed waiting member is not granted when the server brings it back', async () => {
    const { server, manager } = setup();
    await manager.sync();
    await manager.invite('family', 'eve@example.test', 'editor');
    server.family().members.push(member(EVE, 'EVE-KEY', false));
    (manager as unknown as { api: Api }).api = {
      ...server.api(),
      grantKey: async () => undefined,
      removeMember: async () => {
        server.family().members = server.family().members.filter((m) => m.user_id !== EVE);
      },
    } as Api;
    await manager.sync();
    expect(JSON.parse(server.family().encrypted_meta).trust.members).toContain(EVE);
    await manager.removeMember('family', EVE);
    (manager as unknown as { api: Api }).api = server.api();
    server.sealedFor = [];
    server.family().members.push(member(EVE, 'EVE-KEY', false));
    await manager.sync();
    expect(server.sealedFor).not.toContain(EVE);
    expect(JSON.parse(server.family().encrypted_meta).trust.members).toEqual([ME, MIA]);
  });

  it('the extension popup never shares keys and still syncs without the account key', async () => {
    const { server } = await verifiedSetup();
    const popup = setup(memoryLog(), false);
    popup.server.vaults = server.vaults;
    swapMiasKey(popup.server);
    miaWaitsForKey(popup.server);
    await popup.manager.sync();
    expect(popup.server.sealedFor).toEqual([]);
  });
});
