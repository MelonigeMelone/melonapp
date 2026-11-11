import { ApiError, type Api, type InviteInfo, type RemoteMember, type RemoteVault, type Role } from '../api';
import type { CryptoMethods } from '../crypto/protocol';
import { newId, type Item, type VaultItem } from './item';
import { isConflict, VaultStore } from './store';

type Call = <M extends keyof CryptoMethods>(
  method: M,
  ...args: Parameters<CryptoMethods[M]>
) => Promise<ReturnType<CryptoMethods[M]>>;

export interface VaultView {
  id: string;
  name: string;
  personal: boolean;
  role: Role;
  members: RemoteMember[];
  waitingForKey: boolean;
  canWrite: boolean;
  isOwner: boolean;
  itemCount: number;
  unreadable: number;
}

export interface Snapshot {
  vaults: VaultView[];
  items: VaultItem[];
}

export type AddResult = { kind: 'added' } | { kind: 'invited'; token: string; expiresInDays: number };

interface Entry {
  remote: RemoteVault;
  name: string;
  store: VaultStore | null;
}

const PERSONAL_NAME = 'Persönlich';

function parseName(json: string): string {
  try {
    const o: unknown = JSON.parse(json);
    const name = o && typeof o === 'object' ? (o as { name?: unknown }).name : undefined;
    return typeof name === 'string' ? name : '';
  } catch {
    return '';
  }
}

export class VaultsManager {
  private vaults = new Map<string, Entry>();
  private listeners = new Set<() => void>();
  private snapshot: Snapshot = { vaults: [], items: [] };
  private running: Promise<void> | null = null;

  constructor(
    readonly userId: string,
    private readonly api: Api,
    private readonly crypto: Call,
  ) {}

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getSnapshot = () => this.snapshot;

  private emit = () => {
    const views: VaultView[] = [...this.vaults.values()].map(({ remote, name, store }) => ({
      id: remote.id,
      name: remote.personal ? name || PERSONAL_NAME : name || 'Tresor',
      personal: remote.personal,
      role: remote.role,
      members: remote.members,
      waitingForKey: remote.encrypted_vault_key === null,
      canWrite: remote.encrypted_vault_key !== null && remote.role !== 'viewer',
      isOwner: remote.role === 'owner',
      itemCount: store?.list().length ?? 0,
      unreadable: store?.unreadableCount ?? 0,
    }));
    views.sort((a, b) => Number(b.personal) - Number(a.personal) || a.name.localeCompare(b.name, 'de'));
    const items = [...this.vaults.values()]
      .flatMap((e) => e.store?.list() ?? [])
      .sort((a, b) => a.item.title.localeCompare(b.item.title, 'de', { sensitivity: 'base' }));
    this.snapshot = { vaults: views, items };
    for (const l of this.listeners) l();
  };

  vault(id: string): VaultView | undefined {
    return this.snapshot.vaults.find((v) => v.id === id);
  }

  item(vaultId: string, id: string): VaultItem | undefined {
    return this.vaults.get(vaultId)?.store?.get(id);
  }

  sync(): Promise<void> {
    this.running ??= this.pull().finally(() => {
      this.running = null;
    });
    return this.running;
  }

  private async pull() {
    const { vaults } = await this.api.listVaults();
    const seen = new Set(vaults.map((v) => v.id));
    for (const id of this.vaults.keys()) if (!seen.has(id)) this.vaults.delete(id);

    for (const remote of vaults) {
      const entry: Entry = this.vaults.get(remote.id) ?? { remote, name: '', store: null };
      const rotated = entry.remote.key_version !== remote.key_version;
      entry.remote = remote;
      this.vaults.set(remote.id, entry);
      if (remote.encrypted_vault_key === null || remote.member_key_version === null) {
        entry.store = null;
        continue;
      }
      const ready = await this.crypto('hasVault', { vaultId: remote.id, keyVersion: remote.member_key_version });
      if (!ready) {
        await this.crypto('openVault', {
          vaultId: remote.id,
          userId: this.userId,
          keyVersion: remote.member_key_version,
          sealed: remote.encrypted_vault_key,
        });
      }
      entry.name = parseName(await this.crypto('decryptMeta', { vaultId: remote.id, data: remote.encrypted_meta }));
      if (rotated) entry.store?.reset();
      entry.store ??= this.makeStore(remote.id);
      await entry.store.sync();
      if (remote.role === 'owner' && !remote.personal) await this.ownerDuties(entry);
    }
    this.emit();
  }

  private makeStore(vaultId: string): VaultStore {
    return new VaultStore(
      vaultId,
      {
        encrypt: (itemId, plaintext) => this.crypto('encryptItem', { vaultId, itemId, plaintext }),
        decrypt: (items) => this.crypto('decryptItems', { vaultId, items }),
      },
      {
        list: (since) => this.api.listItems(vaultId, since),
        put: (itemId, body) => this.api.putItem(vaultId, itemId, body),
        remove: (itemId, base) => this.api.deleteItem(vaultId, itemId, base),
      },
      () => this.vaults.get(vaultId)?.remote.key_version ?? 1,
      this.emit,
    );
  }

