import { passkeyItem, passkeyOf, type Item, type PasskeyData, type VaultItem } from './item';
import type { Snapshot, VaultView } from './manager';

export interface PendingPasskey extends PasskeyData {
  file: string;
  partial?: boolean;
}

interface PasskeyTarget {
  getSnapshot(): Snapshot;
  saveItem(vaultId: string, id: string | null, item: Item): Promise<string>;
}

const identity = (p: PasskeyData) => `${p.rp}\0${p.credentialId}\0${p.privateKey}`;

export function vaultPasskeys(items: readonly VaultItem[], vaults: readonly VaultView[]): PasskeyData[] {
  const personal = new Set(vaults.filter((v) => v.personal).map((v) => v.id));
  const ordered = [...items.filter((v) => personal.has(v.vaultId)), ...items.filter((v) => !personal.has(v.vaultId))];
  return ordered.flatMap((v) => passkeyOf(v.item) ?? []);
}

export async function importPasskeys(vaults: PasskeyTarget, pending: readonly PendingPasskey[]): Promise<string[]> {
  const snapshot = vaults.getSnapshot();
  const personal = snapshot.vaults.find((v) => v.personal && v.canWrite);
  if (!personal) return [];
  const own = [...snapshot.items, ...snapshot.trash].filter((v) => v.vaultId === personal.id);
  const known = new Set(own.flatMap((v) => passkeyOf(v.item) ?? []).map(identity));
  const failed = new Set<string>();
  const files: string[] = [];
  for (const entry of pending) {
    if (!files.includes(entry.file)) files.push(entry.file);
    const { file, partial, ...data } = entry;
    if (partial) failed.add(file);
    const item = passkeyItem(data);
    const parsed = passkeyOf(item);
    if (!parsed) {
      failed.add(file);
      continue;
    }
    if (known.has(identity(parsed))) continue;
    try {
      await vaults.saveItem(personal.id, null, item);
      known.add(identity(parsed));
    } catch {
      failed.add(file);
    }
  }
  return files.filter((f) => !failed.has(f));
}
