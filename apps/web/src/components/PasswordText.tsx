import { charClass } from '../vault/entry';

const MASK = '••••••••••••';

export function PasswordText({ value, revealed, size = 'md' }: {
  value: string;
  revealed: boolean;
  size?: 'md' | 'lg';
}) {
  if (!revealed) {
    return (
      <span className={`pw pw-${size} pw-masked`} aria-label="Passwort verborgen">
        {MASK}
      </span>
    );
  }
  return (
    <span className={`pw pw-${size}`} translate="no" spellCheck={false}>
      {[...value].map((c, i) => (
        <span key={i} className={`pw-${charClass(c)}`}>
          {c}
        </span>
      ))}
    </span>
  );
}
