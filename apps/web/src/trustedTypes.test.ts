import { describe, expect, it, vi } from 'vitest';
import { installDefaultPolicy, sameOriginScriptUrl } from './trustedTypes';

const base = 'https://vault.example.com/#/items';

describe('trusted types default policy', () => {
  it('lets the bundled worker through', () => {
    expect(sameOriginScriptUrl('https://vault.example.com/assets/worker-abc.js', base)).toBe('https://vault.example.com/assets/worker-abc.js');
    expect(sameOriginScriptUrl('/assets/worker-abc.js', base)).toBe('https://vault.example.com/assets/worker-abc.js');
  });

  it('refuses scripts from anywhere else', () => {
    for (const url of [
      'https://evil.example/x.js',
      '//evil.example/x.js',
      'http://vault.example.com/assets/x.js',
      'https://vault.example.com:8443/x.js',
      'data:text/javascript,alert(1)',
      'blob:https://vault.example.com/0b6e',
      'javascript:alert(1)',
    ]) {
      expect(() => sameOriginScriptUrl(url, base), url).toThrow(TypeError);
    }
  });

  it('registers only a script URL rule, so HTML and script strings stay blocked', () => {
    const createPolicy = vi.fn();
    installDefaultPolicy({ createPolicy }, base);
    expect(createPolicy).toHaveBeenCalledTimes(1);
    const [name, rules] = createPolicy.mock.calls[0] ?? [];
    expect(name).toBe('default');
    expect(Object.keys(rules)).toEqual(['createScriptURL']);
  });

  it('does nothing without trusted types', () => {
    expect(() => installDefaultPolicy(undefined, base)).not.toThrow();
  });
});
