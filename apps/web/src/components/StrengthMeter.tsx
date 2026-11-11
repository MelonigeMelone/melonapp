import LinearProgress from '@mui/material/LinearProgress';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { estimateStrength, STRENGTH_LABELS } from '../vault/strength';

export function StrengthMeter({ password }: { password: string }) {
  if (!password) return null;
  const s = estimateStrength(password);
  const value = s.level === 'weak' ? 25 : s.level === 'fair' ? 60 : 100;
  const color = s.level === 'weak' ? 'error' : s.level === 'fair' ? 'warning' : 'success';
  return (
    <Stack spacing={0.5} className="strength-meter">
      <LinearProgress variant="determinate" value={value} color={color} sx={{ height: 6, borderRadius: 3 }} aria-hidden="true" />
      <Typography variant="body2" color="text.secondary">
        <strong>{STRENGTH_LABELS[s.level]}</strong>
        {s.hint ? `: ${s.hint}` : ''}
      </Typography>
    </Stack>
  );
}
