export interface Login {
  vaultId: string;
  id: string;
  title: string;
  username: string;
  password: string;
  totp: string;
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
  hasTotp: boolean;
  chosen?: boolean;
}

export interface Flow {
  site: string;
  username?: string;
  choice?: { vaultId: string; id: string };
  at: number;
}

export type ContentRequest =
  | { type: 'matches' }
  | { type: 'credentials'; vaultId: string; id: string }
  | { type: 'submitted'; username: string; password: string }
  | { type: 'generate' }
  | { type: 'pendingForPage' }
  | { type: 'identifier'; username: string }
  | { type: 'choose'; vaultId: string; id: string }
  | { type: 'otp'; vaultId: string; id: string };

export type FrameRequest = { type: 'closeSavePrompt' } | { type: 'resizeSavePrompt'; height: number } | { type: 'neverSave' };

export type MatchesResponse = { locked: true } | { locked: false; matches: Match[] };

export type TabMessage =
  | { type: 'fill'; username: string; password: string; urls: string[] }
  | { type: 'closeSave' }
  | { type: 'resizeSave'; height: number };

export const SESSION_KEY = 'snapshot';
export const PENDING_KEY = 'pendingSave';
export const NEVER_KEY = 'neverSave';
export const FLOWS_KEY = 'flows';
export const FLOW_MAX_AGE_MS = 5 * 60_000;
export const AUTO_LOCK_MINUTES = 30;
export const PROMPT_MAX_AGE_MS = 5 * 60_000;
