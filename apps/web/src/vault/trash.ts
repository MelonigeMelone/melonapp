import type { Item, VaultItem } from './item';

export const TRASH_DAYS = 30;
const DAY = 24 * 60 * 60 * 1000;

export function isTrashed(item: Item): boolean {
  return typeof item.trashedAt === 'string';
}

export function toTrash(item: Item, now = new Date()): Item {
  return { ...item, trashedAt: now.toISOString() };
}

export function fromTrash(item: Item): Item {
  const rest = { ...item };
  delete rest.trashedAt;
  return rest;
}

export function purgeDate(item: Item): Date | null {
  return item.trashedAt ? new Date(Date.parse(item.trashedAt) + TRASH_DAYS * DAY) : null;
}

export function expired(items: VaultItem[], now = new Date()): VaultItem[] {
  return items.filter((v) => {
    const due = purgeDate(v.item);
    return due !== null && due.getTime() <= now.getTime();
  });
}
