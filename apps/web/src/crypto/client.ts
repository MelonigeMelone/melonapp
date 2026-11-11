import type { CryptoMethods, CryptoRequest, CryptoResponse, Method } from './protocol';

type Pending = { resolve: (v: unknown) => void; reject: (e: Error) => void };

const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
const pending = new Map<number, Pending>();
let nextId = 1;

worker.onmessage = (event: MessageEvent<CryptoResponse>) => {
  const msg = event.data;
  const p = pending.get(msg.id);
  if (!p) return;
  pending.delete(msg.id);
  if (msg.ok) p.resolve(msg.result);
  else p.reject(new Error(msg.error));
};

export function cryptoCall<M extends Method>(
  method: M,
  ...args: Parameters<CryptoMethods[M]>
): Promise<ReturnType<CryptoMethods[M]>> {
  const id = nextId++;
  const request: CryptoRequest = { id, method, args: args[0] };
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
    worker.postMessage(request);
  });
}
