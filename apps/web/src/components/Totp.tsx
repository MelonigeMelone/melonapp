import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import CircularProgress from '@mui/material/CircularProgress';
import Paper from '@mui/material/Paper';
import Typography from '@mui/material/Typography';
import QrCodeScannerIcon from '@mui/icons-material/QrCodeScanner';
import { useEffect, useMemo, useState } from 'react';
import { monoFont } from '../theme';
import { formatCode, parseTotp, secondsLeft, totpCode } from '../vault/totp';

export function useTotp(value: string) {
  const cfg = useMemo(() => parseTotp(value), [value]);
  const [state, setState] = useState<{ code: string; left: number } | null>(null);

  useEffect(() => {
    if (!cfg) {
      setState(null);
      return;
    }
    let alive = true;
    const tick = () =>
      void totpCode(cfg).then((code) => {
        if (alive) setState({ code, left: secondsLeft(cfg) });
      });
    tick();
    const timer = setInterval(tick, 1000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [cfg]);

  return { cfg, code: state?.code ?? null, left: state?.left ?? 0 };
}

export function TotpCode({ value, onCopy, label }: { value: string; onCopy: (code: string) => void; label: string }) {
  const { cfg, code, left } = useTotp(value);
  if (!cfg) {
    return (
      <Typography color="error" variant="body2">
        Der Schlüssel für „{label}“ ist ungültig. Bearbeite den Eintrag und füge ihn neu ein.
      </Typography>
    );
  }
  const urgent = left <= 5;
  return (
    <Paper
      variant="outlined"
      className="totp-field"
      sx={{ borderRadius: '18px', display: 'flex', alignItems: 'center', gap: 2, pl: 2.5, pr: 1, py: 1.25 }}
    >
      <Box sx={{ position: 'relative', display: 'grid', placeItems: 'center' }} aria-label={`Noch ${left} Sekunden gültig`} role="img">
        <CircularProgress
          variant="determinate"
          value={(left / cfg.period) * 100}
          size={30}
          thickness={5}
          sx={{ color: urgent ? 'primary.main' : 'secondary.main' }}
        />
        <Typography variant="caption" sx={{ position: 'absolute', fontWeight: 700, fontSize: '0.7rem' }}>
          {left}
        </Typography>
      </Box>
      <Typography
        className="totp-code"
        sx={{ flex: 1, fontFamily: monoFont, fontSize: 'clamp(1.5rem, 3.4vw, 2.1rem)', letterSpacing: '0.08em', color: urgent ? 'primary.main' : 'text.primary' }}
        aria-live="off"
      >
        {code ? formatCode(code) : '··· ···'}
      </Typography>
      <Button size="small" variant="outlined" onClick={() => code && onCopy(code)} disabled={!code}>
        Code kopieren
      </Button>
    </Paper>
  );
}

export async function readQrFromImage(file: File): Promise<string | null> {
  const { default: jsQR } = await import('jsqr');
  const bitmap = await createImageBitmap(file);
  const canvas = document.createElement('canvas');
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.drawImage(bitmap, 0, 0);
  const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
  return jsQR(img.data, img.width, img.height)?.data ?? null;
}

export function QrImportButton({ onValue, onError }: { onValue: (v: string) => void; onError: (msg: string) => void }) {
  return (
    <Button component="label" size="small" startIcon={<QrCodeScannerIcon />} sx={{ alignSelf: 'flex-start' }}>
      QR-Code aus Bild lesen
      <input
        hidden
        type="file"
        accept="image/*"
        aria-label="Bild mit QR-Code"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (!file) return;
          void readQrFromImage(file)
            .then((text) => {
              if (text && parseTotp(text)) onValue(text);
              else onError('Im Bild wurde kein gültiger 2FA-QR-Code gefunden. Nimm einen Screenshot nur vom QR-Code.');
            })
            .catch(() => onError('Das Bild lässt sich nicht lesen.'));
        }}
      />
    </Button>
  );
}
