import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import LinearProgress from '@mui/material/LinearProgress';
import List from '@mui/material/List';
import ListItemAvatar from '@mui/material/ListItemAvatar';
import ListItemButton from '@mui/material/ListItemButton';
import ListItemText from '@mui/material/ListItemText';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { useMemo, useState, type ReactNode } from 'react';
import { ItemAvatar } from '../../components/TypeIcon';
import { count } from '../../layout';
import { audit, findBreached } from '../../vault/audit';
import { fieldValue, subtitle, type VaultItem } from '../../vault/item';
import { estimateStrength } from '../../vault/strength';

type Breach = { state: 'idle' } | { state: 'running'; done: number; total: number } | { state: 'done'; hits: VaultItem[] } | { state: 'failed' };

function Entries({ items, onSelect, describe }: { items: VaultItem[]; onSelect: (v: VaultItem) => void; describe?: (v: VaultItem) => string }) {
  return (
    <List disablePadding sx={{ display: 'grid', gap: 0.25 }}>
      {items.map((v) => (
        <ListItemButton key={`${v.vaultId}/${v.id}`} className="audit-row" onClick={() => onSelect(v)}>
          <ListItemAvatar>
            <ItemAvatar item={v.item} />
          </ListItemAvatar>
          <ListItemText
            primary={v.item.title || 'Ohne Titel'}
            secondary={describe ? describe(v) : subtitle(v.item)}
            slotProps={{ primary: { noWrap: true, sx: { fontWeight: 700 } }, secondary: { noWrap: true } }}
          />
        </ListItemButton>
      ))}
    </List>
  );
}

function Group({ title, intro, children, id }: { title: string; intro: string; children: ReactNode; id: string }) {
  return (
    <Paper variant="outlined" component="section" aria-labelledby={id} sx={{ borderRadius: '18px', p: 2.5 }}>
      <Typography id={id} variant="h6" component="h3">
        {title}
      </Typography>
      <Typography color="text.secondary" sx={{ mb: 1.5 }}>
        {intro}
      </Typography>
      {children}
    </Paper>
  );
}

export function SecurityCheck({ items, onSelect }: { items: VaultItem[]; onSelect: (v: VaultItem) => void }) {
  const report = useMemo(() => audit(items), [items]);
  const [breach, setBreach] = useState<Breach>({ state: 'idle' });
  const reusedCount = report.reused.reduce((n, g) => n + g.length, 0);
  const clean = report.weak.length === 0 && report.reused.length === 0;

  const runBreach = async () => {
    setBreach({ state: 'running', done: 0, total: 0 });
    try {
      const hits = await findBreached(items, (done, total) => setBreach({ state: 'running', done, total }));
      setBreach({ state: 'done', hits });
    } catch {
      setBreach({ state: 'failed' });
    }
  };

  return (
    <Stack spacing={2.5} sx={{ maxWidth: 760 }} className="security-check">
      <Stack spacing={0.5}>
        <Typography variant="h4" component="h2">
          Sicherheits-Check
        </Typography>
        <Typography color="text.secondary">
          {report.checked === 0
            ? 'Noch keine Einträge mit Passwort.'
            : `${count(report.checked, 'Passwort', 'Passwörter')} geprüft, direkt auf diesem Gerät.`}
        </Typography>
      </Stack>

      {report.checked > 0 && clean && <Alert severity="success">Keine schwachen oder mehrfach verwendeten Passwörter gefunden.</Alert>}

      {report.reused.length > 0 && (
        <Group
          id="audit-reused"
          title={`Mehrfach verwendet: ${count(reusedCount, 'Eintrag', 'Einträge')}`}
          intro="Wird eine dieser Websites gehackt, sind die anderen mit demselben Passwort auch offen. Gib jeder ein eigenes."
        >
          <Stack spacing={1.5}>
            {report.reused.map((g, i) => (
              <Stack key={i} spacing={0.5}>
                <Typography variant="subtitle2" color="text.secondary">
                  Gleiches Passwort in {count(g.length, 'Eintrag', 'Einträgen')}
                </Typography>
                <Entries items={g} onSelect={onSelect} />
              </Stack>
            ))}
          </Stack>
        </Group>
      )}

      {report.weak.length > 0 && (
        <Group
          id="audit-weak"
          title={`Schwach: ${count(report.weak.length, 'Passwort', 'Passwörter')}`}
          intro="Kurz, häufig oder leicht zu erraten. Erzeuge beim Bearbeiten ein neues Passwort und ändere es auch auf der Website."
        >
          <Entries items={report.weak} onSelect={onSelect} describe={(v) => estimateStrength(fieldValue(v.item, 'password')).hint || subtitle(v.item)} />
        </Group>
      )}

      {report.checked > 0 && (
        <Group
          id="audit-breach"
          title="Mit bekannten Datenlecks abgleichen"
          intro="Optional. Dabei verlassen nur die ersten 5 Zeichen eines SHA-1-Hashes jedes Passworts dein Gerät und gehen an den Dienst „Have I Been Pwned“. Passwörter und vollständige Hashes werden nie übertragen, der Vergleich passiert hier."
        >
          {breach.state === 'idle' && (
            <Button variant="outlined" onClick={() => void runBreach()}>
              Jetzt abgleichen
            </Button>
          )}
          {breach.state === 'running' && (
            <Stack spacing={1}>
              <LinearProgress variant={breach.total ? 'determinate' : 'indeterminate'} value={breach.total ? (breach.done / breach.total) * 100 : 0} />
              <Typography variant="body2" color="text.secondary">
                {breach.total ? `${breach.done} von ${breach.total} geprüft` : 'Starte …'}
              </Typography>
            </Stack>
          )}
          {breach.state === 'failed' && (
            <Stack spacing={1} sx={{ alignItems: 'flex-start' }}>
              <Alert severity="warning">Der Dienst war nicht erreichbar. Prüfe die Verbindung und versuche es erneut.</Alert>
              <Button onClick={() => void runBreach()}>Erneut versuchen</Button>
            </Stack>
          )}
          {breach.state === 'done' &&
            (breach.hits.length === 0 ? (
              <Alert severity="success">Keines deiner Passwörter taucht in bekannten Datenlecks auf.</Alert>
            ) : (
              <Stack spacing={1}>
                <Alert severity="error">
                  {count(breach.hits.length, 'Eintrag verwendet', 'Einträge verwenden')} ein Passwort aus einem Datenleck. Ändere es so bald wie möglich.
                </Alert>
                <Entries items={breach.hits} onSelect={onSelect} />
              </Stack>
            ))}
        </Group>
      )}
    </Stack>
  );
}
