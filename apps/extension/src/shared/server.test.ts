import { describe, expect, it } from 'vitest';
import { InsecureServerError, normalizeServer } from './server';

describe('server address', () => {
  it('adds https and trims', () => {
    expect(normalizeServer(' melon.example.com/ ')).toBe('https://melon.example.com');
    expect(normalizeServer('https://melon.example.com')).toBe('https://melon.example.com');
  });

  it('refuses plain http except on this computer', () => {
    expect(() => normalizeServer('http://melon.example.com')).toThrow(InsecureServerError);
    expect(() => normalizeServer('http://192.168.1.5:8080')).toThrow(InsecureServerError);
    expect(normalizeServer('http://localhost:8080')).toBe('http://localhost:8080');
    expect(normalizeServer('http://127.0.0.1:8080')).toBe('http://127.0.0.1:8080');
  });
});
