import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import Tab from '@mui/material/Tab';
import Tabs from '@mui/material/Tabs';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { useEffect, useState, type FormEvent } from 'react';
import { api } from '../api';
import { MelonMark } from '../components/Brand';
import { monoFont } from '../theme';
import { describeError, login, recoverAccount, register, type Session } from '../session';
import { ApiError } from '../api';

import { nativePlatform } from '../platform';

type Mode = 'login' | 'register' | 'recover';
const MIN_LENGTH = 12;

export function AuthScreen({
  initialEmail,
  notice,
  inviteToken,
  onSession,
}: {
  initialEmail: string;
  notice: string | null;
  inviteToken: string | null;
  onSession: (s: Session) => void;
}) {
  const platform = nativePlatform();
  const [server, setServer] = useState(platform?.server ?? '');
  const [mode, setMode] = useState<Mode>(inviteToken ? 'register' : 'login');
  const [inviter, setInviter] = useState<string | null>(null);
  const [inviteError, setInviteError] = useState(false);
  const [email, setEmail] = useState(initialEmail);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [recoveryKey, setRecoveryKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!inviteToken) return;
    api
      .invitePreview(inviteToken)
      .then((p) => {
        setEmail(p.email);
        setInviter(p.invited_by);
      })
      .catch(() => setInviteError(true));
  }, [inviteToken]);

  const switchMode = (m: Mode) => {
    setMode(m);
    setError(null);
    setConfirm('');
  };

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (mode !== 'login') {
      if (password.length < MIN_LENGTH) {
        setError(`Das Master-Passwort braucht mindestens ${MIN_LENGTH} Zeichen.`);
        return;
      }
      if (password !== confirm) {
        setError('Die beiden Passwörter stimmen nicht überein.');
        return;
      }
    }
    setBusy(true);
    try {
      if (platform) await platform.setServer(server);
      const session =
        mode === 'login'
          ? await login(email.trim(), password)
          : mode === 'recover'
            ? await recoverAccount(email.trim(), recoveryKey, password)
            : await register(email.trim(), password, inviter ? inviteToken : null);
      setRecoveryKey('');
      setPassword('');
      setConfirm('');
      onSession(session);
    } catch (err) {
      setError(
        mode === 'recover' && err instanceof ApiError && err.status === 401
          ? 'E-Mail oder Recovery-Key stimmt nicht.'
          : describeError(err),
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <Box
      component="main"
      sx={{
        minHeight: '100dvh',
        maxWidth: '64rem',
        mx: 'auto',
        px: 2,
        py: { xs: 4, md: 8 },
        display: 'grid',
        gridTemplateColumns: { xs: '1fr', md: 'minmax(0, 1fr) minmax(0, 26rem)' },
        gap: { xs: 4, md: 12 },
        alignItems: 'center',
        alignContent: 'center',
      }}
    >
      <Box>
        <MelonMark size={72} />
        <Typography variant="h1" sx={{ mt: 2, fontSize: { xs: '2.25rem', md: '3.25rem' } }}>
          MelonApp
        </Typography>
        <Typography variant="h3" component="p" color="text.secondary" sx={{ mt: 1.5, maxWidth: '30ch', fontFamily: 'inherit', fontWeight: 400, fontSize: '1.25rem', lineHeight: 1.5 }}>
          Deine persönliche App für Passwörter und mehr. Verschlüsselt wird auf diesem Gerät, der Server sieht nichts davon.
        </Typography>
      </Box>

      <Paper variant="outlined" sx={{ p: { xs: 2.5, sm: 3.5 }, borderRadius: '18px' }}>
        <Stack component="form" spacing={2.5} onSubmit={submit} noValidate>
          {mode === 'recover' ? (
            <Stack spacing={1}>
              <Typography variant="h3" component="h2" sx={{ fontSize: '1.375rem' }}>
                Master-Passwort vergessen
              </Typography>
              <Typography color="text.secondary" variant="body2">
                Mit dem Recovery-Key aus deinem Notfall-Kit setzt du ein neues Master-Passwort. Deine Bereiche und Einträge bleiben erhalten.
              </Typography>
            </Stack>
          ) : (
          <Tabs
            value={mode}
            onChange={(_, m: Mode) => switchMode(m)}
            aria-label="Anmelden oder Konto erstellen"
            variant="fullWidth"
          >
            <Tab value="login" label="Anmelden" />
            <Tab value="register" label="Konto erstellen" />
          </Tabs>
          )}

          {platform && <TextField label="Server-Adresse (HTTPS)" value={server} onChange={(e) => setServer(e.target.value)} disabled={busy} fullWidth />}
          {platform && mode === 'login' && <Button disabled={busy} onClick={async () => {
            setBusy(true);
            try { await platform.setServer(server); onSession(await platform.unlockBiometric()); }
            catch { setError('Biometrisches Entsperren nicht verfügbar. Melde dich mit dem Master-Passwort an.'); }
            finally { setBusy(false); }
          }}>Mit Touch ID / Face ID entsperren</Button>}
          {notice && mode === 'login' && <Alert severity="info">{notice}</Alert>}
          {inviter && mode === 'register' && (
            <Alert severity="success">
              {inviter} hat dich eingeladen. Leg dein Konto an, dann bekommst du Zugriff auf den geteilten Bereich.
            </Alert>
          )}
          {inviteError && (
            <Alert severity="warning">Der Einladungslink ist abgelaufen oder wurde schon benutzt. Bitte um einen neuen.</Alert>
          )}

          <TextField
            label="E-Mail"
            type="email"
            autoComplete="username"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            slotProps={{ htmlInput: { readOnly: !!inviter && mode === 'register' } }}
            fullWidth
          />
          {mode === 'recover' && (
            <TextField
              label="Recovery-Key"
              value={recoveryKey}
              onChange={(e) => setRecoveryKey(e.target.value)}
              placeholder="ABCD-EFGH-…"
              autoComplete="off"
              multiline
              minRows={2}
              slotProps={{ htmlInput: { spellCheck: false, style: { fontFamily: monoFont, letterSpacing: '0.04em' } } }}
              fullWidth
            />
          )}
          <TextField
            label={mode === 'recover' ? 'Neues Master-Passwort' : 'Master-Passwort'}
            type="password"
            autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
            autoFocus={!!initialEmail}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            fullWidth
          />
          {mode !== 'login' && (
            <TextField
              label={mode === 'recover' ? 'Neues Master-Passwort wiederholen' : 'Master-Passwort wiederholen'}
              type="password"
              autoComplete="new-password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              helperText={
                mode === 'recover'
                  ? `Mindestens ${MIN_LENGTH} Zeichen. Danach sind alle deine Geräte abgemeldet.`
                  : `Mindestens ${MIN_LENGTH} Zeichen. Am sichersten sind vier bis sechs zufällige Wörter. Ohne Master-Passwort kommt niemand an deine Daten, auch du nicht.`
              }
              fullWidth
            />
          )}

          {error && (
            <Alert severity="error" role="alert">
              {error}
            </Alert>
          )}

          <Button type="submit" variant="contained" size="large" loading={busy} fullWidth>
            {mode === 'login' ? 'Entsperren' : mode === 'recover' ? 'Neues Master-Passwort setzen' : 'Konto erstellen'}
          </Button>
          {mode === 'login' && (
            <Button onClick={() => switchMode('recover')} sx={{ alignSelf: 'center', color: 'text.secondary' }}>
              Master-Passwort vergessen?
            </Button>
          )}
          {mode === 'recover' && (
            <Button onClick={() => switchMode('login')} sx={{ alignSelf: 'center', color: 'text.secondary' }}>
              Zurück zur Anmeldung
            </Button>
          )}
        </Stack>
      </Paper>
    </Box>
  );
}
