import Typography from '@mui/material/Typography';
import type { SxProps, Theme } from '@mui/material/styles';
import { charClass, type CharClass } from '../vault/item';

const MASK = '••••••••••••';

const classStyle: Record<CharClass, SxProps<Theme>> = {
  lower: {},
  upper: { fontWeight: 700 },
  digit: { color: 'melon.digit' },
  symbol: { color: 'melon.symbol', fontWeight: 700 },
};

const sizes = {
  md: { fontSize: '1rem', letterSpacing: '0.02em' },
  lg: { fontSize: 'clamp(1.35rem, 3.2vw, 2rem)', letterSpacing: '0.06em', lineHeight: 1.35 },
};

export function PasswordText({
  value,
  revealed,
  size = 'md',
}: {
  value: string;
  revealed: boolean;
  size?: 'md' | 'lg';
}) {
  if (!revealed) {
    return (
      <Typography
        variant="password"
        component="span"
        className="pw"
        aria-label="Passwort verborgen"
        sx={{ ...sizes[size], color: 'text.secondary', letterSpacing: '0.15em' }}
      >
        {MASK}
      </Typography>
    );
  }
  return (
    <Typography variant="password" component="span" className="pw" translate="no" sx={sizes[size]}>
      {[...value].map((c, i) => (
        <Typography key={i} component="span" variant="inherit" sx={classStyle[charClass(c)]}>
          {c}
        </Typography>
      ))}
    </Typography>
  );
}
