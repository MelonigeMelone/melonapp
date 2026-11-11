import Box from '@mui/material/Box';
import IconButton from '@mui/material/IconButton';
import Link from '@mui/material/Link';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import VisibilityIcon from '@mui/icons-material/Visibility';
import VisibilityOffIcon from '@mui/icons-material/VisibilityOff';
import { useState } from 'react';
import { isTotpField, safeHref, type Field } from '../vault/item';
import { TotpCode } from './Totp';
import { PasswordText } from './PasswordText';

const dateFormat = new Intl.DateTimeFormat('de-DE', { dateStyle: 'long' });

function formatDate(value: string): string {
  const d = new Date(`${value}T00:00:00`);
  return Number.isNaN(d.getTime()) ? value : dateFormat.format(d);
}

export function CopyButton({ label = 'Kopieren', onCopy }: { label?: string; onCopy: () => void }) {
  return (
    <Tooltip title={label}>
      <IconButton aria-label={label} onClick={onCopy}>
        <ContentCopyIcon />
      </IconButton>
    </Tooltip>
  );
}

export function FieldView({ field, onCopy }: { field: Field; onCopy: (value: string) => void }) {
  const [revealed, setRevealed] = useState(false);
  if (!field.value) return null;

  const label = (
    <Typography variant="subtitle2" color="text.secondary" component="h3" sx={{ mb: 0.5 }}>
      {field.label || 'Ohne Namen'}
    </Typography>
  );

  if (isTotpField(field)) {
    return (
      <Box component="section">
        {label}
        <TotpCode value={field.value} label={field.label || 'Einmalcode'} onCopy={onCopy} />
      </Box>
    );
  }

  if (field.kind === 'concealed') {
    return (
      <Box component="section">
        {label}
        <Paper
          variant="outlined"
          className="concealed-field"
          sx={{
            borderRadius: '18px',
            boxShadow: (t) => `inset 0 -4px 0 ${t.vars?.palette.melon.rindLight}`,
            display: 'flex',
            alignItems: 'center',
            gap: 1,
            pl: 2.5,
            pr: 1,
            py: 1.5,
          }}
        >
          <Box className="concealed-value" sx={{ flex: 1, minWidth: 0 }}>
            <PasswordText value={field.value} revealed={revealed} size="lg" />
          </Box>
          <Tooltip title={revealed ? 'Verbergen' : 'Anzeigen'}>
            <IconButton aria-label={revealed ? 'Verbergen' : 'Anzeigen'} aria-pressed={revealed} onClick={() => setRevealed(!revealed)}>
              {revealed ? <VisibilityOffIcon /> : <VisibilityIcon />}
            </IconButton>
          </Tooltip>
          <CopyButton onCopy={() => onCopy(field.value)} />
        </Paper>
      </Box>
    );
  }

  const href = safeHref(field);
  const text = field.kind === 'date' ? formatDate(field.value) : field.value;
  return (
    <Box component="section">
      {label}
      <Stack direction="row" sx={{ alignItems: 'center', justifyContent: 'space-between', gap: 1 }}>
        {href ? (
          <Link
            href={href}
            target={field.kind === 'url' ? '_blank' : undefined}
            rel="noopener noreferrer"
            color="inherit"
            underline="always"
            sx={{
              fontSize: '1.125rem',
              textDecorationColor: (t) => t.vars?.palette.primary.main,
              overflowWrap: 'anywhere',
              display: 'inline-flex',
              alignItems: 'center',
              gap: 0.5,
            }}
          >
            {text}
            {field.kind === 'url' && <OpenInNewIcon sx={{ fontSize: '1rem' }} aria-hidden="true" />}
          </Link>
        ) : (
          <Typography sx={{ fontSize: '1.125rem', overflowWrap: 'anywhere', whiteSpace: field.kind === 'multiline' ? 'pre-wrap' : undefined }}>
            {text}
          </Typography>
        )}
        <CopyButton onCopy={() => onCopy(field.value)} />
      </Stack>
    </Box>
  );
}
