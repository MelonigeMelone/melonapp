import { useSyncExternalStore } from 'react';

export const AUTO_LOCK_CHOICES = [1, 5, 15, 30] as const;
export type AutoLockMinutes = (typeof AUTO_LOCK_CHOICES)[number];

const KEY = 'melon.autoLockMinutes';
const DEFAULT: AutoLockMinutes = 5;
const listeners = new Set<() => void>();

function read(): AutoLockMinutes {
  try {
    const n = Number(localStorage.getItem(KEY));
    return (AUTO_LOCK_CHOICES as readonly number[]).includes(n) ? (n as AutoLockMinutes) : DEFAULT;
  } catch {
    return DEFAULT;
  }
}

let current = read();

export function setAutoLockMinutes(n: AutoLockMinutes) {
  current = n;
  try {
    localStorage.setItem(KEY, String(n));
  } catch {
    return;
  } finally {
    for (const l of listeners) l();
  }
}

export function useAutoLockMinutes(): AutoLockMinutes {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => current,
  );
}
