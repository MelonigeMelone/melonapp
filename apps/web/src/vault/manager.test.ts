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
    { ...vault('personal', true, '', [member(ME, 'ME-KEY')]), encrypted_vault_key: 'seal:ME-KEY:personal-1' },
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
      rotate: async (id: string, body: { key_version: number; encrypted_meta: string; members: { user_id: string; encrypted_vault_key: string }[] }) => {
        this.rotations += 1;
        this.sealedFor.push(...body.members.map((m) => m.user_id));
        const v = this.vault(id);
        v.rotation_needed = false;
        v.encrypted_meta = body.encrypted_meta;
        v.key_version = body.key_version;
        const mine = body.members.find((m) => m.user_id === ME);
        if (mine) {
          v.encrypted_vault_key = mine.encrypted_vault_key;
          v.member_key_version = body.key_version;
        }
      },
      createInvite: async () => ({ id: 'inv-1', token: 'token', expires_in_days: 7 }),
      listInvites: async () => ({ invites: [{ id: 'inv-1', email: 'eve@example.test', role: 'editor', expires_in_hours: 100 }] }),
      deleteInvite: async () => undefined,
    } as unknown as Api;
  }
}

function openFake(args: Record<string, unknown>) {
  const sealed = String(args.sealed);
  const parts = sealed.split(':');
  const legacy = parts[0] !== 'seal';
  const keyId = legacy ? `${sealed}@${String(args.keyVersion)}` : String(parts[2]);
  if (legacy && !args.legacy) throw new Error('vault_key_unauthenticated');
  const sender = legacy ? null : (args.senders as string[]).indexOf(String(parts[1]));
  if (sender === -1) throw new Error('decrypt_failed');
  if (args.pinned !== null && args.pinned !== keyId) throw new Error('vault_key_changed');
  return { sender, keyId };
}

