import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import Collapse from '@mui/material/Collapse';
import IconButton from '@mui/material/IconButton';
import InputAdornment from '@mui/material/InputAdornment';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import AutoFixHighIcon from '@mui/icons-material/AutoFixHigh';
import VisibilityIcon from '@mui/icons-material/Visibility';
import VisibilityOffIcon from '@mui/icons-material/VisibilityOff';
import { useState, type FormEvent } from 'react';
import { Generator } from '../components/Generator';
import { monoFont } from '../theme';
import { describeError } from '../session';
import { emptyEntry, normalizeUrl, type PasswordEntry } from '../vault/entry';

export function EntryEditor({
  initial,
  isNew,
  onSave,
  onCancel,
}: {
  initial: PasswordEntry | null;
  isNew: boolean;
  onSave: (entry: PasswordEntry) => Promise<void>;
  onCancel: () => void;
}) {
  const base = initial ?? emptyEntry();
  const [title, setTitle] = useState(base.title);
  const [username, setUsername] = useState(base.username);
  const [password, setPassword] = useState(base.password);
  const [urls, setUrls] = useState(base.urls.join('\n'));
  const [notes, setNotes] = useState(base.notes);
  const [showPassword, setShowPassword] = useState(isNew);
  const [showGenerator, setShowGenerator] = useState(isNew && !base.password);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [titleMissing, setTitleMissing] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!title.trim()) {
      setTitleMissing(true);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await onSave({
        ...base,
        title: title.trim(),
        username: username.trim(),
        password,
        urls: urls.split('\n').map(normalizeUrl).filter(Boolean),
        notes,
      });
    } catch (err) {
      setError(describeError(err));
      setSaving(false);
    }
  }

  return (
    <Stack component="form" spacing={2.5} onSubmit={submit} noValidate sx={{ maxWidth: '42rem' }}>
      <Typography variant="h2" sx={{ fontSize: { xs: '1.875rem', md: '2.25rem' } }}>
        {isNew ? 'Neuer Eintrag' : 'Eintrag bearbeiten'}
      </Typography>

      <TextField
        label="Titel"
        placeholder="z. B. GitHub"
        value={title}
        onChange={(e) => {
          setTitle(e.target.value);
          setTitleMissing(false);
        }}
        error={titleMissing}
        helperText={titleMissing ? 'Gib dem Eintrag einen Titel.' : undefined}
        autoFocus
        fullWidth
      />
      <TextField
        label="Benutzername oder E-Mail"
        value={username}
        onChange={(e) => setUsername(e.target.value)}
        autoComplete="off"
        slotProps={{ htmlInput: { spellCheck: false } }}
        fullWidth
      />
      <TextField
        id="entry-password"
        label="Passwort"
        type={showPassword ? 'text' : 'password'}
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        autoComplete="new-password"
        fullWidth
        slotProps={{
          htmlInput: { spellCheck: false, style: { fontFamily: monoFont } },
          input: {
            endAdornment: (
              <InputAdornment position="end">
                <Tooltip title={showPassword ? 'Verbergen' : 'Anzeigen'}>
                  <IconButton
                    aria-label={showPassword ? 'Passwort verbergen' : 'Passwort anzeigen'}
                    aria-pressed={showPassword}
                    onClick={() => setShowPassword(!showPassword)}
                    edge="end"
                  >
                    {showPassword ? <VisibilityOffIcon /> : <VisibilityIcon />}
                  </IconButton>
                </Tooltip>
                <Tooltip title="Passwort generieren">
                  <IconButton
                    aria-label="Passwort generieren"
                    aria-expanded={showGenerator}
                    onClick={() => setShowGenerator(!showGenerator)}
                    color={showGenerator ? 'primary' : 'default'}
                  >
                    <AutoFixHighIcon />
                  </IconButton>
                </Tooltip>
              </InputAdornment>
            ),
          },
        }}
      />

      <Collapse in={showGenerator} unmountOnExit>
        <Generator
          onUse={(pw) => {
            setPassword(pw);
            setShowPassword(true);
            setShowGenerator(false);
          }}
        />
      </Collapse>

      <TextField
        label="Websites, eine pro Zeile"
        placeholder="github.com"
        value={urls}
        onChange={(e) => setUrls(e.target.value)}
        multiline
        minRows={2}
        slotProps={{ htmlInput: { spellCheck: false } }}
        fullWidth
      />
      <TextField label="Notizen" value={notes} onChange={(e) => setNotes(e.target.value)} multiline minRows={4} fullWidth />

      {error && <Alert severity="error">{error}</Alert>}

      <Stack direction="row" spacing={1}>
        <Button type="submit" variant="contained" loading={saving}>
          Speichern
        </Button>
        <Button onClick={onCancel} disabled={saving} sx={{ color: 'text.secondary' }}>
          Abbrechen
        </Button>
      </Stack>
    </Stack>
  );
}
