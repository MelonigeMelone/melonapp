import { beforeEach, describe, expect, it, vi } from 'vitest';

const calls = vi.hoisted(() => ({ crypto: [] as string[], logout: [] as string[], logins: [] as string[], registered: [] as string[], serverKey: 'OWN-KEY', kdf: null as null | { memory_kib: number; iterations: number; parallelism: number } }));

vi.mock('./crypto/client', () => ({
  cryptoCall: vi.fn(async (method: string) => {
    calls.crypto.push(method);
    if (method === 'derive') return `auth-key-${calls.crypto.filter((m) => m === 'derive').length}`;
    if (method === 'unlock') return 'OWN-KEY';
    if (method === 'generateSalt') return 'salt';
    if (method === 'createAccount') return { wrappedAccountKey: 'wrapped', publicKey: 'OWN-KEY', encryptedPrivateKey: 'private', personalVault: { encryptedMeta: 'meta', encryptedVaultKey: 'key' } };
    return undefined;
  }),
}));

vi.mock('./device', () => ({ deviceName: () => 'test' }));

vi.mock('./api', async (importOriginal) => {
  const original = await importOriginal<typeof import('./api')>();
  return {
    ...original,
    api: {
      prelogin: async () => ({ kdf: calls.kdf ?? original.DEFAULT_KDF, salt: 'salt' }),
      register: async (body: { auth_key: string }) => {
        calls.registered.push(body.auth_key);
      },
      login: async (body: { auth_key: string }) => (calls.logins.push(body.auth_key), {
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

const { login, register, lock, describeError } = await import('./session');
const { ApiError } = await import('./api');
const { setNativePlatform } = await import('./platform');
type Native = Parameters<typeof setNativePlatform>[0];

describe('login', () => {
  beforeEach(() => {
    calls.crypto = [];
    calls.logout = [];
    calls.logins = [];
    calls.registered = [];
    calls.kdf = null;
  });

  it('logs in after registering with a fresh proof, because native proof handles work only once', async () => {
    calls.serverKey = 'OWN-KEY';
    const session = await register('me@example.test', 'pw', null);
    expect(session.publicKey).toBe('OWN-KEY');
    expect(calls.registered).toEqual(['auth-key-1']);
    expect(calls.logins).toEqual(['auth-key-2']);
  });

  it('refuses weaker key derivation than the apps use before deriving or sending anything', async () => {
    for (const kdf of [
      { memory_kib: 19456, iterations: 2, parallelism: 1 },
      { memory_kib: 65536, iterations: 2, parallelism: 4 },
      { memory_kib: 32768, iterations: 3, parallelism: 4 },
      { memory_kib: 2 ** 32 + 19456, iterations: 2 ** 32 + 2, parallelism: 1 },
      { memory_kib: 65536.5, iterations: 3, parallelism: 4 },
      { memory_kib: 65536, iterations: 3, parallelism: 0 },
    ]) {
      calls.kdf = kdf;
      const error = await login('me@example.test', 'pw').catch((e: unknown) => e);
      expect((error as InstanceType<typeof ApiError>).code).toBe('weak_kdf');
    }
    expect(calls.crypto).not.toContain('derive');
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

describe('lock', () => {
  const session = { token: 'token' } as Parameters<typeof lock>[0];

  function native(keepsToken: boolean) {
    const signedOut = vi.fn().mockResolvedValue(undefined);
    setNativePlatform({ biometricKeepsToken: vi.fn().mockResolvedValue(keepsToken), signedOut } as unknown as Native);
    return signedOut;
  }

  beforeEach(() => {
    calls.logout = [];
  });

  it('signing out removes the AutoFill data of this device', async () => {
    const signedOut = native(false);
    await lock(session);
    expect(calls.logout).toEqual(['token']);
    expect(signedOut).toHaveBeenCalledOnce();
  });

  it('locking with biometrics keeps the session and the AutoFill data', async () => {
    const signedOut = native(true);
    await lock(session);
    expect(calls.logout).toEqual([]);
    expect(signedOut).not.toHaveBeenCalled();
  });
});
