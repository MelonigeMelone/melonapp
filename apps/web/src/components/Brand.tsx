import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { useId } from 'react';

const v = (name: string) => `var(--mui-palette-melon-${name})`;

export function MelonMark({ size = 28 }: { size?: number }) {
  const id = useId();
  return (
    <svg
      width={size}
      height={Math.round((size * 16) / 30)}
      viewBox="1 11 30 16"
      aria-hidden="true"
      focusable="false"
      style={{ overflow: 'visible' }}
    >
      <defs>
        <linearGradient id={`${id}-rind`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="var(--mui-palette-primary-main)" />
          <stop offset="1" stopColor="var(--mui-palette-secondary-main)" />
        </linearGradient>
      </defs>
      <path d="M2 12a14 14 0 0 0 28 0Z" fill={`url(#${id}-rind)`} />
      <path d="M5 12a11 11 0 0 0 22 0Z" fill="var(--mui-palette-background-default)" opacity="0.9" />
      <path d="M7 12a9 9 0 0 0 18 0Z" fill={`url(#${id}-rind)`} opacity="0.55" />
      <ellipse cx="12" cy="15.5" rx="0.9" ry="1.4" fill={v('symbol')} />
      <ellipse cx="16" cy="18" rx="0.9" ry="1.4" fill={v('symbol')} />
      <ellipse cx="20" cy="15.5" rx="0.9" ry="1.4" fill={v('symbol')} />
    </svg>
  );
}

export function Brand() {
  return (
    <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
      <MelonMark />
      <Typography variant="h6" component="span">
        MelonApp
      </Typography>
    </Stack>
  );
}
