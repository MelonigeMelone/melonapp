import init, {
  AccountKey,
  deriveKeys,
  generatePassword,
  generateSalt,
  Identity,
  sealVaultKey,
  VaultKey,
  type DerivedKeys,
} from '@melon/wasm';
import type { CryptoMethods, CryptoRequest, CryptoResponse } from './protocol';

let derived: DerivedKeys | null = null;
let identity: Identity | null = null;
const vaults = new Map<string, { key: VaultKey; version: number }>();
const ready = init();

const fail = (code: string): never => {
  throw new Error(code);
};

function requireDerived(): DerivedKeys {
  return derived ?? fail('keys_not_derived');
}

function requireIdentity(): Identity {
  return identity ?? fail('locked');
}

function requireVault(vaultId: string) {
  return vaults.get(vaultId) ?? fail('vault_key_missing');
}

function dropDerived() {
  derived?.free();
  derived = null;
}

function setVault(vaultId: string, key: VaultKey, version: number) {
  vaults.get(vaultId)?.key.free();
  vaults.set(vaultId, { key, version });
}

const handlers: CryptoMethods = {
  derive({ password, salt, kdf }) {
    dropDerived();
    derived = deriveKeys(password, salt, kdf.memory_kib, kdf.iterations, kdf.parallelism);
    return derived.authKey;
  },
  createAccount({ userId, personalVaultId, meta }) {
    const account = AccountKey.generate();
    const fresh = Identity.generate();
    const vaultKey = VaultKey.generate();
    try {
      const result = {
        wrappedAccountKey: requireDerived().wrapAccountKey(account),
        publicKey: fresh.publicKey,
        encryptedPrivateKey: fresh.seal(account),
        personalVault: {
          encryptedMeta: vaultKey.encryptMeta(personalVaultId, 1, meta),
          encryptedVaultKey: sealVaultKey(fresh.publicKey, vaultKey, personalVaultId, userId, 1),
        },
      };
      identity?.free();
      identity = fresh;
      setVault(personalVaultId, vaultKey, 1);
      return result;
    } finally {
      account.free();
      dropDerived();
    }
  },
  unlock({ wrappedAccountKey, encryptedPrivateKey }) {
    const account = requireDerived().unwrapAccountKey(wrappedAccountKey);
    try {
      identity?.free();
      identity = Identity.open(account, encryptedPrivateKey);
      return identity.publicKey;
    } finally {
      account.free();
      dropDerived();
    }
  },
  openVault({ vaultId, userId, keyVersion, sealed }) {
    setVault(vaultId, requireIdentity().openVaultKey(sealed, vaultId, userId, keyVersion), keyVersion);
  },
  newVault({ vaultId, userId, meta }) {
    const me = requireIdentity();
    const key = VaultKey.generate();
    const result = {
      encryptedMeta: key.encryptMeta(vaultId, 1, meta),
      encryptedVaultKey: sealVaultKey(me.publicKey, key, vaultId, userId, 1),
    };
    setVault(vaultId, key, 1);
    return result;
  },
  hasVault({ vaultId, keyVersion }) {
    return vaults.get(vaultId)?.version === keyVersion;
  },
  encryptMeta({ vaultId, plaintext }) {
    const v = requireVault(vaultId);
    return v.key.encryptMeta(vaultId, v.version, plaintext);
  },
  decryptMeta({ vaultId, data }) {
    const v = requireVault(vaultId);
    return v.key.decryptMeta(vaultId, v.version, data);
  },
  encryptItem({ vaultId, itemId, plaintext }) {
    const v = requireVault(vaultId);
    return v.key.encryptItem(vaultId, itemId, v.version, plaintext);
  },
  decryptItems({ vaultId, items }) {
    const v = requireVault(vaultId);
    return items.map(({ id, keyVersion, data }) => {
      try {
        if (keyVersion !== v.version) throw new Error('key_version_mismatch');
        return { id, plaintext: v.key.decryptItem(vaultId, id, keyVersion, data) };
      } catch (e) {
        return { id, error: e instanceof Error ? e.message : String(e) };
      }
    });
  },
  sealFor({ vaultId, publicKey, userId }) {
    const v = requireVault(vaultId);
    return sealVaultKey(publicKey, v.key, vaultId, userId, v.version);
  },
  rotate({ vaultId, meta, members, items }) {
    const next = requireVault(vaultId).version + 1;
    const key = VaultKey.generate();
    try {
      return {
        encryptedMeta: key.encryptMeta(vaultId, next, meta),
        members: members.map((m) => ({
          user_id: m.userId,
          encrypted_vault_key: sealVaultKey(m.publicKey, key, vaultId, m.userId, next),
        })),
        items: items.map((i) => ({ id: i.id, data: key.encryptItem(vaultId, i.id, next, i.plaintext) })),
      };
    } finally {
      key.free();
    }
  },
  lock() {
    dropDerived();
    identity?.free();
    identity = null;
    for (const v of vaults.values()) v.key.free();
    vaults.clear();
  },
  generateSalt() {
    return generateSalt();
  },
  generatePassword(o) {
    return generatePassword(o.length, o.lowercase, o.uppercase, o.digits, o.symbols, o.avoidAmbiguous);
  },
};

self.onmessage = async (event: MessageEvent<CryptoRequest>) => {
  const { id, method, args } = event.data;
  let response: CryptoResponse;
  try {
    await ready;
    const fn = handlers[method] as (a: unknown) => unknown;
    response = { id, ok: true, result: fn(args) };
  } catch (e) {
    response = { id, ok: false, error: e instanceof Error ? e.message : String(e) };
  }
  self.postMessage(response);
};
