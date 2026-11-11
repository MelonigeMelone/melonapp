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
import FingerprintIcon from '@mui/icons-material/Fingerprint';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import type { InviteInfo, Role } from '../api';
import { describeError } from '../session';
import type { FoundUser, VaultsManager, VaultView } from '../vault/manager';
import { monoFont } from '../theme';

export const ROLE_LABELS: Record<Role, string> = { owner: 'Besitzer', editor: 'Bearbeiter', viewer: 'Betrachter' };
const ROLES: Role[] = ['viewer', 'editor', 'owner'];

export function SecurityCode({ code }: { code: string }) {
  return (
    <Typography
      component="p"
      className="security-code"
      sx={{ fontFamily: monoFont, fontSize: '1.5rem', letterSpacing: '0.08em', wordSpacing: '0.4em', my: 1 }}
    >
      {code}
    </Typography>
  );
}

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
  const [confirmUser, setConfirmUser] = useState<FoundUser | null>(null);
  const [codeFor, setCodeFor] = useState<{ email: string; code: string } | null>(null);
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
      setNotice(null);
      setLink(null);
      const found = await manager.findUser(email.trim());
      if (found) {
        setConfirmUser(found);
        return;
      }
      const result = await manager.invite(vault.id, email.trim(), role);
      setLink(inviteLink(result.token));
      setNotice(`${email.trim()} hat noch kein Konto. Schick diesen Link, er gilt ${result.expiresInDays} Tage und nur für diese E-Mail:`);
      await loadInvites();
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
                    <Stack direction="row">
                      <Tooltip title="Sicherheitscode">
                        <IconButton
                          aria-label={`Sicherheitscode von ${m.email}`}
                          onClick={() => void manager.fingerprint(m.public_key).then((code) => setCodeFor({ email: m.email, code }))}
                        >
                          <FingerprintIcon />
                        </IconButton>
                      </Tooltip>
                      {vault.isOwner && m.user_id !== me && (
                        <Tooltip title="Entfernen">
                          <IconButton aria-label={`${m.email} entfernen`} onClick={() => setConfirm({ kind: 'remove', userId: m.user_id, email: m.email })}>
                            <CloseIcon />
                          </IconButton>
                        </Tooltip>
                      )}
                    </Stack>
                  }
                  sx={{ pr: vault.isOwner ? 12 : 6, gap: 1, flexWrap: 'wrap' }}
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

      <Dialog open={confirmUser !== null} onClose={() => setConfirmUser(null)} maxWidth="xs" aria-labelledby="confirm-user-title">
        <DialogTitle id="confirm-user-title">Sicherheitscode vergleichen</DialogTitle>
        <DialogContent>
          <Typography>
            So lautet der Sicherheitscode von {confirmUser?.email}. Bitte die Person, in MelonApp unter „Konto“ nachzusehen,
            ob ihr Code genauso aussieht, am besten am Telefon oder persönlich.
          </Typography>
          {confirmUser && <SecurityCode code={confirmUser.fingerprint} />}
          <Typography color="text.secondary" variant="body2">
            Stimmt er nicht, könnte jemand den Schlüssel auf dem Server ausgetauscht haben. Dann nicht hinzufügen.
          </Typography>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2.5 }}>
          <Button onClick={() => setConfirmUser(null)}>Abbrechen</Button>
          <Button
            variant="contained"
            loading={busy === 'confirm-add'}
            onClick={() =>
              void run('confirm-add', async () => {
                if (!confirmUser) return;
                await manager.addKnownMember(vault.id, confirmUser, role);
                setNotice(`${confirmUser.email} hat jetzt Zugriff.`);
                setConfirmUser(null);
                setEmail('');
              })
            }
          >
            Code stimmt, hinzufügen
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={codeFor !== null} onClose={() => setCodeFor(null)} maxWidth="xs" aria-labelledby="code-title">
        <DialogTitle id="code-title">Sicherheitscode von {codeFor?.email}</DialogTitle>
        <DialogContent>
          {codeFor && <SecurityCode code={codeFor.code} />}
          <Typography color="text.secondary" variant="body2">
            Vergleiche ihn mit dem Code, den diese Person unter „Konto“ sieht. Weicht er ab, entferne sie aus dem Tresor.
          </Typography>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2.5 }}>
          <Button onClick={() => setCodeFor(null)}>Schließen</Button>
        </DialogActions>
      </Dialog>

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
