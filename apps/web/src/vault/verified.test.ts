import { describe, expect, it } from 'vitest';
import { metaName, parseMeta, verifiedOf, verifyState, withVerified } from './verified';

describe('verified security codes', () => {
  it('reads old meta with only a name', () => {
    const meta = parseMeta('{"name":"Familie"}');
    expect(metaName(meta)).toBe('Familie');
    expect(verifiedOf(meta)).toEqual({});
  });

  it('survives broken meta', () => {
    expect(parseMeta('nope')).toEqual({});
    expect(parseMeta('[1,2]')).toEqual({});
    expect(metaName(parseMeta('{"name":3}'))).toBe('');
    expect(verifiedOf({ verified: [1] })).toEqual({});
    expect(verifiedOf({ verified: { a: { publicKey: 1, at: 'x' }, b: null, c: { publicKey: '', at: 'x' } } })).toEqual({});
  });

  it('is bound to the exact public key', () => {
    const meta = withVerified({ name: 'Persönlich' }, 'u1', { publicKey: 'KEY-A', at: '2026-11-12T00:00:00Z' });
    const v = verifiedOf(meta);
    expect(verifyState(v, 'u1', 'KEY-A')).toBe('verified');
    expect(verifyState(v, 'u1', 'KEY-B')).toBe('changed');
    expect(verifyState(v, 'u2', 'KEY-A')).toBe('unverified');
  });

  it('keeps the name and other marks when adding or removing one', () => {
    let meta = withVerified({ name: 'Persönlich' }, 'u1', { publicKey: 'A', at: 't' });
    meta = withVerified(meta, 'u2', { publicKey: 'B', at: 't' });
    meta = withVerified(meta, 'u1', null);
    expect(metaName(meta)).toBe('Persönlich');
    expect(Object.keys(verifiedOf(meta))).toEqual(['u2']);
  });
});
