import { ApiError, type Api, type InviteInfo, type RemoteMember, type RemoteVault, type Role } from '../api';
import type { CryptoMethods } from '../crypto/protocol';
import { newId, type Item, type VaultItem } from './item';
import { storedLog, type SeenLog } from './seen';
import { isConflict, VaultStore } from './store';
import { expired, fromTrash, isTrashed, toTrash } from './trash';
import { changeMarks, emptyMarks, MARKS_PURPOSE, metaName, parseMarks, parseMeta, verifyState, type Marks, type Meta, type Verified } from './verified';

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
  rolledBack: number;
}

export interface Snapshot {
  vaults: VaultView[];
  items: VaultItem[];
  trash: VaultItem[];
  verified: Verified;
  verifiedReady: boolean;
}

export interface FoundUser {
  user_id: string;
  email: string;
  public_key: string;
  fingerprint: string;
}

interface Entry {
  remote: RemoteVault;
  meta: Meta;
  store: VaultStore | null;
}

const PERSONAL_NAME = 'Persönlich';
const MARKS_SEEN = '#verified';

export class VaultsManager {
  private vaults = new Map<string, Entry>();
  private listeners = new Set<() => void>();
  private snapshot: Snapshot = { vaults: [], items: [], trash: [], verified: {}, verifiedReady: false };
  private running: Promise<void> | null = null;
  private marks: Marks | null = null;
  private marksLoads = 0;

  constructor(
    readonly userId: string,
    private readonly api: Api,
    private readonly crypto: Call,
    private readonly seen: SeenLog = storedLog(userId),
    private readonly now: () => Date = () => new Date(),
    private readonly shareKeys = true,
  ) {}

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getSnapshot = () => this.snapshot;

