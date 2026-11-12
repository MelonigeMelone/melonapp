import Accordion from '@mui/material/Accordion';
import AccordionDetails from '@mui/material/AccordionDetails';
import AccordionSummary from '@mui/material/AccordionSummary';
import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogContentText from '@mui/material/DialogContentText';
import DialogTitle from '@mui/material/DialogTitle';
import Divider from '@mui/material/Divider';
import Snackbar from '@mui/material/Snackbar';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import DeleteOutlinedIcon from '@mui/icons-material/DeleteOutlined';
import EditIcon from '@mui/icons-material/Edit';
import RestoreFromTrashOutlinedIcon from '@mui/icons-material/RestoreFromTrashOutlined';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import { useEffect, useState } from 'react';
import { CLIPBOARD_CLEAR_SECONDS, copySecret } from '../../clipboard';
import { FieldView } from '../../components/FieldView';
import { PasswordText } from '../../components/PasswordText';
import { TYPE_ICONS } from '../../components/TypeIcon';
import { TEMPLATES, type VaultItem } from '../../vault/item';
import type { VaultView } from '../../vault/manager';
import { purgeDate } from '../../vault/trash';

const dateFormat = new Intl.DateTimeFormat('de-DE', { dateStyle: 'medium', timeStyle: 'short' });
const dayFormat = new Intl.DateTimeFormat('de-DE', { dateStyle: 'long' });

