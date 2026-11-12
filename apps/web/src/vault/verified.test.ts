import { describe, expect, it } from 'vitest';
import { changeMarks, emptyMarks, metaName, parseMarks, parseMeta, verifyState } from './verified';

describe('verified security codes', () => {
  it('reads vault meta and its name', () => {
    expect(metaName(parseMeta('{"name":"Familie"}'))).toBe('Familie');
    expect(parseMeta('nope')).toEqual({});
    expect(parseMeta('[1,2]')).toEqual({});
    expect(metaName(parseMeta('{"name":3}'))).toBe('');
  });

  it('rejects malformed marks', () => {
    expect(parseMarks('nope')).toBeNull();
    expect(parseMarks('{"marks":{}}')).toBeNull();
    expect(parseMarks('{"counter":0,"marks":{}}')).toBeNull();
    expect(parseMarks('{"counter":1.5,"marks":{}}')).toBeNull();
    expect(parseMarks('{"counter":1,"marks":[]}')).toBeNull();
    const m = parseMarks('{"counter":2,"marks":{"a":{"publicKey":1,"at":"x"},"b":null,"c":{"publicKey":"","at":"x"},"d":{"publicKey":"K","at":"t"}}}');
    expect(m?.counter).toBe(2);
    expect(Object.keys(m?.marks ?? {})).toEqual(['d']);
  });

  it('is bound to the exact public key', () => {
    const { marks } = changeMarks(emptyMarks(), 'u1', { publicKey: 'KEY-A', at: 't' });
    expect(verifyState(marks, 'u1', 'KEY-A')).toBe('verified');
    expect(verifyState(marks, 'u1', 'KEY-B')).toBe('changed');
    expect(verifyState(marks, 'u2', 'KEY-A')).toBe('unverified');
  });

  it('counts every change and keeps the other marks', () => {
    let m = changeMarks(emptyMarks(), 'u1', { publicKey: 'A', at: 't' });
    m = changeMarks(m, 'u2', { publicKey: 'B', at: 't' });
    m = changeMarks(m, 'u1', null);
    expect(m.counter).toBe(3);
    expect(Object.keys(m.marks)).toEqual(['u2']);
    expect(parseMarks(JSON.stringify(m))?.marks.u2?.publicKey).toBe('B');
  });

  it('treats special user ids as plain keys', () => {
    const parsed = parseMarks('{"counter":1,"marks":{"__proto__":{"publicKey":"P","at":"t"},"constructor":{"publicKey":"C","at":"t"}}}');
    expect(parsed).not.toBeNull();
    const marks = parsed?.marks ?? {};
    expect(verifyState(marks, 'constructor', 'C')).toBe('verified');
    expect(verifyState(marks, 'toString', 'X')).toBe('unverified');
    expect(verifyState(emptyMarks().marks, 'constructor', 'C')).toBe('unverified');
    expect(({} as Record<string, unknown>).publicKey).toBeUndefined();
  });
});
