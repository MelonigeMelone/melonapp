import { beforeEach, describe, expect, it, vi } from 'vitest';

const calls = vi.hoisted(() => ({ crypto: [] as string[], logout: [] as string[], serverKey: 'OWN-KEY' }));

vi.mock('./crypto/client', () => ({
  cryptoCall: vi.fn(async (method: string) => {
    calls.crypto.push(method);
    if (method === 'derive') return 'auth-key';
    if (method === 'unlock') return 'OWN-KEY';
    return undefined;
  }),
}));

vi.mock('./device', () => ({ deviceName: () => 'test' }));

vi.mock('./api', async (importOriginal) => {
  const original = await importOriginal<typeof import('./api')>();
  return {
    ...original,
    api: {
      prelogin: async () => ({ kdf: original.DEFAULT_KDF, salt: 'salt' }),
      login: async () => ({
        user_id: 'me',
        token: 'token',
        wrapped_account_key: 'wrapped',
        encrypted_private_key: 'private',
        public_key: calls.serverKey,
        has_recovery: false,
      }),
      logout: async (token: string) => {
        calls.logout.push(token);
      },
    },
  };
});

const { login, describeError } = await import('./session');
const { ApiError } = await import('./api');

describe('login', () => {
  beforeEach(() => {
    calls.crypto = [];
    calls.logout = [];
  });

  it('keeps the public key that belongs to the decrypted private key', async () => {
    calls.serverKey = 'OWN-KEY';
    const session = await login('me@example.test', 'pw');
    expect(session.publicKey).toBe('OWN-KEY');
  });

  it('aborts when the server reports a different public key for the own account', async () => {
    calls.serverKey = 'ATTACKER-KEY';
    const error = await login('me@example.test', 'pw').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as InstanceType<typeof ApiError>).code).toBe('public_key_mismatch');
    expect(describeError(error)).toContain('falschen öffentlichen Schlüssel');
    expect(calls.crypto).toContain('lock');
    expect(calls.logout).toEqual(['token']);
  });
});
