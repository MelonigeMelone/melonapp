import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import Tab from '@mui/material/Tab';
import Tabs from '@mui/material/Tabs';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { useState, type FormEvent } from 'react';
import { MelonMark } from '../components/Brand';
import { describeError, login, register, type Session } from '../session';

type Mode = 'login' | 'register';
const MIN_LENGTH = 12;

export function AuthScreen({
  initialEmail,
  notice,
  onSession,
}: {
  initialEmail: string;
  notice: string | null;
  onSession: (s: Session) => void;
}) {
  const [mode, setMode] = useState<Mode>('login');
  const [email, setEmail] = useState(initialEmail);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const switchMode = (m: Mode) => {
    setMode(m);
    setError(null);
    setConfirm('');
  };

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (mode === 'register') {
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
      const session = await (mode === 'login' ? login : register)(email.trim(), password);
      setPassword('');
      setConfirm('');
      onSession(session);
    } catch (err) {
      setError(describeError(err));
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
          Deine Passwörter, nur für dich lesbar. Verschlüsselt wird auf diesem Gerät, der Server sieht nichts davon.
        </Typography>
      </Box>

      <Paper variant="outlined" sx={{ p: { xs: 2.5, sm: 3.5 }, borderRadius: '18px' }}>
        <Stack component="form" spacing={2.5} onSubmit={submit} noValidate>
          <Tabs
            value={mode}
            onChange={(_, m: Mode) => switchMode(m)}
            aria-label="Anmelden oder Konto erstellen"
            variant="fullWidth"
          >
            <Tab value="login" label="Anmelden" />
            <Tab value="register" label="Konto erstellen" />
          </Tabs>

          {notice && mode === 'login' && <Alert severity="info">{notice}</Alert>}

          <TextField
            label="E-Mail"
            type="email"
            autoComplete="username"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            fullWidth
          />
          <TextField
            label="Master-Passwort"
            type="password"
            autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
            autoFocus={!!initialEmail}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            fullWidth
          />
          {mode === 'register' && (
            <TextField
              label="Master-Passwort wiederholen"
              type="password"
              autoComplete="new-password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              helperText={`Mindestens ${MIN_LENGTH} Zeichen. Am sichersten sind vier bis sechs zufällige Wörter. Ohne Master-Passwort kommt niemand an deine Daten, auch du nicht.`}
              fullWidth
            />
          )}

          {error && (
            <Alert severity="error" role="alert">
              {error}
            </Alert>
          )}

          <Button type="submit" variant="contained" size="large" loading={busy} fullWidth>
            {mode === 'login' ? 'Tresor öffnen' : 'Konto erstellen'}
          </Button>
        </Stack>
      </Paper>
    </Box>
  );
}
