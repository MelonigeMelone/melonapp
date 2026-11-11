import type { Session } from './session';

export interface NativePlatform {
  server: string;
  setServer(server: string): Promise<void>;
  enableBiometric(session: Session): Promise<void>;
  unlockBiometric(): Promise<Session>;
  disableBiometric(): Promise<void>;
  onLock(callback: () => void): Promise<() => void>;
}

let native: NativePlatform | null = null;
export function setNativePlatform(platform: NativePlatform) { native = platform; }
export function nativePlatform() { return native; }
