import { fieldValue, type VaultItem } from './item';
import { estimateStrength } from './strength';

export interface AuditReport {
  checked: number;
  weak: VaultItem[];
  reused: VaultItem[][];
}

function passwordOf(v: VaultItem): string {
  return fieldValue(v.item, 'password');
}

export function audit(items: readonly VaultItem[]): AuditReport {
  const withPassword = items.filter((v) => passwordOf(v));
  const groups = new Map<string, VaultItem[]>();
  for (const v of withPassword) groups.set(passwordOf(v), [...(groups.get(passwordOf(v)) ?? []), v]);
  return {
    checked: withPassword.length,
    weak: withPassword.filter((v) => estimateStrength(passwordOf(v)).level === 'weak'),
    reused: [...groups.values()].filter((g) => g.length > 1),
  };
}

export const PWNED_ORIGIN = 'https://api.pwnedpasswords.com';

async function sha1Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('').toUpperCase();
}

export function countInRange(body: string, suffix: string): number {
  for (const line of body.split('\n')) {
    const [s, n] = line.trim().split(':');
    if (s === suffix) return Number(n) || 0;
  }
  return 0;
}

export async function breachCount(password: string, fetcher: typeof fetch = fetch): Promise<number> {
  const hash = await sha1Hex(password);
  const res = await fetcher(`${PWNED_ORIGIN}/range/${hash.slice(0, 5)}`, {
    headers: { 'Add-Padding': 'true' },
    cache: 'no-store',
    credentials: 'omit',
    referrerPolicy: 'no-referrer',
  });
  if (!res.ok) throw new Error(`pwned_${res.status}`);
  return countInRange(await res.text(), hash.slice(5));
}

export async function findBreached(
  items: readonly VaultItem[],
  onProgress: (done: number, total: number) => void = () => undefined,
  fetcher: typeof fetch = fetch,
): Promise<VaultItem[]> {
  const unique = [...new Set(items.map(passwordOf).filter(Boolean))];
  const breached = new Set<string>();
  let done = 0;
  const queue = [...unique];
  const worker = async () => {
    for (let pw = queue.shift(); pw !== undefined; pw = queue.shift()) {
      if ((await breachCount(pw, fetcher)) > 0) breached.add(pw);
      onProgress(++done, unique.length);
    }
  };
  await Promise.all(Array.from({ length: Math.min(4, unique.length) }, worker));
  return items.filter((v) => breached.has(passwordOf(v)));
}
