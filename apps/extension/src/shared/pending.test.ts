import { describe, expect, it } from 'vitest';
import { PENDING_KEEP_MS } from './messages';
import { freshPending, newestPending } from './pending';

const save = (url: string, at: number) => ({ url, username: 'u', password: 'p', at });

describe('pending logins', () => {
  it('keeps one per site, drops old and malformed entries', () => {
    const now = 10 * PENDING_KEEP_MS;
    const all = freshPending(
      {
        'shop.example': save('https://shop.example/login', now - 1000),
        'evil.example': save('https://evil.example/', now),
        'old.example': save('https://old.example/', now - PENDING_KEEP_MS - 1),
        'broken.example': { url: 'x' },
      },
      now,
    );
    expect(Object.keys(all).sort()).toEqual(['evil.example', 'shop.example']);
    expect(all['shop.example']?.url).toBe('https://shop.example/login');
    expect(newestPending(all)?.url).toBe('https://evil.example/');
  });

  it('ignores the old single-entry format', () => {
    expect(freshPending(save('https://shop.example/', 1), 2)).toEqual({});
  });
});
