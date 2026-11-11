import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Checkbox from '@mui/material/Checkbox';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import FormControlLabel from '@mui/material/FormControlLabel';
import LinearProgress from '@mui/material/LinearProgress';
import MenuItem from '@mui/material/MenuItem';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import UploadFileIcon from '@mui/icons-material/UploadFile';
import { useMemo, useState } from 'react';
import { entries } from '../../layout';
import { describeError } from '../../session';
import { TEMPLATES, type Item, type ItemType, type VaultItem } from '../../vault/item';
import type { VaultsManager, VaultView } from '../../vault/manager';
import { dedupeKey, ImportError, readExport, SOURCE_LABELS, type ImportResult } from './import/formats';

const HOWTO: [string, string][] = [
  ['Apple Passwörter', 'Mac: Passwörter-App → Ablage → Alle Passwörter exportieren. iPhone: Einstellungen → Apps → Passwörter → Exportieren.'],
  ['1Password', '1Password → Datei → Exportieren → 1PUX. Das enthält auch Abschnitte, eigene Felder, Karten und Identitäten.'],
  ['Chrome, Edge, Brave', 'Einstellungen → Passwörter → Exportieren (CSV).'],
  ['Firefox', 'about:logins → ⋯ → Zugangsdaten exportieren.'],
  ['Bitwarden', 'Tools → Tresor exportieren → .csv.'],
];

const ERRORS: Record<string, string> = {
  unknown_format: 'Dieses Format kennt MelonApp nicht. Unterstützt sind die Exporte aus Apple Passwörter, 1Password, Chrome, Firefox und Bitwarden.',
  unreadable_1pux: 'Die 1PUX-Datei lässt sich nicht lesen. Exportiere sie in 1Password noch einmal.',
};

type Phase = { kind: 'choose' } | { kind: 'preview'; result: ImportResult } | { kind: 'running'; done: number; total: number } | { kind: 'finished'; imported: number; failed: number };

