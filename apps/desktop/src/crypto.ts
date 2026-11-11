import { invoke } from '@tauri-apps/api/core';
import type { CryptoMethods, Method } from '../../web/src/crypto/protocol';

export function cryptoCall<M extends Method>(method: M, ...args: Parameters<CryptoMethods[M]>): Promise<ReturnType<CryptoMethods[M]>> {
  return invoke('crypto_call', { method, args: args[0] ?? null });
}
