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

export interface CryptoMethods {
  derive(args: { password: string; salt: string; kdf: Kdf }): string;
  createVault(): string;
  unlock(args: { wrapped: string }): void;
  encrypt(args: { module: string; id: string; plaintext: string }): string;
  decryptMany(args: { module: string; items: { id: string; data: string }[] }): Decrypted[];
  lock(): void;
  generateSalt(): string;
  generatePassword(args: GeneratorOptions): string;
}

export type Method = keyof CryptoMethods;

export interface CryptoRequest {
  id: number;
  method: Method;
  args: unknown;
}

export type CryptoResponse =
  | { id: number; ok: true; result: unknown }
  | { id: number; ok: false; error: string };
