export type Meta = Record<string, unknown>;

export interface Verification {
  publicKey: string;
  at: string;
}

export type Verified = Record<string, Verification>;

export type VerifyState = 'verified' | 'changed' | 'unverified';

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

export function verifiedOf(meta: Meta): Verified {
  const raw = meta.verified;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out: Verified = {};
  for (const [userId, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!v || typeof v !== 'object') continue;
    const { publicKey, at } = v as Record<string, unknown>;
    if (typeof publicKey === 'string' && publicKey && typeof at === 'string') out[userId] = { publicKey, at };
  }
  return out;
}

export function withVerified(meta: Meta, userId: string, verification: Verification | null): Meta {
  const verified = { ...verifiedOf(meta) };
  if (verification) verified[userId] = verification;
  else delete verified[userId];
  return { ...meta, verified };
}

export function verifyState(verified: Verified, userId: string, publicKey: string): VerifyState {
  const v = verified[userId];
  if (!v) return 'unverified';
  return v.publicKey === publicKey ? 'verified' : 'changed';
}
