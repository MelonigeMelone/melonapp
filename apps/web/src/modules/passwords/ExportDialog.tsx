import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import Checkbox from '@mui/material/Checkbox';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import FormControlLabel from '@mui/material/FormControlLabel';
import Radio from '@mui/material/Radio';
import RadioGroup from '@mui/material/RadioGroup';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { useState } from 'react';
import { StrengthMeter } from '../../components/StrengthMeter';
import { entries } from '../../layout';
import { checkPassword, sealExport, type Session } from '../../session';
import type { VaultItem } from '../../vault/item';
import type { VaultView } from '../../vault/manager';
import { bitwardenCsv, fileName, melonPayload, saveExport } from './export/formats';

const MIN_EXPORT_PASSWORD = 12;

function message(e: unknown): string {
  const m = e instanceof Error ? e.message : String(e);
  if (/wrong_password|decryption failed/.test(m)) return 'Das Master-Passwort stimmt nicht.';
  if (/export_password_is_master_password/.test(m)) return 'Nimm ein anderes Export-Passwort als dein Master-Passwort.';
  if (/weak_export_password|at least 12/.test(m)) return `Das Export-Passwort braucht mindestens ${MIN_EXPORT_PASSWORD} Zeichen.`;
  if (/export_unsupported/.test(m)) return 'Auf diesem Gerät kann MelonApp noch keine Datei speichern. Exportiere in der Web-App oder am Mac.';
  return 'Der Export ist fehlgeschlagen. Versuche es noch einmal.';
}

