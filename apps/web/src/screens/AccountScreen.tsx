import Alert from '@mui/material/Alert';
import Avatar from '@mui/material/Avatar';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Collapse from '@mui/material/Collapse';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import Divider from '@mui/material/Divider';
import IconButton from '@mui/material/IconButton';
import InputAdornment from '@mui/material/InputAdornment';
import MenuItem from '@mui/material/MenuItem';
import Paper from '@mui/material/Paper';
import Snackbar from '@mui/material/Snackbar';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import ToggleButton from '@mui/material/ToggleButton';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';
import Typography from '@mui/material/Typography';
import { useColorScheme } from '@mui/material/styles';
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutlined';
import ContrastOutlinedIcon from '@mui/icons-material/ContrastOutlined';
import FingerprintIcon from '@mui/icons-material/Fingerprint';
import KeyOutlinedIcon from '@mui/icons-material/KeyOutlined';
import SupportOutlinedIcon from '@mui/icons-material/SupportOutlined';
import LockClockOutlinedIcon from '@mui/icons-material/LockClockOutlined';
import ShieldOutlinedIcon from '@mui/icons-material/ShieldOutlined';
import VisibilityIcon from '@mui/icons-material/Visibility';
import VisibilityOffIcon from '@mui/icons-material/VisibilityOff';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';
import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { StrengthMeter } from '../components/StrengthMeter';
import { cryptoCall } from '../crypto/client';
import { count } from '../layout';
import { AUTO_LOCK_CHOICES, setAutoLockMinutes, useAutoLockMinutes, type AutoLockMinutes } from '../prefs';
import { changePassword, describeError, type Account, type Session } from '../session';
import type { ShellContext } from '../Shell';
import { audit } from '../vault/audit';
import { SecurityCode } from './SpaceDialog';

const MIN_LENGTH = 12;

type Tone = 'ok' | 'warn' | 'neutral';

const TONE_SX: Record<Tone, object> = {
  ok: { bgcolor: 'melon.sunk', color: 'success.main' },
  warn: { bgcolor: 'primary.main', color: 'primary.contrastText' },
  neutral: { bgcolor: 'melon.sunk', color: 'text.secondary' },
};

function Row({ icon, tone, title, status, action, children, id }: { icon: ReactNode; tone: Tone; title: string; status: ReactNode; action?: ReactNode; children?: ReactNode; id: string }) {
  return (
    <Box component="li" className="account-row" data-row={id} sx={{ listStyle: 'none', px: { xs: 2, sm: 2.5 }, py: 2 }}>
      <Stack direction="row" spacing={2} sx={{ alignItems: 'center', flexWrap: { xs: 'wrap', sm: 'nowrap' }, rowGap: 1.5 }}>
        <Box sx={{ flex: 'none', width: 44, height: 44, borderRadius: '14px', display: 'grid', placeItems: 'center', ...TONE_SX[tone] }} aria-hidden="true">
          {icon}
        </Box>
        <Stack spacing={0.25} sx={{ flex: 1, minWidth: { xs: 'calc(100% - 64px)', sm: 0 } }}>
          <Typography component="h3" sx={{ fontWeight: 700 }} id={`row-${id}`}>
            {title}
          </Typography>
          <Typography variant="body2" color="text.secondary" component="div">
            {status}
          </Typography>
        </Stack>
        {action && <Box sx={{ flex: { xs: '1 1 100%', sm: 'none' }, boxSizing: 'border-box', pl: { xs: 7.5, sm: 0 }, width: { sm: 200 }, ml: { xs: '0 !important', sm: '16px !important' } }}>{action}</Box>}
      </Stack>
      {children}
    </Box>
  );
}

function Section({ title, id, children }: { title: string; id: string; children: ReactNode }) {
  return (
    <Box component="section" aria-labelledby={id}>
      <Typography id={id} variant="h3" component="h2" sx={{ mb: 1.5, fontSize: '1.25rem' }}>
        {title}
      </Typography>
      <Paper variant="outlined" sx={{ borderRadius: '18px', overflow: 'hidden' }}>
        <Stack component="ul" divider={<Divider component="li" aria-hidden="true" sx={{ height: 0, listStyle: 'none' }} />} sx={{ m: 0, p: 0 }}>
          {children}
        </Stack>
      </Paper>
    </Box>
  );
}

function PasswordInput({ label, value, onChange, autoComplete, autoFocus, error, helperText }: { label: string; value: string; onChange: (v: string) => void; autoComplete: string; autoFocus?: boolean; error?: boolean; helperText?: ReactNode }) {
  const [visible, setVisible] = useState(false);
  return (
    <TextField
      label={label}
      type={visible ? 'text' : 'password'}
      autoComplete={autoComplete}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      autoFocus={autoFocus}
      error={error}
      helperText={helperText}
      fullWidth
      slotProps={{
        input: {
          endAdornment: (
            <InputAdornment position="end">
              <IconButton aria-label={visible ? `${label} verbergen` : `${label} anzeigen`} onClick={() => setVisible(!visible)} edge="end">
                {visible ? <VisibilityOffIcon /> : <VisibilityIcon />}
              </IconButton>
            </InputAdornment>
          ),
        },
      }}
    />
  );
}

