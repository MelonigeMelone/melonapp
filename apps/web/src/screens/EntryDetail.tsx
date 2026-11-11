import Accordion from '@mui/material/Accordion';
import AccordionDetails from '@mui/material/AccordionDetails';
import AccordionSummary from '@mui/material/AccordionSummary';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogContentText from '@mui/material/DialogContentText';
import DialogTitle from '@mui/material/DialogTitle';
import Divider from '@mui/material/Divider';
import IconButton from '@mui/material/IconButton';
import Link from '@mui/material/Link';
import Paper from '@mui/material/Paper';
import Snackbar from '@mui/material/Snackbar';
import Stack from '@mui/material/Stack';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import DeleteOutlinedIcon from '@mui/icons-material/DeleteOutlined';
import EditIcon from '@mui/icons-material/Edit';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import VisibilityIcon from '@mui/icons-material/Visibility';
import VisibilityOffIcon from '@mui/icons-material/VisibilityOff';
import { useEffect, useState, type ReactNode } from 'react';
import { CLIPBOARD_CLEAR_SECONDS, copySecret } from '../clipboard';
import { PasswordText } from '../components/PasswordText';
import { safeHref, type VaultItem } from '../vault/entry';

const dateFormat = new Intl.DateTimeFormat('de-DE', { dateStyle: 'medium', timeStyle: 'short' });

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Box component="section">
      <Typography variant="subtitle2" color="text.secondary" component="h3" sx={{ mb: 0.5 }}>
        {label}
      </Typography>
      {children}
    </Box>
  );
}

function CopyButton({ onCopy }: { onCopy: () => void }) {
  return (
    <Tooltip title="Kopieren">
      <IconButton aria-label="Kopieren" onClick={onCopy}>
        <ContentCopyIcon />
      </IconButton>
    </Tooltip>
  );
}

export function EntryDetail({
  item,
  onEdit,
  onDelete,
  onBack,
}: {
  item: VaultItem;
  onEdit: () => void;
  onDelete: () => Promise<void>;
  onBack: () => void;
}) {
  const { entry } = item;
  const [revealed, setRevealed] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    setRevealed(false);
    setConfirmDelete(false);
  }, [item.id]);

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

      <Typography variant="h2" sx={{ overflowWrap: 'anywhere', fontSize: { xs: '1.875rem', md: '2.25rem' } }}>
        {entry.title || 'Ohne Titel'}
      </Typography>

      {entry.username && (
        <Field label="Benutzername">
          <Stack direction="row" sx={{ alignItems: 'center', justifyContent: 'space-between', gap: 1 }}>
            <Typography sx={{ fontSize: '1.25rem', overflowWrap: 'anywhere' }}>{entry.username}</Typography>
            <CopyButton onCopy={() => void copy(entry.username)} />
          </Stack>
        </Field>
      )}

      {entry.password && (
        <Field label="Passwort">
          <Paper
            variant="outlined"
            className="password-view"
            sx={{
              borderRadius: '18px',
              boxShadow: (t) => `inset 0 -4px 0 ${t.vars?.palette.melon.rindLight}`,
              display: 'flex',
              alignItems: 'center',
              gap: 1,
              pl: 2.5,
              pr: 1,
              py: 1.75,
            }}
          >
            <Box className="password-stage" sx={{ flex: 1, minWidth: 0 }}>
              <PasswordText value={entry.password} revealed={revealed} size="lg" />
            </Box>
            <Tooltip title={revealed ? 'Verbergen' : 'Anzeigen'}>
              <IconButton
                aria-label={revealed ? 'Verbergen' : 'Anzeigen'}
                aria-pressed={revealed}
                onClick={() => setRevealed(!revealed)}
              >
                {revealed ? <VisibilityOffIcon /> : <VisibilityIcon />}
              </IconButton>
            </Tooltip>
            <CopyButton onCopy={() => void copy(entry.password)} />
          </Paper>
        </Field>
      )}

      {entry.urls.length > 0 && (
        <Field label={entry.urls.length === 1 ? 'Website' : 'Websites'}>
          <Stack spacing={0.5}>
            {entry.urls.map((url) => {
              const href = safeHref(url);
              return href ? (
                <Link
                  key={url}
                  href={href}
                  target="_blank"
                  rel="noopener noreferrer"
                  color="inherit"
                  underline="always"
                  sx={{ textDecorationColor: (t) => t.vars?.palette.primary.main, overflowWrap: 'anywhere', display: 'inline-flex', alignItems: 'center', gap: 0.5 }}
                >
                  {url}
                  <OpenInNewIcon sx={{ fontSize: '1rem' }} aria-hidden="true" />
                </Link>
              ) : (
                <Typography key={url}>{url}</Typography>
              );
            })}
          </Stack>
        </Field>
      )}

      {entry.notes && (
        <Field label="Notizen">
          <Typography sx={{ whiteSpace: 'pre-wrap', maxWidth: '65ch' }}>{entry.notes}</Typography>
        </Field>
      )}

      {entry.history.length > 0 && (
        <Accordion>
          <AccordionSummary expandIcon={<ExpandMoreIcon />} sx={{ px: 0 }}>
            <Typography variant="subtitle2" color="text.secondary">
              Frühere Passwörter ({entry.history.length})
            </Typography>
          </AccordionSummary>
          <AccordionDetails sx={{ px: 0 }}>
            <Stack spacing={1}>
              {entry.history.map((h, i) => (
                <Stack key={i} direction="row" sx={{ justifyContent: 'space-between', gap: 2, flexWrap: 'wrap' }}>
                  <PasswordText value={h.password} revealed />
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
      <Stack direction="row" spacing={1}>
        <Button variant="outlined" startIcon={<EditIcon />} onClick={onEdit}>
          Bearbeiten
        </Button>
        <Button color="error" startIcon={<DeleteOutlinedIcon />} onClick={() => setConfirmDelete(true)}>
          Löschen
        </Button>
      </Stack>

      <Dialog open={confirmDelete} onClose={() => !deleting && setConfirmDelete(false)}>
        <DialogTitle>„{entry.title || 'Ohne Titel'}“ löschen?</DialogTitle>
        <DialogContent>
          <DialogContentText>
            Der Eintrag verschwindet auf allen deinen Geräten. Das lässt sich nicht rückgängig machen.
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
