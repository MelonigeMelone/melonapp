import { ApiError, type ItemPage, type PutBody } from '../api';
import type { Decrypted } from '../crypto/protocol';
import { newId, parseItem, resolveConflict, withHistory, type Item, type VaultItem } from './item';
import { memoryLog, type SeenLog } from './seen';

export interface ItemCrypto {
  encrypt(itemId: string, plaintext: string): Promise<string>;
  decrypt(items: { id: string; keyVersion: number; data: string }[]): Promise<Decrypted[]>;
}

export interface ItemRemote {
  list(since: number): Promise<ItemPage>;
  put(itemId: string, body: PutBody): Promise<{ revision: number }>;
  remove(itemId: string, baseRevision: number): Promise<{ revision: number }>;
}

export const isConflict = (e: unknown) => e instanceof ApiError && e.status === 409;

export class VaultStore {
  private items = new Map<string, VaultItem>();
  private tombstones = new Map<string, number>();
  private unreadable = new Set<string>();
  private rolledBack = new Set<string>();
  private stale = new Map<string, VaultItem>();
  private since = 0;
  private running: Promise<void> | null = null;

  constructor(
    readonly vaultId: string,
    private readonly crypto: ItemCrypto,
    private readonly remote: ItemRemote,
    private readonly keyVersion: () => number,
    private readonly onChange: () => void = () => undefined,
    private readonly makeId: () => string = newId,
    private readonly seen: SeenLog = memoryLog(),
  ) {}

  get unreadableCount() {
    return this.unreadable.size;
  }

  get rolledBackCount() {
    return this.rolledBack.size;
  }

  private key(id: string) {
    return `${this.vaultId}/${id}`;
  }

  list(): VaultItem[] {
    return [...this.items.values()];
  }

  get(id: string): VaultItem | undefined {
    return this.items.get(id);
  }

  rotationItems(): { id: string; plaintext: string; revision: number }[] {
    const current = new Map(this.stale);
    for (const [id, v] of this.items) current.set(id, v);
    return [...current.values()].map((v) => ({ id: v.id, plaintext: JSON.stringify(v.item), revision: v.revision }));
  }

  reset() {
    this.items.clear();
    this.tombstones.clear();
    this.unreadable.clear();
    this.rolledBack.clear();
    this.stale.clear();
    this.since = 0;
  }

  sync(): Promise<void> {
    this.running ??= this.pull().finally(() => {
      this.running = null;
    });
    return this.running;
  }

  private async pull() {
    let more = true;
    while (more) {
      const page = await this.remote.list(this.since);
      const live = page.items.filter((i) => !i.deleted && i.data !== null);
      const decrypted = await this.crypto.decrypt(
        live.map((i) => ({ id: i.id, keyVersion: i.key_version, data: i.data as string })),
      );
      const byId = new Map(decrypted.map((d) => [d.id, d]));
      for (const r of page.items) {
        this.unreadable.delete(r.id);
        if (r.deleted) {
          const last = this.items.get(r.id)?.item.seq;
          if (last !== undefined) this.seen.raise(this.key(r.id), last + 1);
          this.items.delete(r.id);
          this.rolledBack.delete(r.id);
          this.stale.delete(r.id);
          this.tombstones.set(r.id, r.revision);
          continue;
        }
        const d = byId.get(r.id);
        if (!d || 'error' in d) {
          this.unreadable.add(r.id);
          continue;
        }
        const item = parseItem(d.plaintext);
        if (item.seq < this.seen.get(this.key(r.id))) {
          this.rolledBack.add(r.id);
          this.stale.set(r.id, { vaultId: this.vaultId, id: r.id, revision: r.revision, item });
          const shown = this.items.get(r.id);
          if (shown) this.items.set(r.id, { ...shown, revision: r.revision });
          continue;
        }
        this.rolledBack.delete(r.id);
        this.stale.delete(r.id);
        this.seen.raise(this.key(r.id), item.seq);
        this.tombstones.delete(r.id);
        this.items.set(r.id, { vaultId: this.vaultId, id: r.id, revision: r.revision, item });
      }
      this.since = page.latest_revision;
      more = page.has_more;
    }
    this.onChange();
  }

  private baseRevision(id: string): number | null {
    return this.items.get(id)?.revision ?? this.stale.get(id)?.revision ?? this.tombstones.get(id) ?? null;
  }

  private async write(id: string, edited: Item) {
    const item = { ...edited, seq: Math.max(edited.seq, this.seen.get(this.key(id)) + 1) };
    const data = await this.crypto.encrypt(id, JSON.stringify(item));
    const { revision } = await this.remote.put(id, {
      data,
      key_version: this.keyVersion(),
      base_revision: this.baseRevision(id),
    });
    this.items.set(id, { vaultId: this.vaultId, id, revision, item });
    this.seen.raise(this.key(id), item.seq);
    this.rolledBack.delete(id);
    this.stale.delete(id);
    this.tombstones.delete(id);
    this.onChange();
  }

  async save(id: string | null, edited: Item): Promise<string> {
    const itemId = id ?? this.makeId();
    try {
      await this.write(itemId, withHistory(this.items.get(itemId)?.item, edited));
    } catch (e) {
      if (!isConflict(e) || (e as ApiError).code === 'key_rotated') throw e;
      await this.sync();
      const current = this.items.get(itemId);
      await this.write(itemId, current ? resolveConflict(current.item, edited) : edited);
    }
    return itemId;
  }

  async remove(id: string, still: (item: Item) => boolean = () => true): Promise<void> {
    const attempt = async () => {
      const current = this.items.get(id);
      if (!current || !still(current.item)) return;
      const { revision } = await this.remote.remove(id, current.revision);
      this.seen.raise(this.key(id), current.item.seq + 1);
      this.items.delete(id);
      this.tombstones.set(id, revision);
      this.onChange();
    };
    try {
      await attempt();
    } catch (e) {
      if (!isConflict(e)) throw e;
      await this.sync();
      await attempt();
    }
  }
}
