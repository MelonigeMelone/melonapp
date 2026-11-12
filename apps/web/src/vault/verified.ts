export type Meta = Record<string, unknown>;

export interface Verification {
  publicKey: string;
  at: string;
}

export type Verified = Record<string, Verification>;

export interface Marks {
  counter: number;
  marks: Verified;
}

export type VerifyState = 'verified' | 'changed' | 'unverified';

export const MARKS_PURPOSE = 'verified-codes';

export function parseMeta(json: string): Meta {
  try {
    const o: unknown = JSON.parse(json);
    return o && typeof o === 'object' && !Array.isArray(o) ? (o as Meta) : {};
  } catch {
    return {};
  }
}

export function metaName(meta: Meta): string {
  return typeof meta.name === 'string' ? meta.name : '';
}

export function emptyMarks(): Marks {
  return { counter: 0, marks: Object.create(null) as Verified };
}

export function parseMarks(json: string): Marks | null {
  let o: unknown;
  try {
    o = JSON.parse(json);
  } catch {
    return null;
  }
  if (!o || typeof o !== 'object') return null;
  const { counter, marks } = o as Record<string, unknown>;
  if (!Number.isSafeInteger(counter) || (counter as number) < 1 || !marks || typeof marks !== 'object' || Array.isArray(marks)) return null;
  const out = emptyMarks();
  out.counter = counter as number;
  for (const [userId, v] of Object.entries(marks as Record<string, unknown>)) {
    if (!v || typeof v !== 'object') continue;
    const { publicKey, at } = v as Record<string, unknown>;
    if (typeof publicKey === 'string' && publicKey && typeof at === 'string') out.marks[userId] = { publicKey, at };
  }
  return out;
}

export function changeMarks(current: Marks, userId: string, verification: Verification | null): Marks {
  const next = emptyMarks();
  next.counter = current.counter + 1;
  for (const [id, v] of Object.entries(current.marks)) if (id !== userId) next.marks[id] = v;
  if (verification) next.marks[userId] = verification;
  return next;
}

export function verifyState(marks: Verified, userId: string, publicKey: string): VerifyState {
  if (!Object.hasOwn(marks, userId)) return 'unverified';
  return marks[userId]?.publicKey === publicKey ? 'verified' : 'changed';
}
