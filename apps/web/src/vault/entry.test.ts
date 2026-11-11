import { describe, expect, it } from 'vitest';
import {
  charClass,
  emptyEntry,
  matchesSearch,
  newItemId,
  normalizeUrl,
  parseEntry,
  resolveConflict,
  safeHref,
  withHistory,
} from './entry';

const now = new Date('2026-11-11T12:00:00Z');

describe('entry', () => {
  it('records the previous password once', () => {
    const before = { ...emptyEntry(), password: 'old' };
    const after = withHistory(before, { ...before, password: 'new' }, now);
    expect(after.history).toEqual([{ password: 'old', changedAt: now.toISOString() }]);
    expect(withHistory(after, after, now).history).toHaveLength(1);
  });

  it('never keeps the current password in the history and caps it', () => {
    let e = { ...emptyEntry(), password: 'p0' };
    for (let i = 1; i <= 15; i++) e = withHistory(e, { ...e, password: `p${i}` }, now);
    expect(e.history).toHaveLength(10);
    expect(e.history.map((h) => h.password)).not.toContain('p15');
    expect(withHistory(e, { ...e, password: 'p14' }, now).history.map((h) => h.password)).not.toContain('p14');
  });

  it('keeps the losing side of a conflict in the history', () => {
    const remote = { ...emptyEntry(), password: 'remote' };
    const local = { ...emptyEntry(), password: 'local', notes: 'mine' };
    const merged = resolveConflict(remote, local, now);
    expect(merged.password).toBe('local');
    expect(merged.notes).toBe('mine');
    expect(merged.history[0]?.password).toBe('remote');
  });

  it('parses unknown or broken fields defensively', () => {
    const e = parseEntry('{"title":"A","urls":["x",3],"history":[{"password":"h"},null],"extra":1}');
    expect(e.title).toBe('A');
    expect(e.urls).toEqual(['x']);
    expect(e.history).toEqual([{ password: 'h', changedAt: '' }]);
  });

  it('searches title, username and urls', () => {
    const e = { ...emptyEntry(), title: 'Sparkasse', username: 'melone', urls: ['https://bank.de'] };
    expect(matchesSearch(e, 'SPARK')).toBe(true);
    expect(matchesSearch(e, 'melo')).toBe(true);
    expect(matchesSearch(e, 'bank.de')).toBe(true);
    expect(matchesSearch(e, 'github')).toBe(false);
  });

  it('only links http and https urls', () => {
    expect(normalizeUrl('github.com')).toBe('https://github.com');
    expect(safeHref('https://github.com')).toBe('https://github.com/');
    expect(safeHref('javascript:alert(1)')).toBeNull();
    expect(safeHref('data:text/html,x')).toBeNull();
  });

  it('creates random version 4 uuids', () => {
    const ids = new Set(Array.from({ length: 50 }, newItemId));
    expect(ids.size).toBe(50);
    for (const id of ids) expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it('classifies characters for the password display', () => {
    expect([...'aZ7%'].map(charClass)).toEqual(['lower', 'upper', 'digit', 'symbol']);
  });
});
