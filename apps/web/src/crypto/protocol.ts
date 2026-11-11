import type { Kdf } from '../api';

export interface GeneratorOptions {
  length: number;
  lowercase: boolean;
  uppercase: boolean;
  digits: boolean;
  symbols: boolean;
  avoidAmbiguous: boolean;
}

export type Decrypted = { id: string; plaintext: string } | { id: string; error: string };

export interface NewAccount {
  wrappedAccountKey: string;
  publicKey: string;
  encryptedPrivateKey: string;
  personalVault: { encryptedMeta: string; encryptedVaultKey: string };
}

export interface Rotated {
  encryptedMeta: string;
  members: { user_id: string; encrypted_vault_key: string }[];
  items: { id: string; data: string }[];
}

export interface Credentials {
  authKey: string;
  wrappedAccountKey: string;
}

export interface Reauth {
  password: string;
  salt: string;
  kdf: Kdf;
  wrappedAccountKey: string;
}

export interface CryptoMethods {
  derive(a: { password: string; salt: string; kdf: Kdf }): string;
  createAccount(a: { userId: string; personalVaultId: string; meta: string }): NewAccount;
  unlock(a: { wrappedAccountKey: string; encryptedPrivateKey: string }): string;
  openVault(a: { vaultId: string; userId: string; keyVersion: number; sealed: string }): void;
  newVault(a: { vaultId: string; userId: string; meta: string }): { encryptedMeta: string; encryptedVaultKey: string };
  hasVault(a: { vaultId: string; keyVersion: number }): boolean;
  encryptMeta(a: { vaultId: string; plaintext: string }): string;
  decryptMeta(a: { vaultId: string; data: string }): string;
  encryptItem(a: { vaultId: string; itemId: string; plaintext: string }): string;
  decryptItems(a: { vaultId: string; items: { id: string; keyVersion: number; data: string }[] }): Decrypted[];
  sealFor(a: { vaultId: string; publicKey: string; userId: string }): string;
  rotate(a: {
    vaultId: string;
    meta: string;
    members: { userId: string; publicKey: string }[];
    items: { id: string; plaintext: string }[];
  }): Rotated;
  setupRecovery(a: Reauth): {
    currentAuthKey: string;
    recoveryKey: string;
    recoveryAuthKey: string;
    recoveryWrappedAccountKey: string;
  };
  changePassword(a: Reauth & { newPassword: string; newSalt: string; newKdf: Kdf }): Credentials & { currentAuthKey: string };
  recoveryAuth(a: { recoveryKey: string }): string;
  recoveryReset(a: { recoveryWrappedAccountKey: string; newPassword: string; newSalt: string; newKdf: Kdf }): Credentials;
  fingerprint(a: { publicKey: string }): string;
  lock(): void;
  generateSalt(): string;
  generatePassword(a: GeneratorOptions): string;
}

export type Method = keyof CryptoMethods;

export interface CryptoRequest {
  id: number;
  method: Method;
  args: unknown;
}

export type CryptoResponse = { id: number; ok: true; result: unknown } | { id: number; ok: false; error: string };
