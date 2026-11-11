import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import Checkbox from '@mui/material/Checkbox';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import Divider from '@mui/material/Divider';
import FormControlLabel from '@mui/material/FormControlLabel';
import IconButton from '@mui/material/IconButton';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import CloseIcon from '@mui/icons-material/Close';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import DownloadIcon from '@mui/icons-material/Download';
import { useEffect, useState, type FormEvent } from 'react';
import { cryptoCall } from '../crypto/client';
import { changePassword, describeError, setupRecovery, type Account, type Session } from '../session';
import { monoFont } from '../theme';
import { SecurityCode } from './VaultDialog';

const MIN_LENGTH = 12;

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
                Mit dem Recovery-Key setzt du ein neues Master-Passwort, falls du deins vergisst. Ohne ihn ist dein Tresor dann
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

function PasswordChange({ session, onChanged }: { session: Session; onChanged: (update: Partial<Account>) => void }) {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [repeat, setRepeat] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setDone(false);
    if (next.length < MIN_LENGTH) return setError(`Das neue Master-Passwort braucht mindestens ${MIN_LENGTH} Zeichen.`);
    if (next !== repeat) return setError('Die beiden neuen Passwörter stimmen nicht überein.');
    setBusy(true);
    try {
      onChanged(await changePassword(session, current, next));
      setCurrent('');
      setNext('');
      setRepeat('');
      setDone(true);
    } catch (err) {
      setError(describeError(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Stack component="form" spacing={1.5} onSubmit={submit} noValidate>
      <Typography variant="h3" sx={{ fontSize: '1.125rem' }}>
        Master-Passwort ändern
      </Typography>
      <TextField label="Aktuelles Master-Passwort" type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} size="small" fullWidth />
      <TextField label="Neues Master-Passwort" type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} size="small" fullWidth />
      <TextField label="Neues Master-Passwort wiederholen" type="password" autoComplete="new-password" value={repeat} onChange={(e) => setRepeat(e.target.value)} size="small" fullWidth />
      {error && <Alert severity="error">{error}</Alert>}
      {done && <Alert severity="success">Master-Passwort geändert. Andere Geräte wurden abgemeldet.</Alert>}
      <Button type="submit" variant="outlined" loading={busy} disabled={!current || !next} sx={{ alignSelf: 'flex-start' }}>
        Master-Passwort ändern
      </Button>
    </Stack>
  );
}

export function AccountDialog({
  session,
  onUpdate,
  onClose,
  onCreateKit,
}: {
  session: Session;
  onUpdate: (update: Partial<Account>) => void;
  onClose: () => void;
  onCreateKit: () => void;
}) {
  const [code, setCode] = useState('');

  useEffect(() => {
    void cryptoCall('fingerprint', { publicKey: session.publicKey }).then(setCode);
  }, [session.publicKey]);

  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="sm" aria-labelledby="account-title">
      <DialogTitle id="account-title" sx={{ pr: 7 }}>
        Konto
        <IconButton aria-label="Schließen" onClick={onClose} sx={{ position: 'absolute', right: 12, top: 12 }}>
          <CloseIcon />
        </IconButton>
      </DialogTitle>
      <DialogContent>
        <Stack spacing={3}>
          <Typography color="text.secondary">{session.email}</Typography>

          <section>
            <Typography variant="h3" sx={{ fontSize: '1.125rem' }}>
              Dein Sicherheitscode
            </Typography>
            <SecurityCode code={code} />
            <Typography color="text.secondary" variant="body2">
              Wenn dich jemand zu einem Tresor hinzufügt, sieht diese Person deinen Code. Vergleicht ihn zusammen, damit niemand
              unbemerkt einen falschen Schlüssel unterschieben kann.
            </Typography>
          </section>

          <Divider />

          <Stack spacing={1.5}>
            <Typography variant="h3" sx={{ fontSize: '1.125rem' }}>
              Notfall-Kit
            </Typography>
            {session.hasRecovery ? (
              <Alert severity="success">Du hast ein Notfall-Kit. Damit kommst du auch ohne Master-Passwort wieder an deinen Tresor.</Alert>
            ) : (
              <Alert severity="warning">Noch kein Notfall-Kit. Vergisst du dein Master-Passwort, ist dein Tresor verloren.</Alert>
            )}
            <Button variant="outlined" onClick={onCreateKit} sx={{ alignSelf: 'flex-start' }}>
              {session.hasRecovery ? 'Neues Notfall-Kit erstellen' : 'Notfall-Kit erstellen'}
            </Button>
          </Stack>

          <Divider />

          <PasswordChange session={session} onChanged={onUpdate} />
        </Stack>
      </DialogContent>
    </Dialog>
  );
}