  private emit = () => {
    const views: VaultView[] = [...this.vaults.values()].map(({ remote, meta, store }) => ({
      id: remote.id,
      name: remote.personal ? metaName(meta) || PERSONAL_NAME : metaName(meta) || 'Bereich',
      personal: remote.personal,
      role: remote.role,
      members: remote.members,
      waitingForKey: remote.encrypted_vault_key === null,
      canWrite: remote.encrypted_vault_key !== null && remote.role !== 'viewer',
      isOwner: remote.role === 'owner',
      itemCount: store?.list().filter((v) => !isTrashed(v.item)).length ?? 0,
      unreadable: store?.unreadableCount ?? 0,
      rolledBack: store?.rolledBackCount ?? 0,
    }));
    views.sort((a, b) => Number(b.personal) - Number(a.personal) || a.name.localeCompare(b.name, 'de'));
    const all = [...this.vaults.values()]
      .flatMap((e) => e.store?.list() ?? [])
      .sort((a, b) => a.item.title.localeCompare(b.item.title, 'de', { sensitivity: 'base' }));
    const items = all.filter((v) => !isTrashed(v.item));
    const trash = all
      .filter((v) => isTrashed(v.item))
      .sort((a, b) => (b.item.trashedAt ?? '').localeCompare(a.item.trashedAt ?? ''));
    this.snapshot = { vaults: views, items, trash, verified: this.marks?.marks ?? {}, verifiedReady: this.marks !== null };
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
    let failure: unknown;
    const seen = new Set(vaults.map((v) => v.id));
    for (const id of this.vaults.keys()) if (!seen.has(id)) this.vaults.delete(id);

    for (const remote of vaults) {
      const entry: Entry = this.vaults.get(remote.id) ?? { remote, meta: {}, store: null };
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
      entry.meta = parseMeta(await this.crypto('decryptMeta', { vaultId: remote.id, data: remote.encrypted_meta }));
      if (rotated) entry.store?.reset();
      entry.store ??= this.makeStore(remote.id);
      await entry.store.sync();
      if (remote.role !== 'viewer') await this.purge(entry.store);
    }
    this.marks = await this.loadMarks();
    this.marksLoads += 1;
    for (const entry of this.vaults.values()) {
      if (!this.shareKeys || !entry.store || entry.remote.role !== 'owner' || entry.remote.personal) continue;
      try {
        await this.ownerDuties(entry);
      } catch (e) {
        failure ??= e;
      }
    }
    this.emit();
    if (failure !== undefined) throw failure;
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
      undefined,
      this.seen,
    );
  }

  private async purge(store: VaultStore) {
    const isExpired = (item: Item) => expired([{ vaultId: store.vaultId, id: '', revision: 0, item }], this.now()).length > 0;
    for (const v of expired(store.list(), this.now())) {
      await store.remove(v.id, isExpired).catch(() => undefined);
    }
  }

  async trashItem(vaultId: string, id: string) {
    const store = this.store(vaultId);
    const current = store.get(id);
    if (!current) throw new ApiError(404, 'item_not_found');
    await store.save(id, toTrash(current.item, this.now()));
  }

  async restoreItem(vaultId: string, id: string) {
    const store = this.store(vaultId);
    const current = store.get(id);
    if (!current) throw new ApiError(404, 'item_not_found');
    await store.save(id, fromTrash(current.item));
  }

  async emptyTrash() {
    for (const v of this.snapshot.trash) {
      if (this.vault(v.vaultId)?.canWrite) await this.removeItem(v.vaultId, v.id, isTrashed);
    }
  }

  private async ownerDuties(entry: Entry) {
    const { remote } = entry;
    if (remote.rotation_needed) {
      await this.rotate(remote.id, []);
      return;
    }
    for (const m of remote.members.filter((m) => !m.has_key)) {
      this.requireTrusted(m.user_id, m.public_key);
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
    for (const m of keep) this.requireTrusted(m.user_id, m.public_key);
    const current = entry.store.rotationItems();
    const revisions = new Map(current.map((v) => [v.id, v.revision]));
    const rotated = await this.crypto('rotate', {
      vaultId,
      meta: JSON.stringify(entry.meta),
      members: keep.map((m) => ({ userId: m.user_id, publicKey: m.public_key })),
      items: current.map(({ id, plaintext }) => ({ id, plaintext })),
    });
    try {
      await this.api.rotate(vaultId, {
        key_version: entry.remote.key_version + 1,
        encrypted_meta: rotated.encryptedMeta,
        members: rotated.members,
        items: rotated.items.map((i) => ({ ...i, base_revision: revisions.get(i.id) ?? 0 })),
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

  async removeItem(vaultId: string, id: string, still?: (item: Item) => boolean) {
    await this.store(vaultId).remove(id, still);
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
    await this.writeMeta(vaultId, (meta) => ({ ...meta, name }));
  }

  private async writeMeta(vaultId: string, change: (meta: Meta) => Meta) {
    await this.sync().catch(() => undefined);
    const entry = this.requireEntry(vaultId);
    const meta = change(entry.meta);
    const encrypted = await this.crypto('encryptMeta', { vaultId, plaintext: JSON.stringify(meta) });
    await this.api.updateVault(vaultId, { encrypted_meta: encrypted, key_version: entry.remote.key_version });
    await this.sync();
  }

  private requireTrusted(userId: string, publicKey: string) {
    if (!this.marks) throw new ApiError(409, 'verifications_unavailable');
    if (verifyState(this.marks.marks, userId, publicKey) === 'changed') throw new ApiError(409, 'key_changed');
  }

  private personalEntry(): Entry | null {
    const candidates = [...this.vaults.values()].filter(
      (e) =>
        e.remote.personal &&
        e.remote.role === 'owner' &&
        e.store !== null &&
        e.remote.members.length === 1 &&
        e.remote.members[0]?.user_id === this.userId,
    );
    return candidates.length === 1 ? (candidates[0] ?? null) : null;
  }

  private async loadMarks(): Promise<Marks | null> {
    const personal = this.personalEntry();
    if (!personal) return null;
    const sealed = personal.meta.verified;
    const highest = this.seen.get(MARKS_SEEN);
    if (sealed === undefined) return highest === 0 ? emptyMarks() : null;
    if (typeof sealed !== 'string') return null;
    let marks: Marks | null;
    try {
      marks = parseMarks(await this.crypto('openPrivate', { userId: this.userId, purpose: MARKS_PURPOSE, data: sealed }));
    } catch {
      return null;
    }
    if (!marks || marks.counter < highest) return null;
    this.seen.raise(MARKS_SEEN, marks.counter);
    return marks;
  }

  private async freshPersonal(): Promise<Entry> {
    const before = this.marksLoads;
    await this.sync().catch(() => undefined);
    const personal = this.personalEntry();
    if (!personal || this.marksLoads === before) throw new ApiError(409, 'verifications_unavailable');
    return personal;
  }

  private async writeMarks(personal: Entry, marks: Marks) {
    const sealed = await this.crypto('sealPrivate', { userId: this.userId, purpose: MARKS_PURPOSE, plaintext: JSON.stringify(marks) });
    await this.writeMeta(personal.remote.id, (meta) => ({ ...meta, verified: sealed }));
  }

  async setVerified(userId: string, publicKey: string | null) {
    const personal = await this.freshPersonal();
    if (!this.marks) throw new ApiError(409, 'verifications_unavailable');
    const base = { ...this.marks, counter: Math.max(this.marks.counter, this.seen.get(MARKS_SEEN)) };
    await this.writeMarks(personal, changeMarks(base, userId, publicKey ? { publicKey, at: this.now().toISOString() } : null));
  }

  async adoptStoredMarks() {
    const personal = await this.freshPersonal();
    const sealed = personal.meta.verified;
    let stored: Marks | null = null;
    if (typeof sealed === 'string') {
      try {
        stored = parseMarks(await this.crypto('openPrivate', { userId: this.userId, purpose: MARKS_PURPOSE, data: sealed }));
      } catch {
        stored = null;
      }
    }
    const marks = stored ?? emptyMarks();
    await this.writeMarks(personal, { counter: Math.max(marks.counter, this.seen.get(MARKS_SEEN)) + 1, marks: marks.marks });
  }

  async deleteVault(vaultId: string) {
    await this.api.deleteVault(vaultId);
    await this.sync();
  }

  async leaveVault(vaultId: string) {
    await this.api.removeMember(vaultId, this.userId);
    await this.sync();
  }

  fingerprint(publicKey: string): Promise<string> {
    return this.crypto('fingerprint', { publicKey });
  }

  async findUser(email: string): Promise<FoundUser | null> {
    try {
      const user = await this.api.lookupUser(email);
      return { ...user, fingerprint: await this.fingerprint(user.public_key) };
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) return null;
      throw e;
    }
  }

  async addKnownMember(vaultId: string, user: FoundUser, role: Role) {
    const entry = this.requireEntry(vaultId);
    this.requireTrusted(user.user_id, user.public_key);
    const sealed = await this.crypto('sealFor', { vaultId, publicKey: user.public_key, userId: user.user_id });
    await this.api.addMember(vaultId, {
      user_id: user.user_id,
      role,
      encrypted_vault_key: sealed,
      key_version: entry.remote.key_version,
    });
    await this.sync();
  }

  async invite(vaultId: string, email: string, role: Role): Promise<{ token: string; expiresInDays: number }> {
    const invite = await this.api.createInvite(vaultId, email, role);
    return { token: invite.token, expiresInDays: invite.expires_in_days };
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