function ChangePasswordDialog({ session, onClose, onChanged }: { session: Session; onClose: () => void; onChanged: (update: Partial<Account>) => void }) {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [repeat, setRepeat] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const tooShort = next.length > 0 && next.length < MIN_LENGTH;
  const mismatch = repeat.length > 0 && repeat !== next;
  const same = next.length > 0 && next === current;
  const ready = !!current && next.length >= MIN_LENGTH && next === repeat && !same;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!ready) return;
    setBusy(true);
    setError(null);
    try {
      onChanged(await changePassword(session, current, next));
    } catch (err) {
      setError(describeError(err));
      setBusy(false);
    }
  };

  return (
    <Dialog open onClose={busy ? undefined : onClose} fullWidth maxWidth="sm" aria-labelledby="pw-title">
      <form onSubmit={submit} noValidate>
        <DialogTitle id="pw-title">Master-Passwort ändern</DialogTitle>
        <DialogContent>
          <Stack spacing={2.5}>
            <Typography color="text.secondary">
              Deine anderen Geräte werden abgemeldet und brauchen dann das neue Passwort. Dein Notfall-Kit und deine Bereiche bleiben, wie sie sind.
            </Typography>
            <PasswordInput label="Aktuelles Master-Passwort" value={current} onChange={setCurrent} autoComplete="current-password" autoFocus />
            <Stack spacing={1}>
              <PasswordInput
                label="Neues Master-Passwort"
                value={next}
                onChange={setNext}
                autoComplete="new-password"
                error={tooShort || same}
                helperText={same ? 'Das ist dein aktuelles Passwort.' : `Mindestens ${MIN_LENGTH} Zeichen. Gut merkbar: mehrere Wörter mit Leerzeichen.`}
              />
              <StrengthMeter password={next} />
            </Stack>
            <PasswordInput
              label="Neues Master-Passwort wiederholen"
              value={repeat}
              onChange={setRepeat}
              autoComplete="new-password"
              error={mismatch}
              helperText={mismatch ? 'Stimmt noch nicht überein.' : repeat && repeat === next ? 'Stimmt überein.' : ' '}
            />
            {error && <Alert severity="error">{error}</Alert>}
          </Stack>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2.5 }}>
          <Button onClick={onClose} disabled={busy}>
            Abbrechen
          </Button>
          <Button type="submit" variant="contained" loading={busy} disabled={!ready}>
            Master-Passwort ändern
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  );
}

const MODE_LABELS = { system: 'System', light: 'Hell', dark: 'Dunkel' } as const;

