import { describe, expect, it } from 'vitest';
import { storedLog } from './seen';

function storage(initial: Record<string, string> = {}): Storage {
  const data = new Map(Object.entries(initial));
  return {
    get length() {
      return data.size;
    },
    clear: () => data.clear(),
    getItem: (k) => data.get(k) ?? null,
    key: (i) => [...data.keys()][i] ?? null,
    removeItem: (k) => void data.delete(k),
    setItem: (k, v) => void data.set(k, v),
  };
}

describe('storedLog', () => {
  it('persists the highest sequence per user and never lowers it', () => {
    const store = storage();
    const a = storedLog('u1', store);
    a.raise('v/i', 3);
    a.raise('v/i', 2);
    expect(storedLog('u1', store).get('v/i')).toBe(3);
    expect(storedLog('u2', store).get('v/i')).toBe(0);
  });

  it('does not lose marks written by another tab', () => {
    const store = storage();
    const tabA = storedLog('u', store);
    const tabB = storedLog('u', store);
    tabB.raise('x', 7);
    tabA.raise('y', 2);
    const later = storedLog('u', store);
    expect([later.get('x'), later.get('y')]).toEqual([7, 2]);
  });

  it('ignores damaged or invalid stored values', () => {
    expect(storedLog('u', storage({ 'melon.seen.u': 'not json' })).get('x')).toBe(0);
    const odd = storedLog('u', storage({ 'melon.seen.u': '{"a":-1,"b":"7","c":4}' }));
    expect([odd.get('a'), odd.get('b'), odd.get('c')]).toEqual([0, 0, 4]);
  });
});
