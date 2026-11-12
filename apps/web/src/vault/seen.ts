export interface SeenLog {
  get(key: string): number;
  raise(key: string, seq: number): void;
}

export function memoryLog(): SeenLog {
  const seen = new Map<string, number>();
  return {
    get: (key) => seen.get(key) ?? 0,
    raise: (key, seq) => {
      if (seq > (seen.get(key) ?? 0)) seen.set(key, seq);
    },
  };
}

export function storedLog(userId: string, storage: Storage | undefined = globalThis.localStorage): SeenLog {
  const name = `melon.seen.${userId}`;
  const seen = new Map<string, number>();
  try {
    const raw: unknown = JSON.parse(storage?.getItem(name) ?? '{}');
    if (raw && typeof raw === 'object') {
      for (const [key, value] of Object.entries(raw)) {
        if (Number.isSafeInteger(value) && (value as number) > 0) seen.set(key, value as number);
      }
    }
  } catch {
    seen.clear();
  }
  return {
    get: (key) => seen.get(key) ?? 0,
    raise: (key, seq) => {
      if (seq <= (seen.get(key) ?? 0)) return;
      seen.set(key, seq);
      try {
        storage?.setItem(name, JSON.stringify(Object.fromEntries(seen)));
      } catch {
        return;
      }
    },
  };
}
