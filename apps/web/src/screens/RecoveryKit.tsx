import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import Checkbox from '@mui/material/Checkbox';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import FormControlLabel from '@mui/material/FormControlLabel';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import DownloadIcon from '@mui/icons-material/Download';
import { useState, type FormEvent } from 'react';
import { describeError, setupRecovery, type Account, type Session } from '../session';
import { monoFont } from '../theme';

function kitText(email: string, key: string): string {
  return [
    'MelonApp – Notfall-Kit',
    '',
    `Konto:   ${email}`,
    `Server:  ${window.location.origin}`,
    `Erstellt: ${new Date().toLocaleString('de-DE')}`,
    '',
    'Recovery-Key:',
    key,
    '',
    'Damit setzt du ein neues Master-Passwort, falls du deins vergisst:',
    'Anmeldeseite → „Master-Passwort vergessen?“.',
    '',
    'Bewahre dieses Kit offline auf, zum Beispiel ausgedruckt bei deinen Unterlagen.',
    'Wer es hat, kann zusammen mit deiner E-Mail-Adresse auf dein Konto zugreifen.',
  ].join('\n');
}

export function RecoveryKitDialog({
  session,
  onDone,
  onClose,
}: {
  session: Session;
  onDone: (update: Partial<Account>) => void;
  onClose: () => void;
}) {
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [recoveryKey, setRecoveryKey] = useState<string | null>(null);
  const [stored, setStored] = useState(false);
  const [update, setUpdate] = useState<Partial<Account>>({});

  const create = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await setupRecovery(session, password);
      setPassword('');
      setRecoveryKey(r.recoveryKey);
      setUpdate(r.account);
    } catch (err) {
      setError(describeError(err));
    } finally {
      setBusy(false);
    }
  };

  const download = () => {
    if (!recoveryKey) return;
    const blob = new Blob([kitText(session.email, recoveryKey)], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'MelonApp-Notfall-Kit.txt';
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <Dialog open onClose={recoveryKey ? undefined : onClose} fullWidth maxWidth="sm" aria-labelledby="kit-title">
      <DialogTitle id="kit-title">Notfall-Kit</DialogTitle>
      {recoveryKey === null ? (
        <form onSubmit={create}>
          <DialogContent>
            <Stack spacing={2}>
              <Typography>
                Mit dem Recovery-Key setzt du ein neues Master-Passwort, falls du deins vergisst. Ohne ihn sind deine Daten dann
                verloren, auch für den Betreiber des Servers.
              </Typography>
              {session.hasRecovery && (
                <Alert severity="info">Du hast schon ein Notfall-Kit. Ein neues ersetzt das alte, das alte funktioniert danach nicht mehr.</Alert>
              )}
              <TextField
                label="Master-Passwort zur Bestätigung"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoFocus
                fullWidth
              />
              {error && <Alert severity="error">{error}</Alert>}
            </Stack>
          </DialogContent>
          <DialogActions sx={{ px: 3, pb: 2.5 }}>
            <Button onClick={onClose}>Abbrechen</Button>
            <Button type="submit" variant="contained" loading={busy} disabled={!password}>
              Notfall-Kit erstellen
            </Button>
          </DialogActions>
        </form>
      ) : (
        <>
          <DialogContent>
            <Stack spacing={2}>
              <Typography>Das ist dein Recovery-Key. Er wird nur dieses eine Mal angezeigt.</Typography>
              <Paper variant="outlined" sx={{ p: 2, borderRadius: '18px', bgcolor: 'melon.sunk' }}>
                <Typography
                  className="recovery-key"
                  sx={{ fontFamily: monoFont, fontSize: { xs: '1rem', sm: '1.2rem' }, letterSpacing: '0.04em', wordBreak: 'break-all', lineHeight: 1.7 }}
                >
                  {recoveryKey}
                </Typography>
              </Paper>
              <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: 'wrap' }}>
                <Button variant="outlined" startIcon={<DownloadIcon />} onClick={download}>
                  Als Datei speichern
                </Button>
                <Button variant="outlined" startIcon={<ContentCopyIcon />} onClick={() => void navigator.clipboard.writeText(recoveryKey)}>
                  Kopieren
                </Button>
              </Stack>
              <Typography color="text.secondary" variant="body2">
                Am sichersten: ausdrucken oder abschreiben und bei deinen Unterlagen aufbewahren. Nicht in einer unverschlüsselten
                Cloud speichern.
              </Typography>
              <FormControlLabel
                control={<Checkbox checked={stored} onChange={(e) => setStored(e.target.checked)} />}
                label="Ich habe den Recovery-Key sicher aufbewahrt."
              />
            </Stack>
          </DialogContent>
          <DialogActions sx={{ px: 3, pb: 2.5 }}>
            <Button
              variant="contained"
              disabled={!stored}
              onClick={() => {
                setRecoveryKey(null);
                onDone(update);
              }}
            >
              Fertig
            </Button>
          </DialogActions>
        </>
      )}
    </Dialog>
  );
}
