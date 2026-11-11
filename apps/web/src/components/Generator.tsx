import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Checkbox from '@mui/material/Checkbox';
import FormControlLabel from '@mui/material/FormControlLabel';
import FormGroup from '@mui/material/FormGroup';
import Paper from '@mui/material/Paper';
import Slider from '@mui/material/Slider';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import RefreshIcon from '@mui/icons-material/Refresh';
import { useCallback, useEffect, useState } from 'react';
import { cryptoCall } from '../crypto/client';
import type { GeneratorOptions } from '../crypto/protocol';
import { PasswordText } from './PasswordText';

const DEFAULTS: GeneratorOptions = {
  length: 20,
  lowercase: true,
  uppercase: true,
  digits: true,
  symbols: true,
  avoidAmbiguous: false,
};

const TOGGLES: { key: keyof Omit<GeneratorOptions, 'length'>; label: string }[] = [
  { key: 'lowercase', label: 'Kleinbuchstaben' },
  { key: 'uppercase', label: 'Großbuchstaben' },
  { key: 'digits', label: 'Ziffern' },
  { key: 'symbols', label: 'Sonderzeichen' },
  { key: 'avoidAmbiguous', label: 'Ohne verwechselbare Zeichen' },
];

export function Generator({ onUse }: { onUse: (password: string) => void }) {
  const [opts, setOpts] = useState(DEFAULTS);
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);

  const generate = useCallback(async (o: GeneratorOptions) => {
    try {
      setValue(await cryptoCall('generatePassword', o));
      setError(null);
    } catch {
      setError('Wähle mindestens eine Zeichenart.');
    }
  }, []);

  useEffect(() => {
    void generate(opts);
  }, [opts, generate]);

  return (
    <Paper sx={{ p: 2.5, bgcolor: 'melon.sunk', borderRadius: '18px' }}>
      <Stack spacing={2}>
        <Box className="generator-output" aria-live="polite" sx={{ minHeight: 48, display: 'flex', alignItems: 'center' }}>
          {error ? (
            <Typography color="error" variant="body2">
              {error}
            </Typography>
          ) : (
            <PasswordText value={value} revealed size="lg" />
          )}
        </Box>
        <Box>
          <Typography id="generator-length" variant="subtitle2">
            Länge: {opts.length}
          </Typography>
          <Slider
            aria-labelledby="generator-length"
            min={8}
            max={64}
            value={opts.length}
            onChange={(_, v) => setOpts({ ...opts, length: v as number })}
          />
        </Box>
        <FormGroup row sx={{ columnGap: 1 }}>
          {TOGGLES.map((t) => (
            <FormControlLabel
              key={t.key}
              control={
                <Checkbox
                  size="small"
                  checked={opts[t.key]}
                  onChange={(e) => setOpts({ ...opts, [t.key]: e.target.checked })}
                />
              }
              label={<Typography variant="body2">{t.label}</Typography>}
            />
          ))}
        </FormGroup>
        <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: 'wrap' }}>
          <Button variant="outlined" startIcon={<RefreshIcon />} onClick={() => void generate(opts)}>
            Neu erzeugen
          </Button>
          <Button variant="contained" disabled={!!error || !value} onClick={() => onUse(value)}>
            Dieses Passwort verwenden
          </Button>
        </Stack>
      </Stack>
    </Paper>
  );
}
