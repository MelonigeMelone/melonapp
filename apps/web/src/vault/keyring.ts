export const KEYRING_PURPOSE = 'vault-keys';

export interface KnownKey {
  version: number;
  keyId: string;
  granters: Record<string, string>;
}

export interface Keyring {
  counter: number;
  vaults: Record<string, KnownKey>;
}

export function emptyKeyring(): Keyring {
  return { counter: 0, vaults: Object.create(null) as Record<string, KnownKey> };
}

function parseGranters(value: unknown): Record<string, string> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const out = Object.create(null) as Record<string, string>;
  for (const [userId, key] of Object.entries(value as Record<string, unknown>)) {
    if (typeof key === 'string' && key) out[userId] = key;
  }
  return out;
}

export function parseKeyring(json: string): Keyring | null {
  let o: unknown;
  try {
    o = JSON.parse(json);
  } catch {
    return null;
  }
  if (!o || typeof o !== 'object') return null;
  const { counter, vaults } = o as Record<string, unknown>;
  if (!Number.isSafeInteger(counter) || (counter as number) < 1 || !vaults || typeof vaults !== 'object' || Array.isArray(vaults)) return null;
  const out = emptyKeyring();
  out.counter = counter as number;
  for (const [vaultId, v] of Object.entries(vaults as Record<string, unknown>)) {
    if (!v || typeof v !== 'object') continue;
    const { version, keyId, granters } = v as Record<string, unknown>;
    const parsed = parseGranters(granters);
    if (Number.isSafeInteger(version) && (version as number) >= 1 && typeof keyId === 'string' && keyId && parsed) {
      out.vaults[vaultId] = { version: version as number, keyId, granters: parsed };
    }
  }
  return out;
}

export function sameGranters(a: Record<string, string>, b: Record<string, string>): boolean {
  const ak = Object.keys(a);
  return ak.length === Object.keys(b).length && ak.every((k) => b[k] === a[k]);
}
