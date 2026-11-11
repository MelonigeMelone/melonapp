import { describe, expect, it } from 'vitest';
import { ApiError, type ItemPage, type PutBody, type RemoteItem } from '../api';
import { emptyItem, fieldValue, type Item } from './item';
import { VaultStore, type ItemCrypto, type ItemRemote } from './store';

class FakeServer {
  rows = new Map<string, RemoteItem>();
  keyVersion = 1;
  private seq = 0;

  port(): ItemRemote {
    return {
      list: async (since): Promise<ItemPage> => {
        const items = [...this.rows.values()].filter((r) => r.revision > since).sort((a, b) => a.revision - b.revision);
        return { items, latest_revision: items.at(-1)?.revision ?? since, has_more: false };
      },
      put: async (id, body: PutBody) => {
        if (body.key_version !== this.keyVersion) throw new ApiError(409, 'key_rotated');
        const row = this.rows.get(id);
        const ok = body.base_revision === null ? !row : row?.revision === body.base_revision;
        if (!ok) throw new ApiError(409, 'revision_mismatch');
        const revision = ++this.seq;
        this.rows.set(id, { id, data: body.data, key_version: body.key_version, revision, deleted: false });
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

const fakeCrypto: ItemCrypto = {
  encrypt: async (id, plaintext) => `${id}|${plaintext}`,
  decrypt: async (items) =>
    items.map(({ id, data }) =>
      data.startsWith(`${id}|`) ? { id, plaintext: data.slice(id.length + 1) } : { id, error: 'decryption failed' },
    ),
};

function login(title: string, password: string): Item {
  const item = emptyItem('login');
  item.title = title;
  item.fields = item.fields.map((f) => (f.id === 'password' ? { ...f, value: password } : f));
  return item;
}

function device(server: FakeServer, ids: string[] = []) {
  let n = 0;
  return new VaultStore('vault', fakeCrypto, server.port(), () => 1, undefined, () => ids[n++] ?? `id-${Math.random()}`);
}

describe('VaultStore', () => {
  it('creates, updates and syncs to another device', async () => {
    const server = new FakeServer();
    const a = device(server, ['one']);
    const b = device(server);
    const id = await a.save(null, login('GitHub', 'first'));
    await a.save(id, login('GitHub', 'second'));
    await b.sync();
    const seen = b.get(id);
    expect(fieldValue(seen!.item, 'password')).toBe('second');
    expect(seen?.item.history.map((h) => h.value)).toEqual(['first']);
    expect(seen?.vaultId).toBe('vault');
  });

  it('resolves a conflicting edit without losing the other password', async () => {
    const server = new FakeServer();
    const a = device(server, ['x']);
    const b = device(server);
    const id = await a.save(null, login('Bank', 'base'));
    await b.sync();
    await a.save(id, login('Bank', 'from-a'));
    await b.save(id, { ...b.get(id)!.item, fields: login('Bank', 'from-b').fields });
    await a.sync();
    const result = a.get(id)!.item;
    expect(fieldValue(result, 'password')).toBe('from-b');
    expect(result.history.map((h) => h.value)).toEqual(expect.arrayContaining(['from-a', 'base']));
  });

  it('propagates deletions and can recreate an item deleted elsewhere', async () => {
    const server = new FakeServer();
    const a = device(server, ['gone']);
    const b = device(server);
    const id = await a.save(null, login('Old', ''));
    await b.sync();
    await a.remove(id);
    await b.save(id, login('Still needed', ''));
    await a.sync();
    expect(a.get(id)?.item.title).toBe('Still needed');
  });

  it('does not retry writes made with an outdated vault key', async () => {
    const server = new FakeServer();
    const a = device(server, ['k']);
    await a.save(null, login('A', ''));
    server.keyVersion = 2;
    await expect(a.save('k', login('B', ''))).rejects.toMatchObject({ code: 'key_rotated' });
  });

  it('skips items it cannot decrypt and starts over after reset', async () => {
    const server = new FakeServer();
    server.rows.set('bad', { id: 'bad', data: 'garbage', key_version: 1, revision: 1, deleted: false });
    const a = device(server);
    await a.sync();
    expect(a.list()).toEqual([]);
    expect(a.unreadableCount).toBe(1);
    server.rows.set('bad', { id: 'bad', data: 'bad|{"title":"Repariert"}', key_version: 1, revision: 1, deleted: false });
    a.reset();
    await a.sync();
    expect(a.get('bad')?.item.title).toBe('Repariert');
    expect(a.unreadableCount).toBe(0);
  });
});
