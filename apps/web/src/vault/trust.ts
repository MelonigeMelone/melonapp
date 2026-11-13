import type { Meta } from './verified';

export interface Invited {
  email: string;
  until: string;
  by: string;
}

export interface Trust {
  seq: number;
  members: string[];
  invited: Invited[];
}

export type TrustList = Omit<Trust, 'seq'>;

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function parseTrust(meta: Meta): Trust | null {
  const t = meta.trust;
  if (!t || typeof t !== 'object' || Array.isArray(t)) return null;
  const { seq, members, invited } = t as Record<string, unknown>;
  if (!Number.isSafeInteger(seq) || (seq as number) < 1 || !Array.isArray(members) || !Array.isArray(invited)) return null;
  return {
    seq: seq as number,
    members: [...new Set(members.filter((m): m is string => typeof m === 'string' && m !== ''))],
    invited: invited.flatMap((i: unknown) => {
      if (!i || typeof i !== 'object') return [];
      const { email, until, by } = i as Record<string, unknown>;
      return typeof email === 'string' && typeof until === 'string' && typeof by === 'string' ? [{ email, until, by }] : [];
    }),
  };
}

export function stillValid(invite: Invited, now: Date): boolean {
  const until = Date.parse(invite.until);
  return Number.isFinite(until) && until > now.getTime();
}

export function isInvited(trust: TrustList, email: string, now: Date): boolean {
  const wanted = normalizeEmail(email);
  return trust.invited.some((i) => i.email === wanted && stillValid(i, now));
}

export function withTrust(meta: Meta, list: TrustList, seq: number, now: Date): Meta {
  return {
    ...meta,
    trust: {
      seq,
      members: [...new Set(list.members)],
      invited: list.invited.filter((i) => stillValid(i, now)),
    },
  };
}

export function initialTrust(userId: string): Trust {
  return { seq: 1, members: [userId], invited: [] };
}
