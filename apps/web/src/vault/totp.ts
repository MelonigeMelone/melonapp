export type TotpAlgorithm = 'SHA-1' | 'SHA-256' | 'SHA-512';

export interface TotpConfig {
  secret: Uint8Array;
  algorithm: TotpAlgorithm;
  digits: number;
  period: number;
  issuer: string;
  account: string;
}

const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Decode(input: string): Uint8Array | null {
  const clean = input.toUpperCase().replace(/[\s-]/g, '').replace(/=+$/, '');
  if (!clean || /[^A-Z2-7]/.test(clean)) return null;
  const out: number[] = [];
  let bits = 0;
  let value = 0;
  for (const c of clean) {
    value = (value << 5) | BASE32.indexOf(c);
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return out.length >= 5 ? new Uint8Array(out) : null;
}

const ALGORITHMS: Record<string, TotpAlgorithm> = { SHA1: 'SHA-1', SHA256: 'SHA-256', SHA512: 'SHA-512' };

export function parseTotp(raw: string): TotpConfig | null {
  const value = raw.trim();
  if (!value) return null;
  if (!/^otpauth:/i.test(value)) {
    const secret = base32Decode(value);
    return secret ? { secret, algorithm: 'SHA-1', digits: 6, period: 30, issuer: '', account: '' } : null;
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.host.toLowerCase() !== 'totp') return null;
  const p = url.searchParams;
  const secret = base32Decode(p.get('secret') ?? '');
  if (!secret) return null;
  const digits = Number(p.get('digits') ?? 6);
  const period = Number(p.get('period') ?? 30);
  const algorithm = ALGORITHMS[(p.get('algorithm') ?? 'SHA1').toUpperCase()];
  if (!algorithm || ![6, 7, 8].includes(digits) || !(period >= 10 && period <= 300)) return null;
  const label = decodeURIComponent(url.pathname.replace(/^\/+/, ''));
  const [labelIssuer, account] = label.includes(':') ? label.split(/:(.*)/s) : ['', label];
  return { secret, algorithm, digits, period, issuer: p.get('issuer') ?? labelIssuer ?? '', account: (account ?? '').trim() };
}

export async function totpCode(cfg: TotpConfig, nowMs = Date.now()): Promise<string> {
  const counter = Math.floor(nowMs / 1000 / cfg.period);
  const msg = new Uint8Array(8);
  new DataView(msg.buffer).setBigUint64(0, BigInt(counter));
  const key = await crypto.subtle.importKey('raw', cfg.secret as BufferSource, { name: 'HMAC', hash: cfg.algorithm }, false, ['sign']);
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, msg));
  const offset = (mac[mac.length - 1] ?? 0) & 0x0f;
  const bin =
    (((mac[offset] ?? 0) & 0x7f) << 24) | ((mac[offset + 1] ?? 0) << 16) | ((mac[offset + 2] ?? 0) << 8) | (mac[offset + 3] ?? 0);
  return String(bin % 10 ** cfg.digits).padStart(cfg.digits, '0');
}

export function secondsLeft(cfg: TotpConfig, nowMs = Date.now()): number {
  return cfg.period - (Math.floor(nowMs / 1000) % cfg.period);
}

export function formatCode(code: string): string {
  return code.length === 6 ? `${code.slice(0, 3)} ${code.slice(3)}` : code.length === 8 ? `${code.slice(0, 4)} ${code.slice(4)}` : code;
}