export function AccountScreen({ ctx, onUpdate }: { ctx: ShellContext; onUpdate: (update: Partial<Account>) => void }) {
  const { session, snapshot, navigate, openKit } = ctx;
  const [code, setCode] = useState('');
  const [showCode, setShowCode] = useState(false);
  const [changing, setChanging] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const autoLock = useAutoLockMinutes();
  const { mode, setMode } = useColorScheme();
  const report = useMemo(() => audit(snapshot.items), [snapshot.items]);
  const issues = report.weak.length + report.reused.reduce((n, g) => n + g.length, 0);
  const host = window.location.host;

  useEffect(() => {
    void cryptoCall('fingerprint', { publicKey: session.publicKey }).then(setCode);
  }, [session.publicKey]);

  return (
    <Box component="main" sx={{ maxWidth: '48rem', mx: 'auto', px: { xs: 2, md: 4 }, py: { xs: 3, md: 6 } }}>
      <Stack spacing={4}>
        <Stack direction="row" spacing={2} sx={{ alignItems: 'center' }}>
          <Avatar sx={{ width: 64, height: 64, bgcolor: 'secondary.main', color: 'secondary.contrastText', fontSize: '1.75rem', fontWeight: 700 }} aria-hidden="true">
            {session.email.slice(0, 1).toUpperCase()}
          </Avatar>
          <Stack sx={{ flex: 1, minWidth: 0 }}>
            <Typography variant="h1" sx={{ fontSize: { xs: '1.75rem', md: '2.25rem' } }}>
              Konto
            </Typography>
            <Typography color="text.secondary" noWrap title={session.email}>
              {session.email}
            </Typography>
            <Typography color="text.secondary" variant="body2" noWrap>
              Server: {host}
            </Typography>
          </Stack>
        </Stack>

        {!session.hasRecovery && (
          <Alert
            severity="warning"
            action={
              <Button color="inherit" variant="outlined" size="small" onClick={openKit} sx={{ whiteSpace: 'nowrap' }}>
                Jetzt erstellen
              </Button>
            }
          >
            <strong>Noch kein Notfall-Kit.</strong> Vergisst du dein Master-Passwort, kann niemand deine Daten zurückholen, auch nicht der Server.
          </Alert>
        )}

        <Section title="Sicherheit" id="account-security">
          <Row
            id="kit"
            icon={session.hasRecovery ? <SupportOutlinedIcon /> : <WarningAmberIcon />}
            tone={session.hasRecovery ? 'ok' : 'warn'}
            title="Notfall-Kit"
            status={session.hasRecovery ? 'Eingerichtet. Damit kommst du auch ohne Master-Passwort wieder an deine Daten.' : 'Fehlt. Ohne Kit ist ein vergessenes Master-Passwort endgültig.'}
            action={
              <Button variant={session.hasRecovery ? 'outlined' : 'contained'} onClick={openKit} fullWidth>
                {session.hasRecovery ? 'Neu erstellen' : 'Erstellen'}
              </Button>
            }
          />
          <Row
            id="password"
            icon={<KeyOutlinedIcon />}
            tone="neutral"
            title="Master-Passwort"
            status="Schützt alle deine Daten. Nur du kennst es, der Server nie."
            action={
              <Button variant="outlined" onClick={() => setChanging(true)} fullWidth>
                Ändern
              </Button>
            }
          />
          <Row
            id="audit"
            icon={issues > 0 ? <ShieldOutlinedIcon /> : <CheckCircleOutlineIcon />}
            tone={issues > 0 ? 'warn' : 'ok'}
            title="Gespeicherte Passwörter"
            status={
              report.checked === 0
                ? 'Noch keine Passwörter gespeichert.'
                : issues > 0
                  ? `${count(issues, 'Hinweis', 'Hinweise')}: schwache oder mehrfach verwendete Passwörter.`
                  : `${count(report.checked, 'Passwort', 'Passwörter')} geprüft, alles in Ordnung.`
            }
            action={
              report.checked > 0 && (
                <Button variant={issues > 0 ? 'contained' : 'outlined'} onClick={() => navigate('passwoerter/sicherheit')} fullWidth>
                  {issues > 0 ? 'Ansehen' : 'Sicherheits-Check'}
                </Button>
              )
            }
          />
          <Row
            id="code"
            icon={<FingerprintIcon />}
            tone="neutral"
            title="Dein Sicherheitscode"
            status="Zum Vergleichen, wenn dich jemand zu einem Bereich hinzufügt."
            action={
              <Button variant="outlined" onClick={() => setShowCode(!showCode)} aria-expanded={showCode} aria-controls="security-code-panel" fullWidth>
                {showCode ? 'Verbergen' : 'Anzeigen'}
              </Button>
            }
          >
            <Collapse in={showCode} id="security-code-panel">
              <Box sx={{ mt: 2, ml: { sm: 7.5 }, p: 2, borderRadius: '14px', bgcolor: 'melon.sunk' }}>
                <SecurityCode code={code} />
                <Typography variant="body2" color="text.secondary">
                  Lies ihn der anderen Person vor oder vergleicht ihn nebeneinander. Stimmt er überein, hat niemand unterwegs einen falschen Schlüssel untergeschoben.
                </Typography>
              </Box>
            </Collapse>
          </Row>
        </Section>

        <Section title="Einstellungen" id="account-settings">
          <Row
            id="autolock"
            icon={<LockClockOutlinedIcon />}
            tone="neutral"
            title="Automatisch sperren"
            status="Nach so langer Zeit ohne Eingabe auf diesem Gerät."
            action={
              <TextField
                select
                size="small"
                value={autoLock}
                onChange={(e) => setAutoLockMinutes(Number(e.target.value) as AutoLockMinutes)}
                slotProps={{ htmlInput: { 'aria-labelledby': 'row-autolock' } }}
                fullWidth
              >
                {AUTO_LOCK_CHOICES.map((m) => (
                  <MenuItem key={m} value={m}>
                    {count(m, 'Minute', 'Minuten')}
                  </MenuItem>
                ))}
              </TextField>
            }
          />
          <Row
            id="mode"
            icon={<ContrastOutlinedIcon />}
            tone="neutral"
            title="Darstellung"
            status="Hell, dunkel oder passend zum System."
            action={
              <ToggleButtonGroup
                exclusive
                size="small"
                value={mode ?? 'system'}
                onChange={(_, v: keyof typeof MODE_LABELS | null) => v && setMode(v)}
                aria-labelledby="row-mode"
                fullWidth
              >
                {(Object.keys(MODE_LABELS) as (keyof typeof MODE_LABELS)[]).map((m) => (
                  <ToggleButton key={m} value={m} sx={{ px: 1.5, whiteSpace: 'nowrap' }}>
                    {MODE_LABELS[m]}
                  </ToggleButton>
                ))}
              </ToggleButtonGroup>
            }
          />
        </Section>
      </Stack>

      {changing && (
        <ChangePasswordDialog
          session={session}
          onClose={() => setChanging(false)}
          onChanged={(update) => {
            onUpdate(update);
            setChanging(false);
            setToast('Master-Passwort geändert. Andere Geräte wurden abgemeldet.');
          }}
        />
      )}
      <Snackbar open={toast !== null} autoHideDuration={6000} onClose={() => setToast(null)} message={toast} anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }} sx={{ bottom: { xs: 88, md: 24 } }} />
    </Box>
  );
}
