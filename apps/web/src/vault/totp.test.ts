import { describe, expect, it } from 'vitest';
import { base32Decode, formatCode, parseTotp, secondsLeft, totpCode, type TotpConfig } from './totp';

const RFC_KEY = ['GEZDGNBVGY3TQOJQ', 'GEZDGNBVGY3TQOJQ'].join('');

const ascii = (s: string) => new TextEncoder().encode(s);

const rfc = (secret: string, algorithm: TotpConfig['algorithm']): TotpConfig => ({
  secret: ascii(secret),
  algorithm,
  digits: 8,
  period: 30,
  issuer: '',
  account: '',
});

describe('totp', () => {
  it('matches the RFC 6238 test vectors', async () => {
    const sha1 = rfc('12345678901234567890', 'SHA-1');
    const sha256 = rfc('12345678901234567890123456789012', 'SHA-256');
    const sha512 = rfc('1234567890123456789012345678901234567890123456789012345678901234', 'SHA-512');
    const vectors: [number, string, string, string][] = [
      [59, '94287082', '46119246', '90693936'],
      [1111111109, '07081804', '68084774', '25091201'],
      [1111111111, '14050471', '67062674', '99943326'],
      [1234567890, '89005924', '91819424', '93441116'],
      [2000000000, '69279037', '90698825', '38618901'],
      [20000000000, '65353130', '77737706', '47863826'],
    ];
    for (const [t, a, b, c] of vectors) {
      expect(await totpCode(sha1, t * 1000)).toBe(a);
      expect(await totpCode(sha256, t * 1000)).toBe(b);
      expect(await totpCode(sha512, t * 1000)).toBe(c);
    }
  });

  it('decodes base32 with spaces, lowercase and padding', () => {
    expect(base32Decode('GEZD GNBV GY3T QOJQ GEZD GNBV GY3T QOJQ')).toEqual(ascii('12345678901234567890'));
    expect(base32Decode('gezdgnbvgy3tqojqgezdgnbvgy3tqojq====')).toEqual(ascii('12345678901234567890'));
    expect(base32Decode('not base32!')).toBeNull();
    expect(base32Decode('ABC')).toBeNull();
  });

  it('parses otpauth links', () => {
    const cfg = parseTotp(`otpauth://totp/GitHub:melone?secret=${RFC_KEY}&issuer=GitHub&digits=6&period=30`);
    expect(cfg).toMatchObject({ issuer: 'GitHub', account: 'melone', digits: 6, period: 30, algorithm: 'SHA-1' });
    expect(parseTotp(`otpauth://totp/x?secret=${RFC_KEY}&algorithm=SHA256&digits=8`)?.algorithm).toBe('SHA-256');
  });

  it('rejects broken or unsupported configurations', () => {
    expect(parseTotp('')).toBeNull();
    expect(parseTotp(`otpauth://hotp/x?secret=${RFC_KEY}`)).toBeNull();
    expect(parseTotp(`otpauth://totp/x?secret=${RFC_KEY}&digits=4`)).toBeNull();
    expect(parseTotp(`otpauth://totp/x?secret=${RFC_KEY}&algorithm=MD5`)).toBeNull();
    expect(parseTotp(`otpauth://totp/x`)).toBeNull();
  });

  it('formats codes and counts down', () => {
    expect(formatCode('123456')).toBe('123 456');
    expect(formatCode('12345678')).toBe('1234 5678');
    const cfg = parseTotp('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ') as TotpConfig;
    expect(secondsLeft(cfg, 0)).toBe(30);
    expect(secondsLeft(cfg, 29_000)).toBe(1);
  });

  it('accepts short secrets used by some sites, but not too short ones', () => {
    expect(parseTotp('JBSWY3DP')).not.toBeNull();
    expect(parseTotp('JBSWY3')).toBeNull();
  });
});
