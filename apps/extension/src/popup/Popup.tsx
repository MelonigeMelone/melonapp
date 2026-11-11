import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import CircularProgress from '@mui/material/CircularProgress';
import Divider from '@mui/material/Divider';
import IconButton from '@mui/material/IconButton';
import InputAdornment from '@mui/material/InputAdornment';
import List from '@mui/material/List';
import ListItem from '@mui/material/ListItem';
import ListItemText from '@mui/material/ListItemText';
import MenuItem from '@mui/material/MenuItem';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import LockOutlinedIcon from '@mui/icons-material/LockOutlined';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import PersonOutlineIcon from '@mui/icons-material/PersonOutlined';
import SearchIcon from '@mui/icons-material/Search';
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { ApiError } from '@web/api';
import { MelonMark } from '@web/components/Brand';
import { count } from '@web/layout';
import { describeError } from '@web/session';
import { withHistory } from '@web/vault/item';
import { anyUrlMatches, hostOf } from '../shared/match';
import type { Login, PendingSave, TabMessage } from '../shared/messages';
import {
  activeTab,
  dismissPending,
  existingFor,
  itemFromPending,
  loadPrefs,
  lockAll,
  normalizeServer,
  pendingSave,
  refresh,
  restore,
  unlock,
  type Unlocked,
} from './state';

function UnlockForm({ onUnlocked }: { onUnlocked: (u: Unlocked) => void }) {
  const [server, setServer] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void loadPrefs().then((p) => {
      setServer((v) => v || p.server);
      setEmail((v) => v || p.email);
    });
  }, []);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      onUnlocked(await unlock(normalizeServer(server), email.trim(), password));
      setPassword('');
    } catch (err) {
      setError(describeError(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Stack component="form" spacing={2} onSubmit={submit} sx={{ p: 2.5 }}>
      <Stack direction="row" spacing={1.25} sx={{ alignItems: 'center' }}>
        <MelonMark size={36} />
        <Typography variant="h6">MelonApp</Typography>
      </Stack>
      <TextField label="Server" placeholder="app.example.de" value={server} onChange={(e) => setServer(e.target.value)} size="small" autoComplete="url" />
      <TextField label="E-Mail" type="email" value={email} onChange={(e) => setEmail(e.target.value)} size="small" autoComplete="username" />
      <TextField
        label="Master-Passwort"
        type="password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        size="small"
        autoComplete="current-password"
        autoFocus={!!email}
      />
      {error && <Alert severity="error">{error}</Alert>}
      <Button type="submit" variant="contained" loading={busy} disabled={!server || !email || !password}>
        Entsperren
      </Button>
    </Stack>
  );
}

function LoginRow({ login, onFill, onCopy }: { login: Login; onFill?: () => void; onCopy: (what: string, value: string) => void }) {
  return (
    <ListItem
      disableGutters
      className="popup-login"
      secondaryAction={
        <Stack direction="row">
          <Tooltip title="Benutzername kopieren">
            <IconButton size="small" aria-label={`Benutzername von ${login.title} kopieren`} onClick={() => onCopy('Benutzername', login.username)}>
              <PersonOutlineIcon fontSize="small" />
            </IconButton>
          </Tooltip>
          <Tooltip title="Passwort kopieren">
            <IconButton size="small" aria-label={`Passwort von ${login.title} kopieren`} onClick={() => onCopy('Passwort', login.password)}>
              <ContentCopyIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        </Stack>
      }
      sx={{ pr: 10 }}
    >
      <ListItemText
        primary={login.title}
        secondary={login.username || hostOf(login.urls[0] ?? '') || ' '}
        slotProps={{ primary: { noWrap: true, sx: { fontWeight: 700 } }, secondary: { noWrap: true } }}
      />
      {onFill && (
        <Button size="small" variant="contained" onClick={onFill} sx={{ mr: 1, minHeight: 32 }}>
          Ausfüllen
        </Button>
      )}
    </ListItem>
  );
}

function PendingCard({ unlocked, pending, onDone }: { unlocked: Unlocked; pending: PendingSave; onDone: (u: Unlocked) => void }) {
  const writable = unlocked.snapshot.spaces.filter((s) => s.canWrite);
  const existing = existingFor(unlocked.snapshot, pending);
  const [space, setSpace] = useState(existing?.vaultId ?? writable[0]?.id ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const host = hostOf(pending.url) ?? pending.url;

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      if (existing) {
        const current = unlocked.manager.item(existing.vaultId, existing.id);
        if (!current) throw new ApiError(404, 'vault_not_found');
        const next = { ...current.item, fields: current.item.fields.map((f) => (f.id === 'password' ? { ...f, value: pending.password } : f)) };
        await unlocked.manager.saveItem(existing.vaultId, existing.id, withHistory(current.item, next));
      } else {
        await unlocked.manager.saveItem(space, null, itemFromPending(pending));
      }
      await dismissPending();
      onDone(await refresh(unlocked));
    } catch (e) {
      setError(describeError(e));
      setBusy(false);
    }
  };

  return (
    <Paper variant="outlined" sx={{ p: 2, borderRadius: '14px', borderColor: 'primary.main' }}>
      <Stack spacing={1.5}>
        <Typography sx={{ fontWeight: 700 }}>
          {existing ? `Passwort für ${host} aktualisieren?` : `Neuen Login für ${host} speichern?`}
        </Typography>
        {pending.username && (
          <Typography variant="body2" color="text.secondary">
            {pending.username}
          </Typography>
        )}
        {!existing && writable.length > 1 && (
          <TextField select size="small" label="Bereich" value={space} onChange={(e) => setSpace(e.target.value)}>
            {writable.map((s) => (
              <MenuItem key={s.id} value={s.id}>
                {s.name}
              </MenuItem>
            ))}
          </TextField>
        )}
        {error && <Alert severity="error">{error}</Alert>}
        <Stack direction="row" spacing={1}>
          <Button variant="contained" size="small" loading={busy} onClick={() => void save()} disabled={!existing && !space}>
            {existing ? 'Aktualisieren' : 'Speichern'}
          </Button>
          <Button size="small" onClick={() => void dismissPending().then(() => onDone(unlocked))} disabled={busy}>
            Verwerfen
          </Button>
        </Stack>
      </Stack>
    </Paper>
  );
}

