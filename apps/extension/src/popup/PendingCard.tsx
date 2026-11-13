import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import MenuItem from '@mui/material/MenuItem';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { useState } from 'react';
import { ApiError } from '@web/api';
import { describeError } from '@web/session';
import { withHistory } from '@web/vault/item';
import { fromTrash } from '@web/vault/trash';
import { hostOf } from '../shared/match';
import type { PendingSave } from '../shared/messages';
import { dismissPending, existingFor, itemFromPending, refresh, type Unlocked } from './state';

export function PendingCard({
  unlocked,
  pending,
  onDone,
  onNever,
  outlined = true,
}: {
  unlocked: Unlocked;
  pending: PendingSave;
  onDone: (u: Unlocked, saved: boolean) => void;
  onNever?: () => void;
  outlined?: boolean;
}) {
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
        const base = fromTrash(current.item);
        const next = { ...base, fields: base.fields.map((f) => (f.id === 'password' ? { ...f, value: pending.password } : f)) };
        await unlocked.manager.saveItem(existing.vaultId, existing.id, withHistory(current.item, next));
      } else {
        await unlocked.manager.saveItem(space, null, itemFromPending(pending));
      }
      await dismissPending(pending);
      onDone(await refresh(unlocked), true);
    } catch (e) {
      setError(describeError(e));
      setBusy(false);
    }
  };

  return (
    <Paper variant="outlined" sx={{ p: 2, borderRadius: '14px', borderColor: outlined ? 'primary.main' : 'transparent' }}>
      <Stack spacing={1.5}>
        <Typography sx={{ fontWeight: 700 }}>
          {existing ? `Passwort für ${host} aktualisieren?` : `Neuen Login für ${host} speichern?`}
        </Typography>
        {pending.username && (
          <Typography variant="body2" color="text.secondary" noWrap>
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
        <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: 'wrap' }}>
          <Button variant="contained" size="small" loading={busy} onClick={() => void save()} disabled={!existing && !space}>
            {existing ? 'Aktualisieren' : 'Speichern'}
          </Button>
          <Button size="small" onClick={() => void dismissPending(pending).then(() => onDone(unlocked, false))} disabled={busy}>
            Nicht jetzt
          </Button>
          {onNever && (
            <Button size="small" onClick={onNever} disabled={busy} sx={{ color: 'text.secondary' }}>
              Nie für diese Seite
            </Button>
          )}
        </Stack>
      </Stack>
    </Paper>
  );
}
