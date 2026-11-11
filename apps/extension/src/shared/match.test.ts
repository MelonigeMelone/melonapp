import { describe, expect, it } from 'vitest';
import { generatePassword } from './generator';
import { anyUrlMatches, hostOf, urlMatches } from './match';

describe('url matching', () => {
  it('normalizes hosts', () => {
    expect(hostOf('https://www.GitHub.com/login')).toBe('github.com');
    expect(hostOf('github.com')).toBe('github.com');
    expect(hostOf('javascript:alert(1)')).toBeNull();
    expect(hostOf('')).toBeNull();
  });

  it('matches the same site and its subdomains', () => {
    expect(urlMatches('https://github.com/session', 'https://github.com')).toBe(true);
    expect(urlMatches('https://www.github.com/', 'github.com')).toBe(true);
    expect(urlMatches('https://gist.github.com/', 'https://github.com')).toBe(true);
  });

  it('never matches look-alike or parent domains', () => {
    expect(urlMatches('https://github.com.evil.example/', 'https://github.com')).toBe(false);
    expect(urlMatches('https://evilgithub.com/', 'https://github.com')).toBe(false);
    expect(urlMatches('https://github.com/', 'https://gist.github.com')).toBe(false);
    expect(urlMatches('https://example.com/?next=github.com', 'https://github.com')).toBe(false);
  });

  it('does not fill https logins into plain http pages', () => {
    expect(urlMatches('http://bank.example/', 'https://bank.example')).toBe(false);
    expect(urlMatches('http://router.local/', 'http://router.local')).toBe(true);
    expect(urlMatches('http://localhost:8080/', 'localhost')).toBe(true);
  });

  it('checks every url of an item', () => {
    expect(anyUrlMatches('https://webmail.de/', ['https://mail.de', 'https://webmail.de'])).toBe(true);
    expect(anyUrlMatches('https://other.de/', [])).toBe(false);
  });
});

describe('generator', () => {
  it('creates 20 characters with every class and no repeats across calls', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 100; i++) {
      const pw = generatePassword();
      expect(pw).toHaveLength(20);
      expect(pw).toMatch(/[a-z]/);
      expect(pw).toMatch(/[A-Z]/);
      expect(pw).toMatch(/[0-9]/);
      expect(pw).toMatch(/[^a-zA-Z0-9]/);
      seen.add(pw);
    }
    expect(seen.size).toBe(100);
  });
});
