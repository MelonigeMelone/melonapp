import { useEffect, useRef, useState } from 'react';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import FingerprintIcon from '@mui/icons-material/Fingerprint';
import type { NativePlatform } from '../platform';
import type { Session } from '../session';

type Action = 'enable' | 'disable' | 'autofill';
type Feedback = { severity: 'success' | 'error'; text: string };

const FAILURE: Record<Action, string> = {
  enable: 'Einrichten nicht bestätigt. Prüfe die biometrischen Einstellungen und versuche es erneut.',
  disable: 'Deaktivieren nicht vollständig bestätigt. Bitte versuche es erneut.',
  autofill: 'AutoFill konnte nicht aktualisiert werden. Prüfe die Biometrie und versuche es erneut.',
};

export function BiometricSettings({ platform, session }: { platform: NativePlatform; session: Session }) {
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [busy, setBusy] = useState<Action | 'load' | null>('load');
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [failedAction, setFailedAction] = useState<Action | null>(null);
  const [reload, setReload] = useState(0);
  const generation = useRef(0);

  useEffect(() => {
    const current = ++generation.current;
    setConfigured(null);
    setBusy('load');
    setFeedback(null);
    setFailedAction(null);
    void platform.biometricStatus().then((value) => {
      if (generation.current === current) setConfigured(value);
    }).catch(() => {
      if (generation.current === current) setFeedback({ severity: 'error', text: 'Status konnte nicht geladen werden. Bitte erneut prüfen.' });
    }).finally(() => {
      if (generation.current === current) setBusy(null);
    });
    return () => { generation.current++; };
  }, [platform, session.userId, session.token, reload]);

  async function run(action: Action) {
    if (busy) return;
    const current = ++generation.current;
    setBusy(action);
    setFeedback(null);
    setFailedAction(null);
    try {
      if (action === 'enable') await platform.enableBiometric(session);
      else if (action === 'disable') await platform.disableBiometric();
      else await platform.publishAutofill(session);
      if (generation.current !== current) return;
      if (action !== 'autofill') {
        const value = await platform.biometricStatus();
        if (generation.current !== current) return;
        setConfigured(value);
        if (value !== (action === 'enable')) throw new Error('status_not_confirmed');
      }
      setFeedback({ severity: 'success', text: action === 'enable'
        ? 'Biometrisches Entsperren ist für dieses Konto auf diesem Gerät eingerichtet.'
        : action === 'disable'
          ? 'Biometrisches Entsperren wurde deaktiviert.'
          : 'AutoFill-Cache für 24 Stunden aktualisiert. Aktiviere MelonApp als AutoFill-Anbieter in den iOS-Einstellungen.' });
    } catch {
      if (generation.current !== current) return;
      try {
        const value = await platform.biometricStatus();
        if (generation.current !== current) return;
        setConfigured(value);
      } catch {
        if (generation.current !== current) return;
        setConfigured(null);
      }
      setFailedAction(action);
      setFeedback({ severity: 'error', text: FAILURE[action] });
    } finally {
      if (generation.current === current) setBusy(null);
    }
  }

  const status = busy === 'load' ? 'Status wird geprüft …' : configured === null ? 'Status unbekannt' : configured ? 'Einrichtung gespeichert' : 'Nicht eingerichtet';

  return (
    <Paper component="section" variant="outlined" aria-labelledby="biometric-heading" aria-busy={busy !== null} sx={{ borderRadius: '18px', p: { xs: 2, sm: 3 } }}>
      <Stack spacing={2.5}>
        <Stack direction="row" spacing={2} sx={{ alignItems: 'center' }}>
          <Box sx={{ p: 1.25, borderRadius: '14px', bgcolor: 'melon.sunk', color: 'primary.main', display: 'flex' }}><FingerprintIcon /></Box>
          <Stack spacing={0.75} sx={{ flex: 1, minWidth: 0 }}>
            <Typography id="biometric-heading" component="h2" variant="h6">Touch ID / Face ID</Typography>
            <Chip label={status} color={configured ? 'success' : 'default'} variant="outlined" size="small" sx={{ alignSelf: 'flex-start' }} />
          </Stack>
        </Stack>
        <Typography variant="body2" color="text.secondary">
          {configured
            ? 'Die Einrichtung ist für dieses Konto auf diesem Gerät gespeichert. Beim Entsperren prüft macOS oder iOS deine Biometrie erneut. Nach Änderungen an deinen Fingerabdrücken oder Face ID bitte neu einrichten.'
            : 'Entsperre deinen Tresor mit Touch ID oder Face ID. Dein Master-Passwort bleibt weiterhin nutzbar.'}
        </Typography>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} sx={{ flexWrap: 'wrap' }}>
          <Button variant="contained" disabled={busy !== null || configured === null} loading={busy === 'enable'} onClick={() => void run('enable')}>
            {configured ? 'Neu einrichten' : 'Auf diesem Gerät aktivieren'}
          </Button>
          {(configured || failedAction === 'disable') && <Button variant="outlined" disabled={busy !== null} loading={busy === 'disable'} onClick={() => void run('disable')}>Deaktivieren</Button>}
          {configured === null && busy === null && <Button variant="outlined" onClick={() => setReload((value) => value + 1)}>Status erneut prüfen</Button>}
        </Stack>
        {platform.supportsAutofill && <Button variant="outlined" disabled={busy !== null} loading={busy === 'autofill'} onClick={() => void run('autofill')}>Passwörter für iOS AutoFill aktualisieren</Button>}
        {feedback && <Alert severity={feedback.severity} role={feedback.severity === 'error' ? 'alert' : 'status'}>{feedback.text}</Alert>}
      </Stack>
    </Paper>
  );
}