export function ImportDialog({
  manager,
  vaults,
  existing,
  initialVault,
  onClose,
  onImported,
}: {
  manager: VaultsManager;
  vaults: VaultView[];
  existing: VaultItem[];
  initialVault: string;
  onClose: () => void;
  onImported: (vaultId: string) => void;
}) {
  const writable = vaults.filter((v) => v.canWrite);
  const [target, setTarget] = useState(initialVault);
  const [phase, setPhase] = useState<Phase>({ kind: 'choose' });
  const [skipDuplicates, setSkipDuplicates] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const existingKeys = useMemo(
    () => new Set(existing.filter((e) => e.vaultId === target).map((e) => dedupeKey(e.item))),
    [existing, target],
  );
  const preview = phase.kind === 'preview' ? phase.result : null;
  const duplicates = preview ? preview.items.filter((i) => existingKeys.has(dedupeKey(i))).length : 0;
  const toImport: Item[] = preview ? preview.items.filter((i) => !skipDuplicates || !existingKeys.has(dedupeKey(i))) : [];
  const byType = preview
    ? (Object.entries(
        preview.items.reduce<Partial<Record<ItemType, number>>>((acc, i) => ({ ...acc, [i.type]: (acc[i.type] ?? 0) + 1 }), {}),
      ) as [ItemType, number][])
    : [];

  const choose = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    try {
      setPhase({ kind: 'preview', result: await readExport(file) });
    } catch (e) {
      setError(e instanceof ImportError ? (ERRORS[e.message] ?? e.message) : 'Die Datei lässt sich nicht lesen.');
    }
  };

  const run = async () => {
    const items = toImport;
    let failed = 0;
    setPhase({ kind: 'running', done: 0, total: items.length });
    for (let i = 0; i < items.length; i++) {
      try {
        await manager.saveItem(target, null, items[i] as Item);
      } catch (e) {
        failed++;
        setError(describeError(e));
      }
      setPhase({ kind: 'running', done: i + 1, total: items.length });
    }
    setPhase({ kind: 'finished', imported: items.length - failed, failed });
    onImported(target);
  };

  const busy = phase.kind === 'running';

  return (
    <Dialog open onClose={busy ? undefined : onClose} fullWidth maxWidth="sm" aria-labelledby="import-title">
      <DialogTitle id="import-title">Passwörter importieren</DialogTitle>
      <DialogContent>
        <Stack spacing={2.5}>
          {phase.kind === 'choose' && (
            <>
              <Typography>
                Wähle die Export-Datei deines bisherigen Passwortmanagers. Sie wird nur in diesem Browser gelesen und verschlüsselt.
                Unverschlüsselt verlässt nichts dein Gerät.
              </Typography>
              <Stack component="ul" spacing={0.75} sx={{ m: 0, pl: 2.5 }}>
                {HOWTO.map(([name, how]) => (
                  <Typography component="li" key={name} variant="body2">
                    <strong>{name}:</strong> {how}
                  </Typography>
                ))}
              </Stack>
              <Button component="label" variant="contained" startIcon={<UploadFileIcon />} sx={{ alignSelf: 'flex-start' }}>
                Datei auswählen
                <input
                  hidden
                  type="file"
                  accept=".csv,.1pux,text/csv"
                  aria-label="Export-Datei"
                  onChange={(e) => void choose(e.target.files?.[0])}
                />
              </Button>
            </>
          )}

          {preview && (
            <>
              <Alert severity="success">
                Erkannt: {SOURCE_LABELS[preview.source]}, {entries(preview.items.length)}.
                {preview.skippedArchived > 0 && ` ${entries(preview.skippedArchived)} aus dem Archiv werden übersprungen.`}
              </Alert>
              <Typography variant="body2" color="text.secondary">
                {byType.map(([t, n]) => `${n} × ${TEMPLATES[t].label}`).join(', ')}
              </Typography>
              <Box component="ul" sx={{ m: 0, pl: 2.5 }}>
                {preview.items.slice(0, 5).map((i, n) => (
                  <Typography component="li" key={n} variant="body2">
                    {i.title}
                  </Typography>
                ))}
                {preview.items.length > 5 && (
                  <Typography component="li" variant="body2" color="text.secondary">
                    und {preview.items.length - 5} weitere
                  </Typography>
                )}
              </Box>
              {writable.length > 1 && (
                <TextField select label="In diesen Bereich" value={target} onChange={(e) => setTarget(e.target.value)} size="small">
                  {writable.map((v) => (
                    <MenuItem key={v.id} value={v.id}>
                      {v.name}
                    </MenuItem>
                  ))}
                </TextField>
              )}
              {duplicates > 0 && (
                <FormControlLabel
                  control={<Checkbox checked={skipDuplicates} onChange={(e) => setSkipDuplicates(e.target.checked)} />}
                  label={`Doppelte überspringen (${entries(duplicates)} gibt es schon)`}
                />
              )}
            </>
          )}

          {phase.kind === 'running' && (
            <Stack spacing={1}>
              <Typography>
                {phase.done} von {phase.total} verschlüsselt und gespeichert …
              </Typography>
              <LinearProgress variant="determinate" value={phase.total ? (phase.done / phase.total) * 100 : 100} />
            </Stack>
          )}

          {phase.kind === 'finished' && (
            <>
              <Alert severity={phase.failed ? 'warning' : 'success'}>
                {entries(phase.imported)} importiert.{phase.failed > 0 && ` ${entries(phase.failed)} ließen sich nicht speichern.`}
              </Alert>
              <Alert severity="warning">
                Lösche jetzt die Export-Datei und leere den Papierkorb. Sie enthält deine Passwörter unverschlüsselt.
              </Alert>
            </>
          )}

          {error && <Alert severity="error">{error}</Alert>}
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2.5 }}>
        {phase.kind === 'finished' ? (
          <Button variant="contained" onClick={onClose}>
            Fertig
          </Button>
        ) : (
          <>
            <Button onClick={onClose} disabled={busy}>
              Abbrechen
            </Button>
            {preview && (
              <Button variant="contained" onClick={() => void run()} disabled={toImport.length === 0}>
                {entries(toImport.length)} importieren
              </Button>
            )}
          </>
        )}
      </DialogActions>
    </Dialog>
  );
}