function setup(seen: SeenLog = memoryLog(), shareKeys = true, server = new FakeServer()) {
  const opened = new Map<string, number>();
  let rotations = 0;
  const crypto = (async (method: string, args: Record<string, unknown>) => {
    switch (method) {
      case 'ownPublicKey':
        return 'ME-KEY';
      case 'hasVault':
        return opened.get(String(args.vaultId)) === args.keyVersion;
      case 'openVault': {
        const result = openFake(args);
        opened.set(String(args.vaultId), Number(args.keyVersion));
        return result;
      }
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
        rotations += 1;
        return {
          encryptedMeta: args.meta,
          members: (args.members as { userId: string }[]).map((m) => ({ user_id: m.userId, encrypted_vault_key: `seal:ME-KEY:rotated-${rotations}` })),
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
    await expect(manager.sync()).rejects.toThrow('vault_key_unauthenticated');
    expect(server.sealedFor).not.toContain(MIA);
    server.vault('eves').encrypted_vault_key = 'seal:EVE-KEY:eves';
    await expect(manager.sync()).rejects.toThrow('decrypt_failed');
    expect(server.sealedFor).not.toContain(MIA);
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

describe('authenticated vault keys in the vaults manager', () => {
  function errorOf(promise: Promise<unknown>) {
    return promise.then(
      () => null,
      (e: unknown) => (e instanceof Error ? e.message : String(e)),
    );
  }

  function newDevice(server: FakeServer, seen: SeenLog = memoryLog()) {
    return setup(seen, true, server);
  }

  it('refuses a personal vault key the account did not seal itself', async () => {
    const { server, manager } = setup();
    server.vault('personal').encrypted_vault_key = 'seal:SERVER-KEY:forged';
    expect(await errorOf(manager.sync())).toBe('decrypt_failed');
    expect(manager.getSnapshot().vaults.find((v) => v.id === 'personal')?.itemCount).toBe(0);
    expect(server.vault('personal').encrypted_meta).toBe(JSON.stringify({ name: '' }));
  });

  it('moves an old personal vault to a key only the account can produce', async () => {
    const seen = memoryLog();
    const { server, manager } = setup(seen);
    server.vault('personal').encrypted_vault_key = 'k';
    await manager.sync();
    expect(server.vault('personal').key_version).toBe(2);
    expect(server.vault('personal').encrypted_vault_key).toMatch(/^seal:ME-KEY:/);
    server.vault('personal').encrypted_vault_key = 'k';
    server.vault('personal').member_key_version = 3;
    server.vault('personal').key_version = 3;
    expect(await errorOf(newDevice(server, seen).manager.sync())).toBe('vault_key_unauthenticated');
  });

  it('remembers shared vault keys and refuses a different one for the same version', async () => {
    const { server, manager } = setup();
    await manager.sync();
    const keys = JSON.parse(server.vault('personal').encrypted_meta).keys as string;
    expect(keys).toMatch(/^private:me:vault-keys:/);
    server.family().encrypted_vault_key = 'seal:MIA-KEY:forged';
    expect(await errorOf(newDevice(server).manager.sync())).toBe('vault_key_changed');
  });

  it('accepts a new key version only from someone already in the vault', async () => {
    const { server, manager } = setup();
    await manager.sync();
    server.family().members.push(member(EVE, 'EVE-KEY', true));
    Object.assign(server.family(), { key_version: 2, member_key_version: 2, encrypted_vault_key: 'seal:EVE-KEY:forged' });
    expect(await errorOf(newDevice(server).manager.sync())).toBe('decrypt_failed');
    expect(await errorOf(manager.sync())).toBe('decrypt_failed');
    server.family().encrypted_vault_key = 'k';
    expect(await errorOf(manager.sync())).toBe('vault_key_unauthenticated');
    server.family().encrypted_vault_key = 'seal:MIA-KEY:rotated-by-mia';
    expect(await errorOf(manager.sync())).toBeNull();
  });

  it('a new key version from someone the server swapped in under a known name is refused', async () => {
    const { server, manager } = setup();
    await manager.sync();
    swapMiasKey(server);
    Object.assign(server.family(), { key_version: 2, member_key_version: 2, encrypted_vault_key: 'seal:ATTACKER-KEY:forged' });
    expect(await errorOf(newDevice(server).manager.sync())).toBe('decrypt_failed');
  });

  it('accepts a new key version from a member whose code was checked', async () => {
    const { server, manager } = await verifiedSetup();
    server.family().members.push(member(EVE, 'EVE-KEY', true));
    await manager.setVerified(EVE, 'EVE-KEY');
    Object.assign(server.family(), { key_version: 2, member_key_version: 2, encrypted_vault_key: 'seal:EVE-KEY:rotated-by-eve' });
    expect(await errorOf(manager.sync())).toBeNull();
  });

  it('refuses an older key version than the one it knows', async () => {
    const { server, manager } = setup();
    await manager.sync();
    Object.assign(server.family(), { key_version: 2, member_key_version: 2, encrypted_vault_key: 'seal:MIA-KEY:v2' });
    await manager.sync();
    Object.assign(server.family(), { key_version: 1, member_key_version: 1, encrypted_vault_key: 'k' });
    expect(await errorOf(newDevice(server).manager.sync())).toBe('vault_key_rolled_back');
  });

  it('opens no shared vault when the server hides the remembered keys', async () => {
    const seen = memoryLog();
    const { server, manager } = setup(seen);
    const before = server.vault('personal').encrypted_meta;
    await manager.sync();
    server.vault('personal').encrypted_meta = before;
    expect(await errorOf(newDevice(server, seen).manager.sync())).toBe('vault_keys_unavailable');
  });

  it('a member the server adds to a known vault cannot hand out a new key, even with an old member list replayed', async () => {
    const { server, manager } = setup();
    const before = server.family().encrypted_meta;
    await manager.sync();
    server.family().encrypted_meta = before;
    server.family().members.push(member(EVE, 'SERVER-KEY', true));
    await manager.sync().catch(() => undefined);
    Object.assign(server.family(), { key_version: 2, member_key_version: 2, encrypted_vault_key: 'seal:SERVER-KEY:forged' });
    expect(await errorOf(newDevice(server).manager.sync())).toBe('decrypt_failed');
    expect(await errorOf(manager.sync())).toBe('decrypt_failed');
  });

  it('a new member in the list counts as sender only with the key that was checked, not the one the server shows', async () => {
    const { server, manager } = setup();
    await manager.sync();
    const meta = JSON.parse(server.family().encrypted_meta);
    meta.trust = { ...meta.trust, seq: meta.trust.seq + 1, members: [...meta.trust.members, EVE] };
    server.family().encrypted_meta = JSON.stringify(meta);
    server.family().members.push(member(EVE, 'SERVER-KEY', true));
    await manager.sync().catch(() => undefined);
    Object.assign(server.family(), { key_version: 2, member_key_version: 2, encrypted_vault_key: 'seal:SERVER-KEY:forged' });
    expect(await errorOf(manager.sync())).toBe('decrypt_failed');
    Object.assign(server.family(), { encrypted_vault_key: 'seal:EVE-KEY:rotated-by-eve' });
    server.family().members = server.family().members.map((m) => (m.user_id === EVE ? { ...m, public_key: 'EVE-KEY' } : m));
    expect(await errorOf(manager.sync())).toBe('decrypt_failed');
    await manager.setVerified(EVE, 'EVE-KEY').catch(() => undefined);
    expect(await errorOf(manager.sync())).toBeNull();
  });

  it('writes nothing with an old personal key until the new one is in place', async () => {
    const { server, manager } = setup();
    server.vault('personal').encrypted_vault_key = 'k';
    const api = (manager as unknown as { api: Api }).api;
    (manager as unknown as { api: Api }).api = { ...api, rotate: async () => Promise.reject(new ApiError(500, 'server_error')) } as Api;
    expect(await errorOf(manager.sync())).not.toBeNull();
    expect(manager.vault('personal')?.canWrite).toBe(false);
    const item = { type: 'login', title: 'Neu', fields: [], sections: [] } as unknown as Parameters<VaultsManager['saveItem']>[2];
    expect(await errorOf(manager.saveItem('personal', null, item))).toBe('vault_key_pending');
    expect(await errorOf(manager.renameVault('personal', 'Lesbar'))).toBe('vault_key_pending');
    (manager as unknown as { api: Api }).api = api;
    await manager.sync();
    expect(server.vault('personal').key_version).toBe(2);
    expect(manager.vault('personal')?.canWrite).toBe(true);
  });

  it('a member that left can no longer hand out a new key', async () => {
    const { server, manager } = setup();
    await manager.sync();
    await manager.removeMember('family', MIA);
    Object.assign(server.family(), {
      key_version: 3,
      member_key_version: 3,
      encrypted_vault_key: 'seal:MIA-KEY:forged',
      members: [member(ME, 'ME-KEY'), member(MIA, 'MIA-KEY')],
    });
    expect(await errorOf(manager.sync())).toBe('decrypt_failed');
  });
});
