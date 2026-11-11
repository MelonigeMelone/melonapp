import { ApiError, type PutBody, type SyncPage } from '../api';
import type { Decrypted } from '../crypto/protocol';
import {
  MODULE,
  newItemId,
  parseEntry,
  resolveConflict,
  withHistory,
  type PasswordEntry,
  type VaultItem,
} from './entry';

export interface CryptoPort {
  encrypt(module: string, id: string, plaintext: string): Promise<string>;
  decryptMany(module: string, items: { id: string; data: string }[]): Promise<Decrypted[]>;
}

export interface RemotePort {
  list(since: number): Promise<SyncPage>;
  put(id: string, body: PutBody): Promise<{ revision: number }>;
  remove(id: string, baseRevision: number): Promise<{ revision: number }>;
}

const isConflict = (e: unknown) => e instanceof ApiError && e.status === 409;

const byTitle = (a: VaultItem, b: VaultItem) =>
  a.entry.title.localeCompare(b.entry.title, 'de', { sensitivity: 'base' });

export class VaultStore {
  private items = new Map<string, VaultItem>();
  private tombstones = new Map<string, number>();
  private unreadable = new Set<string>();
  private since = 0;
  private listeners = new Set<() => void>();
  private snapshot: VaultItem[] = [];
  private running: Promise<void> | null = null;

  constructor(
    private readonly crypto: CryptoPort,
    private readonly remote: RemotePort,
    private readonly newId: () => string = newItemId,
  ) {}

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getSnapshot = () => this.snapshot;

  get unreadableCount() {
    return this.unreadable.size;
  }

  get(id: string): VaultItem | undefined {
    return this.items.get(id);
  }

  private emit() {
    this.snapshot = [...this.items.values()].sort(byTitle);
    for (const l of this.listeners) l();
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
      const ours = page.items.filter((i) => i.module === MODULE);
      const live = ours.filter((i) => !i.deleted && i.data !== null);
      const decrypted = await this.crypto.decryptMany(
        MODULE,
        live.map((i) => ({ id: i.id, data: i.data as string })),
      );
      const byId = new Map(decrypted.map((d) => [d.id, d]));
      for (const r of ours) {
        this.unreadable.delete(r.id);
        if (r.deleted) {
          this.items.delete(r.id);
          this.tombstones.set(r.id, r.revision);
          continue;
        }
        const d = byId.get(r.id);
        if (!d || 'error' in d) {
          this.unreadable.add(r.id);
          continue;
        }
        this.tombstones.delete(r.id);
        this.items.set(r.id, { id: r.id, revision: r.revision, entry: parseEntry(d.plaintext) });
      }
      this.since = page.latest_revision;
      more = page.has_more;
    }
    this.emit();
  }

  private baseRevision(id: string): number | null {
    return this.items.get(id)?.revision ?? this.tombstones.get(id) ?? null;
  }

  private async write(id: string, entry: PasswordEntry) {
    const data = await this.crypto.encrypt(MODULE, id, JSON.stringify(entry));
    const { revision } = await this.remote.put(id, {
      module: MODULE,
      data,
      base_revision: this.baseRevision(id),
    });
    this.items.set(id, { id, revision, entry });
    this.tombstones.delete(id);
    this.emit();
  }

  async save(id: string | null, edited: PasswordEntry): Promise<string> {
    const itemId = id ?? this.newId();
    try {
      await this.write(itemId, withHistory(this.items.get(itemId)?.entry, edited));
    } catch (e) {
      if (!isConflict(e)) throw e;
      await this.sync();
      const current = this.items.get(itemId);
      await this.write(itemId, current ? resolveConflict(current.entry, edited) : edited);
    }
    return itemId;
  }

  async remove(id: string): Promise<void> {
    const attempt = async () => {
      const current = this.items.get(id);
      if (!current) return;
      const { revision } = await this.remote.remove(id, current.revision);
      this.items.delete(id);
      this.tombstones.set(id, revision);
      this.emit();
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
