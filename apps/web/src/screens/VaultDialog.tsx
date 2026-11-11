import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import Divider from '@mui/material/Divider';
import IconButton from '@mui/material/IconButton';
import InputAdornment from '@mui/material/InputAdornment';
import List from '@mui/material/List';
import ListItem from '@mui/material/ListItem';
import ListItemText from '@mui/material/ListItemText';
import MenuItem from '@mui/material/MenuItem';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import CloseIcon from '@mui/icons-material/Close';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import type { InviteInfo, Role } from '../api';
import { describeError } from '../session';
import type { VaultsManager, VaultView } from '../vault/manager';

export const ROLE_LABELS: Record<Role, string> = { owner: 'Besitzer', editor: 'Bearbeiter', viewer: 'Betrachter' };
const ROLES: Role[] = ['viewer', 'editor', 'owner'];

export function inviteLink(token: string): string {
  return `${window.location.origin}/#/invite/${token}`;
}

export function NewVaultDialog({
  open,
  onClose,
  onCreate,
}: {
  open: boolean;
  onClose: () => void;
  onCreate: (name: string) => Promise<void>;
}) {
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    try {
      await onCreate(name.trim());
      setName('');
      onClose();
    } catch (err) {
      setError(describeError(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="xs">
      <form onSubmit={submit}>
        <DialogTitle>Neuer Tresor</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ pt: 1 }}>
            <TextField label="Name" placeholder="z. B. Familie" value={name} onChange={(e) => setName(e.target.value)} autoFocus fullWidth />
            <Typography variant="body2" color="text.secondary">
              Danach kannst du andere einladen. Jeder Tresor hat einen eigenen Schlüssel.
            </Typography>
            {error && <Alert severity="error">{error}</Alert>}
          </Stack>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2.5 }}>
          <Button onClick={onClose}>Abbrechen</Button>
          <Button type="submit" variant="contained" loading={busy} disabled={!name.trim()}>
            Tresor anlegen
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  );
}

