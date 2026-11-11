const SETS = ['abcdefghijklmnopqrstuvwxyz', 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', '0123456789', '!@#$%^&*()-_=+[]{};:,.?/'];

function randomIndex(max: number): number {
  const limit = Math.floor(0x1_0000_0000 / max) * max;
  const buf = new Uint32Array(1);
  for (;;) {
    crypto.getRandomValues(buf);
    const n = buf[0] ?? 0;
    if (n < limit) return n % max;
  }
}

export function generatePassword(length = 20): string {
  const all = SETS.join('');
  const chars = SETS.map((s) => s[randomIndex(s.length)] as string);
  while (chars.length < length) chars.push(all[randomIndex(all.length)] as string);
  for (let i = chars.length - 1; i > 0; i--) {
    const j = randomIndex(i + 1);
    [chars[i], chars[j]] = [chars[j] as string, chars[i] as string];
  }
  return chars.join('');
}