  private async ownerDuties(entry: Entry) {
    const { remote } = entry;
    if (remote.rotation_needed) {
      await this.rotate(remote.id, []);
      return;
    }
    for (const m of remote.members.filter((m) => !m.has_key)) {
      const sealed = await this.crypto('sealFor', { vaultId: remote.id, publicKey: m.public_key, userId: m.user_id });
      await this.api.grantKey(remote.id, m.user_id, { encrypted_vault_key: sealed, key_version: remote.key_version });
      m.has_key = true;
      m.key_version = remote.key_version;
    }
  }

  private async rotate(vaultId: string, removeUserIds: string[], retry = true): Promise<void> {
    const entry = this.vaults.get(vaultId);
    if (!entry?.store) throw new Error('vault_key_missing');
    await entry.store.sync();
    const keep = entry.remote.members.filter((m) => m.has_key && !removeUserIds.includes(m.user_id));
    const rotated = await this.crypto('rotate', {
      vaultId,
      meta: JSON.stringify({ name: entry.name }),
      members: keep.map((m) => ({ userId: m.user_id, publicKey: m.public_key })),
      items: entry.store.plaintexts(),
    });
    try {
      await this.api.rotate(vaultId, {
        key_version: entry.remote.key_version + 1,
        encrypted_meta: rotated.encryptedMeta,
        members: rotated.members,
        items: rotated.items,
        remove_user_ids: removeUserIds,
      });
    } catch (e) {
      if (!retry || !isConflict(e)) throw e;
      const { vaults } = await this.api.listVaults();
      const fresh = vaults.find((v) => v.id === vaultId);
      if (!fresh) return;
      entry.remote = fresh;
      return this.rotate(vaultId, removeUserIds, false);
    }
  }

  private requireEntry(vaultId: string): Entry {
    const entry = this.vaults.get(vaultId);
    if (!entry) throw new ApiError(404, 'vault_not_found');
    return entry;
  }

  private store(vaultId: string): VaultStore {
    const store = this.requireEntry(vaultId).store;
    if (!store) throw new ApiError(403, 'vault_key_pending');
    return store;
  }

  async saveItem(vaultId: string, id: string | null, item: Item, fromVaultId?: string): Promise<string> {
    if (fromVaultId && id && fromVaultId !== vaultId) {
      const newItemId = await this.store(vaultId).save(null, item);
      await this.store(fromVaultId).remove(id);
      this.emit();
      return newItemId;
    }
    const saved = await this.store(vaultId).save(id, item);
    this.emit();
    return saved;
  }

  async removeItem(vaultId: string, id: string) {
    await this.store(vaultId).remove(id);
    this.emit();
  }

  async createVault(name: string): Promise<string> {
    const vaultId = newId();
    const created = await this.crypto('newVault', { vaultId, userId: this.userId, meta: JSON.stringify({ name }) });
    await this.api.createVault({
      id: vaultId,
      encrypted_meta: created.encryptedMeta,
      encrypted_vault_key: created.encryptedVaultKey,
    });
    await this.sync();
    return vaultId;
  }

  async renameVault(vaultId: string, name: string) {
    const entry = this.requireEntry(vaultId);
    const meta = await this.crypto('encryptMeta', { vaultId, plaintext: JSON.stringify({ name }) });
    await this.api.updateVault(vaultId, { encrypted_meta: meta, key_version: entry.remote.key_version });
    await this.sync();
  }

  async deleteVault(vaultId: string) {
    await this.api.deleteVault(vaultId);
    await this.sync();
  }

  async leaveVault(vaultId: string) {
    await this.api.removeMember(vaultId, this.userId);
    await this.sync();
  }

  async addMember(vaultId: string, email: string, role: Role): Promise<AddResult> {
    const entry = this.requireEntry(vaultId);
    let user: { user_id: string; public_key: string } | null = null;
    try {
      user = await this.api.lookupUser(email);
    } catch (e) {
      if (!(e instanceof ApiError && e.status === 404)) throw e;
    }
    if (!user) {
      const invite = await this.api.createInvite(vaultId, email, role);
      return { kind: 'invited', token: invite.token, expiresInDays: invite.expires_in_days };
    }
    const sealed = await this.crypto('sealFor', { vaultId, publicKey: user.public_key, userId: user.user_id });
    await this.api.addMember(vaultId, {
      user_id: user.user_id,
      role,
      encrypted_vault_key: sealed,
      key_version: entry.remote.key_version,
    });
    await this.sync();
    return { kind: 'added' };
  }

  async changeRole(vaultId: string, userId: string, role: Role) {
    await this.api.changeRole(vaultId, userId, role);
    await this.sync();
  }

  async removeMember(vaultId: string, userId: string) {
    await this.sync();
    const member = this.requireEntry(vaultId).remote.members.find((m) => m.user_id === userId);
    if (member?.has_key) {
      await this.rotate(vaultId, [userId]);
    } else {
      try {
        await this.api.removeMember(vaultId, userId);
      } catch (e) {
        if (!(e instanceof ApiError && e.code === 'rotation_required')) throw e;
        await this.rotate(vaultId, [userId]);
      }
    }
    await this.sync();
  }

  invites(vaultId: string): Promise<{ invites: InviteInfo[] }> {
    return this.api.listInvites(vaultId);
  }

  async revokeInvite(vaultId: string, inviteId: string) {
    await this.api.deleteInvite(vaultId, inviteId);
  }
}