export function VaultDialog({
  vault,
  manager,
  me,
  onClose,
}: {
  vault: VaultView;
  manager: VaultsManager;
  me: string;
  onClose: () => void;
}) {
  const [name, setName] = useState(vault.name);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<Role>('editor');
  const [invites, setInvites] = useState<InviteInfo[]>([]);
  const [link, setLink] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<{ kind: 'remove'; userId: string; email: string } | { kind: 'leave' } | { kind: 'delete' } | null>(null);

  const loadInvites = useCallback(async () => {
    if (!vault.isOwner) return;
    try {
      setInvites((await manager.invites(vault.id)).invites);
    } catch {
      setInvites([]);
    }
  }, [manager, vault.id, vault.isOwner]);

  useEffect(() => {
    void loadInvites();
  }, [loadInvites]);

  const run = async (key: string, fn: () => Promise<void>) => {
    setBusy(key);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(describeError(e));
    } finally {
      setBusy(null);
    }
  };

  const invite = (e: FormEvent) => {
    e.preventDefault();
    if (!email.trim()) return;
    void run('add', async () => {
      const result = await manager.addMember(vault.id, email.trim(), role);
      if (result.kind === 'added') {
        setNotice(`${email.trim()} hat jetzt Zugriff.`);
        setLink(null);
      } else {
        setLink(inviteLink(result.token));
        setNotice(`${email.trim()} hat noch kein Konto. Schick diesen Link, er gilt ${result.expiresInDays} Tage und nur für diese E-Mail:`);
        await loadInvites();
      }
      setEmail('');
    });
  };

  const owners = vault.members.filter((m) => m.role === 'owner' && m.has_key).length;

  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="sm" aria-labelledby="vault-dialog-title">
      <DialogTitle id="vault-dialog-title" sx={{ pr: 7 }}>
        {vault.name}
        <IconButton aria-label="Schließen" onClick={onClose} sx={{ position: 'absolute', right: 12, top: 12 }}>
          <CloseIcon />
        </IconButton>
      </DialogTitle>
      <DialogContent>
        <Stack spacing={3} sx={{ pt: 1 }}>
          {error && <Alert severity="error">{error}</Alert>}

          {vault.isOwner && (
            <Stack direction="row" spacing={1} sx={{ alignItems: 'flex-start' }}>
              <TextField label="Name" value={name} onChange={(e) => setName(e.target.value)} size="small" fullWidth />
              <Button
                variant="outlined"
                disabled={!name.trim() || name.trim() === vault.name}
                loading={busy === 'rename'}
                onClick={() => void run('rename', () => manager.renameVault(vault.id, name.trim()))}
              >
                Umbenennen
              </Button>
            </Stack>
          )}

          <section>
            <Typography variant="h3" sx={{ fontSize: '1.125rem', mb: 1 }}>
              Mitglieder
            </Typography>
            <List disablePadding>
              {vault.members.map((m) => (
                <ListItem
                  key={m.user_id}
                  disableGutters
                  secondaryAction={
                    vault.isOwner && m.user_id !== me ? (
                      <Tooltip title="Entfernen">
                        <IconButton aria-label={`${m.email} entfernen`} onClick={() => setConfirm({ kind: 'remove', userId: m.user_id, email: m.email })}>
                          <CloseIcon />
                        </IconButton>
                      </Tooltip>
                    ) : undefined
                  }
                  sx={{ pr: vault.isOwner ? 6 : 0, gap: 1, flexWrap: 'wrap' }}
                >
                  <ListItemText
                    primary={m.user_id === me ? `${m.email} (du)` : m.email}
                    secondary={m.has_key ? undefined : 'Wartet auf Freigabe durch einen Besitzer'}
                    slotProps={{ primary: { sx: { overflowWrap: 'anywhere' } } }}
                  />
                  {vault.isOwner && m.user_id !== me ? (
                    <TextField
                      select
                      size="small"
                      value={m.role}
                      onChange={(e) => void run(`role-${m.user_id}`, () => manager.changeRole(vault.id, m.user_id, e.target.value as Role))}
                      slotProps={{ htmlInput: { 'aria-label': `Rolle von ${m.email}` } }}
                      sx={{ minWidth: 140 }}
                    >
                      {ROLES.map((r) => (
                        <MenuItem key={r} value={r}>
                          {ROLE_LABELS[r]}
                        </MenuItem>
                      ))}
                    </TextField>
                  ) : (
                    <Chip size="small" label={ROLE_LABELS[m.role]} />
                  )}
                </ListItem>
              ))}
            </List>
          </section>

          {vault.isOwner && invites.length > 0 && (
            <section>
              <Typography variant="h3" sx={{ fontSize: '1.125rem', mb: 1 }}>
                Offene Einladungen
              </Typography>
              <List disablePadding>
                {invites.map((i) => (
                  <ListItem
                    key={i.id}
                    disableGutters
                    secondaryAction={
                      <Button size="small" onClick={() => void run(`inv-${i.id}`, async () => { await manager.revokeInvite(vault.id, i.id); await loadInvites(); })}>
                        Zurückziehen
                      </Button>
                    }
                  >
                    <ListItemText primary={i.email} secondary={`${ROLE_LABELS[i.role]}, noch ${Math.max(1, Math.round(i.expires_in_hours / 24))} Tage gültig`} />
                  </ListItem>
                ))}
              </List>
            </section>
          )}

          {vault.isOwner && (
            <Stack component="form" spacing={1.5} onSubmit={invite}>
              <Typography variant="h3" sx={{ fontSize: '1.125rem' }}>
                Jemanden hinzufügen
              </Typography>
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
                <TextField label="E-Mail" type="email" value={email} onChange={(e) => setEmail(e.target.value)} size="small" fullWidth />
                <TextField select label="Rolle" value={role} onChange={(e) => setRole(e.target.value as Role)} size="small" sx={{ minWidth: 150 }}>
                  {ROLES.map((r) => (
                    <MenuItem key={r} value={r}>
                      {ROLE_LABELS[r]}
                    </MenuItem>
                  ))}
                </TextField>
                <Button type="submit" variant="contained" loading={busy === 'add'} disabled={!email.trim()}>
                  Hinzufügen
                </Button>
              </Stack>
              {notice && <Alert severity="success">{notice}</Alert>}
              {link && (
                <TextField
                  value={link}
                  size="small"
                  fullWidth
                  slotProps={{
                    htmlInput: { readOnly: true, 'aria-label': 'Einladungslink' },
                    input: {
                      endAdornment: (
                        <InputAdornment position="end">
                          <IconButton aria-label="Link kopieren" onClick={() => void navigator.clipboard.writeText(link)} edge="end">
                            <ContentCopyIcon />
                          </IconButton>
                        </InputAdornment>
                      ),
                    },
                  }}
                />
              )}
            </Stack>
          )}

          <Divider />
          <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: 'wrap' }}>
            {!(vault.isOwner && owners <= 1) && (
              <Button color="error" onClick={() => setConfirm({ kind: 'leave' })}>
                Tresor verlassen
              </Button>
            )}
            {vault.isOwner && (
              <Button color="error" onClick={() => setConfirm({ kind: 'delete' })}>
                Tresor löschen
              </Button>
            )}
          </Stack>
        </Stack>
      </DialogContent>

      <Dialog open={confirm !== null} onClose={() => setConfirm(null)} maxWidth="xs">
        {confirm?.kind === 'remove' && (
          <>
            <DialogTitle>{confirm.email} entfernen?</DialogTitle>
            <DialogContent>
              <Typography>
                Der Tresor bekommt einen neuen Schlüssel, und alle Einträge werden neu verschlüsselt. Danach sieht {confirm.email} keine
                neuen Änderungen mehr.
              </Typography>
              <Typography sx={{ mt: 1.5 }} color="text.secondary">
                Was schon gesehen wurde, kann abgeschrieben worden sein. Ändere wichtige Passwörter in diesem Tresor.
              </Typography>
            </DialogContent>
          </>
        )}
        {confirm?.kind === 'leave' && (
          <>
            <DialogTitle>„{vault.name}“ verlassen?</DialogTitle>
            <DialogContent>
              <Typography>Du verlierst den Zugriff auf alle Einträge in diesem Tresor.</Typography>
            </DialogContent>
          </>
        )}
        {confirm?.kind === 'delete' && (
          <>
            <DialogTitle>„{vault.name}“ löschen?</DialogTitle>
            <DialogContent>
              <Typography>Alle Einträge darin verschwinden für alle Mitglieder. Das lässt sich nicht rückgängig machen.</Typography>
            </DialogContent>
          </>
        )}
        <DialogActions sx={{ px: 3, pb: 2.5 }}>
          <Button onClick={() => setConfirm(null)}>Abbrechen</Button>
          <Button
            variant="contained"
            color="error"
            loading={busy === 'confirm'}
            onClick={() =>
              void run('confirm', async () => {
                if (confirm?.kind === 'remove') await manager.removeMember(vault.id, confirm.userId);
                if (confirm?.kind === 'leave') {
                  await manager.leaveVault(vault.id);
                  onClose();
                }
                if (confirm?.kind === 'delete') {
                  await manager.deleteVault(vault.id);
                  onClose();
                }
                setConfirm(null);
              })
            }
          >
            {confirm?.kind === 'remove' ? 'Entfernen' : confirm?.kind === 'leave' ? 'Verlassen' : 'Endgültig löschen'}
          </Button>
        </DialogActions>
      </Dialog>
    </Dialog>
  );
}