function Vault({ unlocked, onLock, onChange }: { unlocked: Unlocked; onLock: () => void; onChange: (u: Unlocked) => void }) {
  const [tab, setTab] = useState<chrome.tabs.Tab | undefined>();
  const [pending, setPending] = useState<PendingSave | null>(null);
  const [query, setQuery] = useState('');
  const [toast, setToast] = useState<string | null>(null);
  const { snapshot } = unlocked;

  useEffect(() => {
    void activeTab().then(setTab);
    void pendingSave().then(setPending);
  }, [unlocked]);

  const here = useMemo(() => (tab?.url ? snapshot.logins.filter((l) => anyUrlMatches(tab.url as string, l.urls)) : []), [tab, snapshot.logins]);
  const q = query.trim().toLowerCase();
  const results = q
    ? snapshot.logins.filter((l) => [l.title, l.username, ...l.urls].some((v) => v.toLowerCase().includes(q)))
    : [];

  const copy = async (what: string, value: string) => {
    await navigator.clipboard.writeText(value);
    setToast(`${what} kopiert.`);
  };

  const fillTab = async (login: Login) => {
    if (!tab?.id) return;
    const msg: TabMessage = { type: 'fill', username: login.username, password: login.password, urls: login.urls };
    await chrome.tabs.sendMessage(tab.id, msg).catch(() => undefined);
    window.close();
  };

  return (
    <Stack spacing={2} sx={{ p: 2 }}>
      <Stack direction="row" sx={{ alignItems: 'center', gap: 1 }}>
        <MelonMark size={28} />
        <Typography variant="h6" sx={{ flex: 1 }}>
          MelonApp
        </Typography>
        <Tooltip title="MelonApp im Browser öffnen">
          <IconButton aria-label="MelonApp öffnen" onClick={() => void chrome.tabs.create({ url: `${snapshot.server}/#/passwoerter` })}>
            <OpenInNewIcon />
          </IconButton>
        </Tooltip>
        <Tooltip title="Sperren">
          <IconButton aria-label="Sperren" onClick={onLock}>
            <LockOutlinedIcon />
          </IconButton>
        </Tooltip>
      </Stack>

      {pending && (
        <PendingCard
          unlocked={unlocked}
          pending={pending}
          onDone={(u) => {
            setPending(null);
            onChange(u);
          }}
        />
      )}

      <TextField
        type="search"
        size="small"
        placeholder="Alle Logins durchsuchen"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        slotProps={{
          htmlInput: { 'aria-label': 'Logins durchsuchen' },
          input: {
            startAdornment: (
              <InputAdornment position="start">
                <SearchIcon fontSize="small" />
              </InputAdornment>
            ),
          },
        }}
      />

      {q ? (
        <List dense disablePadding>
          {results.map((l) => (
            <LoginRow key={`${l.vaultId}/${l.id}`} login={l} onCopy={(w, v) => void copy(w, v)} onFill={here.includes(l) ? () => void fillTab(l) : undefined} />
          ))}
          {results.length === 0 && <Typography color="text.secondary">Nichts gefunden.</Typography>}
        </List>
      ) : (
        <Box>
          <Typography variant="subtitle2" color="text.secondary">
            {tab?.url && hostOf(tab.url) ? `Für ${hostOf(tab.url)}` : 'Für diese Seite'}
          </Typography>
          <List dense disablePadding>
            {here.map((l) => (
              <LoginRow key={`${l.vaultId}/${l.id}`} login={l} onCopy={(w, v) => void copy(w, v)} onFill={() => void fillTab(l)} />
            ))}
          </List>
          {here.length === 0 && (
            <Typography variant="body2" color="text.secondary" sx={{ py: 1 }}>
              Kein Login für diese Seite. Suche oben nach einem anderen.
            </Typography>
          )}
        </Box>
      )}

      <Divider />
      <Typography variant="caption" color="text.secondary">
        {snapshot.email}, {count(snapshot.logins.length, 'Login', 'Logins')}
      </Typography>
      {toast && (
        <Alert severity="success" onClose={() => setToast(null)}>
          {toast}
        </Alert>
      )}
    </Stack>
  );
}

export function Popup() {
  const [state, setState] = useState<Unlocked | null | 'loading'>('loading');
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    restore()
      .then(setState)
      .catch(async (e: unknown) => {
        if (e instanceof ApiError && e.status === 401) setNotice('Die Sitzung ist abgelaufen. Bitte entsperre erneut.');
        await lockAll(null);
        setState(null);
      });
  }, []);

  if (state === 'loading') {
    return (
      <Box sx={{ display: 'grid', placeItems: 'center', minHeight: 240 }}>
        <CircularProgress aria-label="Lädt" />
      </Box>
    );
  }
  if (!state) {
    return (
      <>
        {notice && (
          <Alert severity="info" sx={{ m: 2, mb: 0 }}>
            {notice}
          </Alert>
        )}
        <UnlockForm onUnlocked={setState} />
      </>
    );
  }
  return (
    <Vault
      unlocked={state}
      onChange={setState}
      onLock={() => {
        void lockAll(state);
        setState(null);
      }}
    />
  );
}
