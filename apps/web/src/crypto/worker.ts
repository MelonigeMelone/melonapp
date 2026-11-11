import init, {
  deriveKeys,
  generatePassword,
  generateSalt,
  VaultKey,
  type DerivedKeys,
} from '@melon/wasm';
import type { CryptoMethods, CryptoRequest, CryptoResponse } from './protocol';

let derived: DerivedKeys | null = null;
let vault: VaultKey | null = null;
const ready = init();

function requireDerived(): DerivedKeys {
  if (!derived) throw new Error('keys_not_derived');
  return derived;
}

function requireVault(): VaultKey {
  if (!vault) throw new Error('vault_locked');
  return vault;
}

function dropDerived() {
  derived?.free();
  derived = null;
}

function replaceVault(next: VaultKey | null) {
  vault?.free();
  vault = next;
}

const handlers: CryptoMethods = {
  derive({ password, salt, kdf }) {
    dropDerived();
    derived = deriveKeys(password, salt, kdf.memory_kib, kdf.iterations, kdf.parallelism);
    return derived.authKey;
  },
  createVault() {
    const fresh = VaultKey.generate();
    const wrapped = requireDerived().wrapVaultKey(fresh);
    replaceVault(fresh);
    dropDerived();
    return wrapped;
  },
  unlock({ wrapped }) {
    const key = requireDerived().unwrapVaultKey(wrapped);
    replaceVault(key);
    dropDerived();
  },
  encrypt({ module, id, plaintext }) {
    return requireVault().encrypt(module, id, plaintext);
  },
  decryptMany({ module, items }) {
    const key = requireVault();
    return items.map(({ id, data }) => {
      try {
        return { id, plaintext: key.decrypt(module, id, data) };
      } catch (e) {
        return { id, error: e instanceof Error ? e.message : String(e) };
      }
    });
  },
  lock() {
    dropDerived();
    replaceVault(null);
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
