import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NEVER_KEY } from './messages';
import { addNever, neverHosts, onNeverChange, removeNever } from './never';

let store: Record<string, unknown> = {};
const listeners = new Set<(changes: Record<string, unknown>, area: string) => void>();

beforeEach(() => {
  store = {};
  listeners.clear();
  vi.stubGlobal('chrome', {
    storage: {
      local: {
        get: async (key: string) => (key in store ? { [key]: store[key] } : {}),
        set: async (items: Record<string, unknown>) => {
          Object.assign(store, items);
          for (const l of listeners) l(Object.fromEntries(Object.keys(items).map((k) => [k, { newValue: items[k] }])), 'local');
        },
      },
      onChanged: {
        addListener: (l: (changes: Record<string, unknown>, area: string) => void) => listeners.add(l),
        removeListener: (l: (changes: Record<string, unknown>, area: string) => void) => listeners.delete(l),
      },
    },
  });
});

describe('never-save list', () => {
  it('adds each site once and removes only the chosen one', async () => {
    await addNever('a.example');
    await addNever('b.example');
    await addNever('a.example');
    expect(await neverHosts()).toEqual(['a.example', 'b.example']);
    await removeNever('a.example');
    expect(await neverHosts()).toEqual(['b.example']);
    await removeNever('unknown.example');
    expect(await neverHosts()).toEqual(['b.example']);
  });

  it('ignores a damaged stored value', async () => {
    store[NEVER_KEY] = 'a.example';
    expect(await neverHosts()).toEqual([]);
    store[NEVER_KEY] = ['a.example', 3, null];
    expect(await neverHosts()).toEqual(['a.example']);
  });

  it('tells listeners about changes until they unsubscribe', async () => {
    const seen: string[][] = [];
    const stop = onNeverChange((h) => seen.push(h));
    await addNever('a.example');
    await vi.waitFor(() => expect(seen).toEqual([['a.example']]));
    stop();
    await addNever('b.example');
    await new Promise((r) => setTimeout(r, 10));
    expect(seen).toEqual([['a.example']]);
  });
});