export function ExportDialog({
  session,
  items,
  vaults,
  onClose,
}: {
  session: Session;
  items: VaultItem[];
  vaults: VaultView[];
  onClose: () => void;
}) {
  const [kind, setKind] = useState<'melon' | 'csv'>('melon');
  const [master, setMaster] = useState('');
  const [exportPassword, setExportPassword] = useState('');
  const [repeat, setRepeat] = useState('');
  const [understood, setUnderstood] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  const vaultName = (id: string) => vaults.find((v) => v.id === id)?.name ?? 'Bereich';
  const unreadable = vaults.reduce((n, v) => n + v.unreadable + v.rolledBack, 0);
  const tooShort = exportPassword.length > 0 && exportPassword.length < MIN_EXPORT_PASSWORD;
  const mismatch = repeat.length > 0 && repeat !== exportPassword;
  const ready =
    master.length > 0 &&
    items.length > 0 &&
    (kind === 'melon' ? exportPassword.length >= MIN_EXPORT_PASSWORD && repeat === exportPassword : understood);

  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      if (kind === 'melon') {
        const file = await sealExport(session, master, exportPassword, melonPayload(items, vaultName));
        const name = await saveExport(fileName('melon'), file, 'application/json');
        if (!name) return;
        setSaved(name);
      } else {
        await checkPassword(session, master);
        const name = await saveExport(fileName('csv'), bitwardenCsv(items, vaultName), 'text/csv');
        if (!name) return;
        setSaved(name);
      }
      setMaster('');
      setExportPassword('');
      setRepeat('');
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onClose={busy ? undefined : onClose} fullWidth maxWidth="sm" aria-labelledby="export-title">
      <DialogTitle id="export-title">Exportieren</DialogTitle>
      <DialogContent>
        <Stack spacing={2.5} sx={{ pt: 0.5 }}>
          {saved ? (
            <>
              <Alert severity="success">Gespeichert als {saved}.</Alert>
              {kind === 'csv' ? (
                <Alert severity="warning">
                  Die Datei enthält alle Passwörter im Klartext. Importiere sie und lösche sie danach sofort, auch aus dem
                  Papierkorb und aus Cloud-Ordnern.
                </Alert>
              ) : (
                <Typography variant="body2" color="text.secondary">
                  Öffnen lässt sie sich nur mit dem Export-Passwort, über „Importieren“ in MelonApp. Bewahre das Passwort getrennt
                  von der Datei auf.
                </Typography>
              )}
            </>
          ) : (
            <>
              <Typography>
                Exportiert {entries(items.length)} aus allen Bereichen, auf die du Zugriff hast. Die Datei entsteht nur in diesem
                Browser.
              </Typography>
              {unreadable > 0 && (
                <Alert severity="info">
                  {entries(unreadable)} ließen sich nicht entschlüsseln oder wurden als älterer Stand verworfen und fehlen im Export.
                </Alert>
              )}
              <RadioGroup value={kind} onChange={(e) => setKind(e.target.value as 'melon' | 'csv')} aria-label="Format">
                <FormControlLabel
                  value="melon"
                  control={<Radio />}
                  label={
                    <Stack sx={{ py: 0.75 }}>
                      <Typography sx={{ fontWeight: 700 }}>Verschlüsselt (empfohlen)</Typography>
                      <Typography variant="body2" color="text.secondary">
                        Für ein eigenes Backup oder den Umzug auf einen anderen MelonApp-Server. Alles bleibt erhalten, auch Verlauf
                        und 2FA. Lesbar nur mit dem Export-Passwort.
                      </Typography>
                    </Stack>
                  }
                />
                <FormControlLabel
                  value="csv"
                  control={<Radio />}
                  label={
                    <Stack sx={{ py: 0.75 }}>
                      <Typography sx={{ fontWeight: 700 }}>Unverschlüsselt (CSV)</Typography>
                      <Typography variant="body2" color="text.secondary">
                        Für den Umzug zu einem anderen Passwortmanager (Bitwarden-Format, das die meisten importieren). Passkeys sind nicht enthalten.
                      </Typography>
                    </Stack>
                  }
                />
              </RadioGroup>

              {kind === 'melon' ? (
                <Stack spacing={1.5}>
                  <TextField
                    label="Export-Passwort"
                    type="password"
                    autoComplete="new-password"
                    value={exportPassword}
                    onChange={(e) => setExportPassword(e.target.value)}
                    error={tooShort}
                    helperText={
                      tooShort
                        ? `Mindestens ${MIN_EXPORT_PASSWORD} Zeichen.`
                        : 'Nicht dein Master-Passwort. Ohne dieses Passwort lässt sich die Datei nie wieder öffnen.'
                    }
                  />
                  <StrengthMeter password={exportPassword} />
                  <TextField
                    label="Export-Passwort wiederholen"
                    type="password"
                    autoComplete="new-password"
                    value={repeat}
                    onChange={(e) => setRepeat(e.target.value)}
                    error={mismatch}
                    helperText={mismatch ? 'Die beiden Passwörter sind verschieden.' : ' '}
                  />
                </Stack>
              ) : (
                <Stack spacing={1}>
                  <Alert severity="error">
                    Jeder, der diese Datei bekommt, kann alle deine Passwörter lesen. Verlauf alter Passwörter ist nicht enthalten.
                    Öffne sie nicht in Excel oder einer Tabellenkalkulation, sondern importiere sie direkt und lösche sie danach.
                  </Alert>
                  <FormControlLabel
                    control={<Checkbox checked={understood} onChange={(e) => setUnderstood(e.target.checked)} />}
                    label="Ich verstehe, dass die Datei alle Passwörter im Klartext enthält."
                  />
                </Stack>
              )}

              <TextField
                label="Master-Passwort zur Bestätigung"
                type="password"
                autoComplete="current-password"
                value={master}
                onChange={(e) => setMaster(e.target.value)}
              />
            </>
          )}
          {error && <Alert severity="error">{error}</Alert>}
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2.5 }}>
        {saved ? (
          <Button variant="contained" onClick={onClose}>
            Fertig
          </Button>
        ) : (
          <>
            <Button onClick={onClose} disabled={busy}>
              Abbrechen
            </Button>
            <Button variant="contained" onClick={() => void run()} disabled={!ready || busy} color={kind === 'csv' ? 'error' : 'primary'}>
              {busy ? 'Wird erstellt …' : kind === 'csv' ? 'Unverschlüsselt exportieren' : 'Verschlüsselt exportieren'}
            </Button>
          </>
        )}
      </DialogActions>
    </Dialog>
  );
}
