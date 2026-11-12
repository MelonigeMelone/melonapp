import type { Session } from './session';

export interface NativePlatform {
  server: string;
  supportsAutofill: boolean;
  publishAutofill(session: Session): Promise<void>;
  setServer(server: string): Promise<void>;
  enableBiometric(session: Session): Promise<void>;
  unlockBiometric(): Promise<Session>;
  disableBiometric(): Promise<void>;
  biometricKeepsToken(token: string): Promise<boolean>;
  onLock(callback: () => void): Promise<() => void>;
}

let native: NativePlatform | null = null;
export function setNativePlatform(platform: NativePlatform) { native = platform; }
export function nativePlatform() { return native; }
