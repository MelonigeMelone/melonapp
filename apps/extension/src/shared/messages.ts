export interface Login {
  vaultId: string;
  id: string;
  title: string;
  username: string;
  password: string;
  urls: string[];
}

export interface Snapshot {
  server: string;
  email: string;
  userId: string;
  token: string;
  logins: Login[];
  spaces: { id: string; name: string; canWrite: boolean }[];
  keys: { vaultId: string; version: number; raw: number[] }[];
  lastUsed: number;
}

export interface PendingSave {
  url: string;
  username: string;
  password: string;
  at: number;
}

export interface Match {
  vaultId: string;
  id: string;
  title: string;
  username: string;
}

export type ContentRequest =
  | { type: 'matches' }
  | { type: 'credentials'; vaultId: string; id: string }
  | { type: 'submitted'; username: string; password: string }
  | { type: 'generate' };

export type MatchesResponse = { locked: true } | { locked: false; matches: Match[] };

export type TabMessage = { type: 'fill'; username: string; password: string; urls: string[] };

export const SESSION_KEY = 'snapshot';
export const PENDING_KEY = 'pendingSave';
export const AUTO_LOCK_MINUTES = 30;