export function ItemDetail({
  entry,
  vault,
  onEdit,
  onTrash,
  onRestore,
  onDelete,
  onBack,
}: {
  entry: VaultItem;
  vault: VaultView | undefined;
  onEdit: () => void;
  onTrash: () => Promise<void>;
  onRestore: () => Promise<void>;
  onDelete: () => Promise<void>;
  onBack: () => void;
}) {
  const { item } = entry;
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [working, setWorking] = useState(false);
  const canWrite = vault?.canWrite ?? false;
  const TypeIcon = TYPE_ICONS[item.type];
  const due = purgeDate(item);

  const act = async (fn: () => Promise<void>) => {
    setWorking(true);
    try {
      await fn();
    } finally {
      setWorking(false);
    }
  };

  useEffect(() => setConfirmDelete(false), [entry.id]);

  const copy = async (value: string) => {
    try {
      await copySecret(value);
      setToast(`Kopiert. Die Zwischenablage wird in ${CLIPBOARD_CLEAR_SECONDS} Sekunden geleert.`);
    } catch {
      setToast('Kopieren hat nicht geklappt. Erlaube den Zugriff auf die Zwischenablage.');
    }
  };

  const remove = async () => {
    setDeleting(true);
    try {
      await onDelete();
    } finally {
      setDeleting(false);
      setConfirmDelete(false);
    }
  };

  return (
    <Stack component="article" spacing={3} sx={{ maxWidth: '42rem' }}>
      <Button
        startIcon={<ArrowBackIcon />}
        onClick={onBack}
        sx={{ display: { md: 'none' }, alignSelf: 'flex-start', ml: -1.5, color: 'text.secondary' }}
      >
        Alle Einträge
      </Button>

      <Stack spacing={1}>
        <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: 'wrap' }}>
          <Chip size="small" icon={<TypeIcon />} label={TEMPLATES[item.type].label} variant="outlined" />
          {vault && <Chip size="small" label={vault.name} variant="outlined" />}
        </Stack>
        <Typography variant="h2" sx={{ overflowWrap: 'anywhere', fontSize: { xs: '1.875rem', md: '2.25rem' } }}>
          {item.title || 'Ohne Titel'}
        </Typography>
      </Stack>

      {item.fields.map((f) => (
        <FieldView key={`${entry.vaultId}/${entry.id}/${f.id}`} field={f} onCopy={(v) => void copy(v)} />
      ))}

      {item.sections.map((s) => (
        <Stack key={s.id} spacing={2.5}>
          {s.title && (
            <Typography variant="h3" sx={{ fontSize: '1.25rem', pt: 1 }}>
              {s.title}
            </Typography>
          )}
          {s.fields.map((f) => (
            <FieldView key={`${entry.vaultId}/${entry.id}/${f.id}`} field={f} onCopy={(v) => void copy(v)} />
          ))}
        </Stack>
      ))}

      {item.notes && (
        <section>
          <Typography variant="subtitle2" color="text.secondary" component="h3" sx={{ mb: 0.5 }}>
            Notizen
          </Typography>
          <Typography sx={{ whiteSpace: 'pre-wrap', maxWidth: '65ch' }}>{item.notes}</Typography>
        </section>
      )}

      {item.history.length > 0 && (
        <Accordion>
          <AccordionSummary expandIcon={<ExpandMoreIcon />} sx={{ px: 0 }}>
            <Typography variant="subtitle2" color="text.secondary">
              Frühere Werte ({item.history.length})
            </Typography>
          </AccordionSummary>
          <AccordionDetails sx={{ px: 0 }}>
            <Stack spacing={1.25}>
              {item.history.map((h, i) => (
                <Stack key={i} direction="row" sx={{ justifyContent: 'space-between', gap: 2, flexWrap: 'wrap' }}>
                  <span>
                    <Typography variant="body2" color="text.secondary" component="span" sx={{ mr: 1 }}>
                      {h.label}
                    </Typography>
                    <PasswordText value={h.value} revealed />
                  </span>
                  {h.changedAt && (
                    <Typography variant="body2" color="text.secondary" component="time" dateTime={h.changedAt}>
                      bis {dateFormat.format(new Date(h.changedAt))}
                    </Typography>
                  )}
                </Stack>
              ))}
            </Stack>
          </AccordionDetails>
        </Accordion>
      )}

      <Divider />
      {due && (
        <Alert severity="warning" className="trash-notice">
          Liegt im Papierkorb und wird am {dayFormat.format(due)} endgültig gelöscht.
        </Alert>
      )}
      {!canWrite ? (
        <Alert severity="info">In „{vault?.name}“ darfst du nur lesen.</Alert>
      ) : due ? (
        <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: 'wrap' }}>
          <Button variant="contained" startIcon={<RestoreFromTrashOutlinedIcon />} loading={working} onClick={() => void act(onRestore)}>
            Wiederherstellen
          </Button>
          <Button color="error" startIcon={<DeleteOutlinedIcon />} onClick={() => setConfirmDelete(true)}>
            Endgültig löschen
          </Button>
        </Stack>
      ) : (
        <Stack direction="row" spacing={1}>
          <Button variant="outlined" startIcon={<EditIcon />} onClick={onEdit}>
            Bearbeiten
          </Button>
          <Button color="error" startIcon={<DeleteOutlinedIcon />} loading={working} onClick={() => void act(onTrash)}>
            In den Papierkorb
          </Button>
        </Stack>
      )}

      <Dialog open={confirmDelete} onClose={() => !deleting && setConfirmDelete(false)}>
        <DialogTitle>„{item.title || 'Ohne Titel'}“ endgültig löschen?</DialogTitle>
        <DialogContent>
          <DialogContentText>
            Der Eintrag verschwindet für alle, die Zugriff auf „{vault?.name}“ haben. Das lässt sich nicht rückgängig machen.
          </DialogContentText>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2.5 }}>
          <Button onClick={() => setConfirmDelete(false)} disabled={deleting}>
            Abbrechen
          </Button>
          <Button variant="contained" color="error" loading={deleting} onClick={() => void remove()}>
            Endgültig löschen
          </Button>
        </DialogActions>
      </Dialog>

      <Snackbar
        open={toast !== null}
        autoHideDuration={4000}
        onClose={() => setToast(null)}
        message={toast}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      />
    </Stack>
  );
}
