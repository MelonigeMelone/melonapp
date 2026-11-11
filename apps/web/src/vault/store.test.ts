import { describe, expect, it } from 'vitest';
import { ApiError, type PutBody, type RemoteItem, type SyncPage } from '../api';
import { emptyEntry, type PasswordEntry } from './entry';
import { VaultStore, type CryptoPort, type RemotePort } from './store';

class FakeServer {
  rows = new Map<string, RemoteItem>();
  private seq = 0;

  port(): RemotePort {
    return {
      list: async (since): Promise<SyncPage> => {
        const items = [...this.rows.values()]
          .filter((r) => r.revision > since)
          .sort((a, b) => a.revision - b.revision);
        return { items, latest_revision: items.at(-1)?.revision ?? since, has_more: false };
      },
      put: async (id, body: PutBody) => {
        const row = this.rows.get(id);
        const ok = body.base_revision === null ? !row : row?.revision === body.base_revision;
        if (!ok) throw new ApiError(409, 'revision_mismatch');
        const revision = ++this.seq;
        this.rows.set(id, { id, module: body.module, data: body.data, revision, deleted: false });
        return { revision };
      },
      remove: async (id, base) => {
        const row = this.rows.get(id);
        if (!row || row.deleted || row.revision !== base) throw new ApiError(409, 'revision_mismatch');
        const revision = ++this.seq;
        this.rows.set(id, { ...row, data: null, deleted: true, revision });
        return { revision };
      },
    };
  }
}

const fakeCrypto: CryptoPort = {
  encrypt: async (module, id, plaintext) => `${module}|${id}|${plaintext}`,
  decryptMany: async (module, items) =>
    items.map(({ id, data }) => {
      const prefix = `${module}|${id}|`;
      return data.startsWith(prefix)
        ? { id, plaintext: data.slice(prefix.length) }
        : { id, error: 'decryption failed' };
    }),
};

const entry = (over: Partial<PasswordEntry>): PasswordEntry => ({ ...emptyEntry(), ...over });

function device(server: FakeServer, ids: string[] = []) {
  let n = 0;
  return new VaultStore(fakeCrypto, server.port(), () => ids[n++] ?? `id-${Math.random()}`);
}

describe('VaultStore', () => {
  it('creates, updates and syncs to another device', async () => {
    const server = new FakeServer();
    const a = device(server, ['one']);
    const b = device(server);

    const id = await a.save(null, entry({ title: 'GitHub', password: 'first' }));
    await a.save(id, entry({ title: 'GitHub', password: 'second' }));
    await b.sync();

    const seen = b.get(id);
    expect(seen?.entry.password).toBe('second');
    expect(seen?.entry.history.map((h) => h.password)).toEqual(['first']);
  });

  it('resolves a conflicting edit without losing the other password', async () => {
    const server = new FakeServer();
    const a = device(server, ['x']);
    const b = device(server);
    const id = await a.save(null, entry({ title: 'Bank', password: 'base' }));
    await b.sync();

    await a.save(id, entry({ title: 'Bank', password: 'from-a' }));
    await b.save(id, entry({ title: 'Bank', password: 'from-b' }));
    await a.sync();

    const result = a.get(id)?.entry;
    expect(result?.password).toBe('from-b');
    expect(result?.history.map((h) => h.password)).toContain('from-a');
    expect(result?.history.map((h) => h.password)).toContain('base');
  });

  it('propagates deletions and can recreate an item deleted elsewhere', async () => {
    const server = new FakeServer();
    const a = device(server, ['gone']);
    const b = device(server);
    const id = await a.save(null, entry({ title: 'Old' }));
    await b.sync();

    await a.remove(id);
    await b.save(id, entry({ title: 'Still needed' }));
    await a.sync();

    expect(a.get(id)?.entry.title).toBe('Still needed');
  });

  it('skips items it cannot decrypt instead of failing the sync', async () => {
    const server = new FakeServer();
    server.rows.set('bad', { id: 'bad', module: 'passwords', data: 'garbage', revision: 1, deleted: false });
    server.rows.set('other', { id: 'other', module: 'notes', data: 'x', revision: 2, deleted: false });
    const a = device(server);
    await a.sync();
    expect(a.getSnapshot()).toEqual([]);
    expect(a.unreadableCount).toBe(1);
  });
});
