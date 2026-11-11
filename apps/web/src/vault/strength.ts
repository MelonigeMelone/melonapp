export type StrengthLevel = 'weak' | 'fair' | 'strong';

export interface Strength {
  bits: number;
  level: StrengthLevel;
  hint: string | null;
}

const COMMON = new Set(
  (
    '123456 password 12345678 qwerty 123456789 12345 1234 111111 1234567 dragon 123123 baseball abc123 football monkey ' +
    'letmein 696969 shadow master 666666 qwertyuiop 123321 mustang 1234567890 michael 654321 superman 1qaz2wsx 7777777 ' +
    '121212 000000 qazwsx 123qwe killer trustno1 jordan jennifer zxcvbnm asdfgh hunter buster soccer harley batman andrew ' +
    'tigger sunshine iloveyou charlie robert thomas hockey ranger daniel starwars 112233 george computer michelle jessica ' +
    'pepper 1111 zxcvbn 555555 11111111 131313 freedom 777777 pass maggie 159753 aaaaaa ginger princess joshua cheese ' +
    'amanda summer love ashley nicole chelsea matthew access yankees 987654321 dallas austin thunder taylor matrix welcome ' +
    'login admin test passwort hallo schatz fussball qwertz geheim sommer winter schalke bayern dortmund berlin hamburg ' +
    'mausi hase schnecke liebe sonne blume delfin melone passwort qwertzuiop asdfghjkl ichliebedich hallo123 schalke04'
  ).split(' '),
);

const SEQUENCES = ['abcdefghijklmnopqrstuvwxyz', '0123456789', 'qwertzuiopasdfghjklyxcvbnm', 'qwertyuiopasdfghjklzxcvbnm'];

function poolSize(pw: string): number {
  let size = 0;
  if (/[a-z]/.test(pw)) size += 26;
  if (/[A-Z]/.test(pw)) size += 26;
  if (/[0-9]/.test(pw)) size += 10;
  if (/[^a-zA-Z0-9]/.test(pw)) size += 33;
  return size;
}

function predictableRuns(pw: string): number {
  const lower = pw.toLowerCase();
  let penalty = 0;
  for (let i = 2; i < lower.length; i++) {
    const a = lower[i - 2] as string;
    const b = lower[i - 1] as string;
    const c = lower[i] as string;
    if (a === b && b === c) penalty++;
    else if (SEQUENCES.some((s) => s.includes(a + b + c) || s.includes(c + b + a))) penalty++;
  }
  return penalty;
}

export function baseWord(pw: string): string {
  return pw
    .toLowerCase()
    .replace(/[^a-z0-9äöüß]+$/g, '')
    .replace(/\d+$/g, '')
    .replace(/^\d+/g, '')
    .replace(/[^a-z0-9äöüß]+$/g, '');
}

export function estimateStrength(pw: string): Strength {
  if (!pw) return { bits: 0, level: 'weak', hint: null };
  if (COMMON.has(pw.toLowerCase()) || COMMON.has(baseWord(pw))) {
    return { bits: 8, level: 'weak', hint: 'Gehört zu den häufigsten Passwörtern.' };
  }
  const perChar = Math.log2(Math.max(poolSize(pw), 1));
  const bits = Math.max(0, Math.round((pw.length - predictableRuns(pw)) * perChar));
  const level: StrengthLevel = bits < 45 || pw.length < 10 ? 'weak' : bits < 70 ? 'fair' : 'strong';
  const hint =
    level === 'strong'
      ? null
      : pw.length < 12
        ? 'Zu kurz. Nimm mindestens 12 Zeichen oder lass den Generator eins erzeugen.'
        : predictableRuns(pw) > 2
          ? 'Enthält Wiederholungen oder Tastaturfolgen.'
          : 'Mehr Länge oder mehr Zeichenarten machen es stärker.';
  return { bits, level, hint };
}

export const STRENGTH_LABELS: Record<StrengthLevel, string> = { weak: 'Schwach', fair: 'Mittel', strong: 'Stark' };
