import { passkeyItem, passkeyOf, type Item, type PasskeyData, type VaultItem } from './item';
import type { Snapshot } from './manager';

export interface PendingPasskey extends PasskeyData {
  file: string;
}

interface PasskeyTarget {
  getSnapshot(): Snapshot;
  saveItem(vaultId: string, id: string | null, item: Item): Promise<string>;
}

export function vaultPasskeys(items: readonly VaultItem[]): PasskeyData[] {
  return items.flatMap((v) => passkeyOf(v.item) ?? []);
}

export async function importPasskeys(vaults: PasskeyTarget, pending: readonly PendingPasskey[]): Promise<string[]> {
  const snapshot = vaults.getSnapshot();
  const personal = snapshot.vaults.find((v) => v.personal && v.canWrite);
  if (!personal) return [];
  const known = new Set(vaultPasskeys([...snapshot.items, ...snapshot.trash]).map((p) => p.credentialId));
  const failed = new Set<string>();
  const files: string[] = [];
  for (const entry of pending) {
    if (!files.includes(entry.file)) files.push(entry.file);
    const { file, ...data } = entry;
    const item = passkeyItem(data);
    if (!passkeyOf(item)) {
      failed.add(file);
      continue;
    }
    if (known.has(data.credentialId)) continue;
    try {
      await vaults.saveItem(personal.id, null, item);
      known.add(data.credentialId);
    } catch {
      failed.add(file);
    }
  }
  return files.filter((f) => !failed.has(f));
}
