import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Collapse from '@mui/material/Collapse';
import IconButton from '@mui/material/IconButton';
import InputAdornment from '@mui/material/InputAdornment';
import ListItemIcon from '@mui/material/ListItemIcon';
import Menu from '@mui/material/Menu';
import MenuItem from '@mui/material/MenuItem';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import AddIcon from '@mui/icons-material/Add';
import AutoFixHighIcon from '@mui/icons-material/AutoFixHigh';
import DeleteOutlinedIcon from '@mui/icons-material/DeleteOutlined';
import VisibilityIcon from '@mui/icons-material/Visibility';
import VisibilityOffIcon from '@mui/icons-material/VisibilityOff';
import { useState, type FormEvent } from 'react';
import { Generator } from '../../components/Generator';
import { QrImportButton, useTotp } from '../../components/Totp';
import { describeError } from '../../session';
import { monoFont } from '../../theme';
import { cleanItem, isTotpField, KIND_LABELS, newId, TEMPLATES, totpFields, type Field, type FieldKind, type Item } from '../../vault/item';
import { StrengthMeter } from '../../components/StrengthMeter';
import { formatCode } from '../../vault/totp';
import type { VaultView } from '../../vault/manager';

const KIND_ORDER: FieldKind[] = ['text', 'concealed', 'totp', 'url', 'email', 'phone', 'date', 'multiline'];
type Path = { section: number | null; index: number };

function TotpInput({ field, custom, onChange, onRemove }: { field: Field; custom: boolean; onChange: (f: Field) => void; onRemove?: () => void }) {
  const { cfg, code } = useTotp(field.value);
  const [visible, setVisible] = useState(!field.value);
  const [qrError, setQrError] = useState<string | null>(null);
  const helper = !field.value
    ? 'otpauth://-Link oder geheimer Schlüssel aus der 2FA-Einrichtung der Website.'
    : !cfg
      ? 'Ungültig. Erwartet wird ein otpauth://-Link oder ein Base32-Schlüssel.'
      : code
        ? `Aktueller Code: ${formatCode(code)}`
        : ' ';
  return (
    <Stack spacing={1}>
      {custom && (
        <TextField
          size="small"
          label="Name des Felds (Einmalcode)"
          value={field.label}
          onChange={(e) => onChange({ ...field, label: e.target.value })}
          sx={{ maxWidth: 360 }}
        />
      )}
      <TextField
        id={`field-${field.id}`}
        label={custom ? 'Schlüssel' : field.label}
        value={field.value}
        onChange={(e) => onChange({ ...field, kind: 'totp', value: e.target.value })}
        type={visible ? 'text' : 'password'}
        error={!!field.value && !cfg}
        helperText={helper}
        autoComplete="off"
        fullWidth
        slotProps={{
          htmlInput: { spellCheck: false, style: { fontFamily: monoFont } },
          input: {
            endAdornment: (
              <InputAdornment position="end">
                <Tooltip title={visible ? 'Verbergen' : 'Anzeigen'}>
                  <IconButton aria-label={visible ? 'Schlüssel verbergen' : 'Schlüssel anzeigen'} onClick={() => setVisible(!visible)} edge={onRemove ? false : 'end'}>
                    {visible ? <VisibilityOffIcon /> : <VisibilityIcon />}
                  </IconButton>
                </Tooltip>
                {onRemove && (
                  <Tooltip title="Feld entfernen">
                    <IconButton aria-label={`${field.label || 'Feld'} entfernen`} onClick={onRemove} edge="end">
                      <DeleteOutlinedIcon />
                    </IconButton>
                  </Tooltip>
                )}
              </InputAdornment>
            ),
          },
        }}
      />
      <QrImportButton
        onValue={(v) => {
          setQrError(null);
          setVisible(false);
          onChange({ ...field, kind: 'totp', value: v });
        }}
        onError={setQrError}
      />
      {qrError && <Alert severity="warning">{qrError}</Alert>}
    </Stack>
  );
}

function FieldInput({
  field,
  custom,
  onChange,
  onRemove,
}: {
  field: Field;
  custom: boolean;
  onChange: (f: Field) => void;
  onRemove?: () => void;
}) {
  const [visible, setVisible] = useState(!field.value);
  const [generator, setGenerator] = useState(false);
  if (isTotpField(field)) return <TotpInput field={field} custom={custom} onChange={onChange} onRemove={onRemove} />;
  const concealed = field.kind === 'concealed';
  const id = `field-${field.id}`;

  const actions = (
    <InputAdornment position="end">
      {concealed && (
        <>
          <Tooltip title={visible ? 'Verbergen' : 'Anzeigen'}>
            <IconButton
              aria-label={visible ? `${field.label || 'Feld'} verbergen` : `${field.label || 'Feld'} anzeigen`}
              onClick={() => setVisible(!visible)}
              edge="end"
            >
              {visible ? <VisibilityOffIcon /> : <VisibilityIcon />}
            </IconButton>
          </Tooltip>
          <Tooltip title="Passwort generieren">
            <IconButton
              aria-label={`${field.label || 'Feld'} generieren`}
              aria-expanded={generator}
              onClick={() => setGenerator(!generator)}
              color={generator ? 'primary' : 'default'}
            >
              <AutoFixHighIcon />
            </IconButton>
          </Tooltip>
        </>
      )}
      {onRemove && (
        <Tooltip title="Feld entfernen">
          <IconButton aria-label={`${field.label || 'Feld'} entfernen`} onClick={onRemove} edge={concealed ? false : 'end'}>
            <DeleteOutlinedIcon />
          </IconButton>
        </Tooltip>
      )}
    </InputAdornment>
  );

  return (
    <Stack spacing={1}>
      {custom && (
        <TextField
          size="small"
          label={`Name des Felds (${KIND_LABELS[field.kind]})`}
          value={field.label}
          onChange={(e) => onChange({ ...field, label: e.target.value })}
          sx={{ maxWidth: 360 }}
        />
      )}
      <TextField
        id={id}
        label={custom ? 'Wert' : field.label}
        value={field.value}
        onChange={(e) => onChange({ ...field, value: e.target.value })}
        type={concealed && !visible ? 'password' : field.kind === 'date' ? 'date' : 'text'}
        multiline={field.kind === 'multiline'}
        minRows={field.kind === 'multiline' ? 2 : undefined}
        autoComplete={concealed ? 'new-password' : 'off'}
        fullWidth
        slotProps={{
          inputLabel: field.kind === 'date' ? { shrink: true } : undefined,
          htmlInput: {
            spellCheck: false,
            inputMode: field.kind === 'email' ? 'email' : field.kind === 'phone' ? 'tel' : field.kind === 'url' ? 'url' : undefined,
            style: concealed ? { fontFamily: monoFont } : undefined,
          },
          input: concealed || onRemove ? { endAdornment: actions } : undefined,
        }}
      />
      {field.id === 'password' && <StrengthMeter password={field.value} />}
      {concealed && (
        <Collapse in={generator} unmountOnExit>
          <Generator
            onUse={(pw) => {
              onChange({ ...field, value: pw });
              setVisible(true);
              setGenerator(false);
            }}
          />
        </Collapse>
      )}
    </Stack>
  );
}

export function ItemEditor({
  initial,
  isNew,
  vaultId,
  vaults,
  onSave,
  onCancel,
}: {
  initial: Item;
  isNew: boolean;
  vaultId: string;
  vaults: VaultView[];
  onSave: (vaultId: string, item: Item) => Promise<void>;
  onCancel: () => void;
}) {
  const [item, setItem] = useState<Item>(initial);
  const [target, setTarget] = useState(vaultId);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [titleMissing, setTitleMissing] = useState(false);
  const [menu, setMenu] = useState<HTMLElement | null>(null);
  const writable = vaults.filter((v) => v.canWrite);

  const update = (path: Path, f: Field) =>
    setItem((it) =>
      path.section === null
        ? { ...it, fields: it.fields.map((x, i) => (i === path.index ? f : x)) }
        : {
            ...it,
            sections: it.sections.map((s, si) =>
              si === path.section ? { ...s, fields: s.fields.map((x, i) => (i === path.index ? f : x)) } : s,
            ),
          },
    );

  const removeField = (section: number, index: number) =>
    setItem((it) => ({
      ...it,
      sections: it.sections.map((s, si) => (si === section ? { ...s, fields: s.fields.filter((_, i) => i !== index) } : s)),
    }));

  const addField = (kind: FieldKind) => {
    setMenu(null);
    const field: Field = { id: newId(), label: '', kind, value: '' };
    setItem((it) =>
      it.sections.length
        ? { ...it, sections: it.sections.map((s, i) => (i === it.sections.length - 1 ? { ...s, fields: [...s.fields, field] } : s)) }
        : { ...it, sections: [{ id: newId(), title: '', fields: [field] }] },
    );
  };

  const addTotp = () =>
    setItem((it) => ({
      ...it,
      sections: [...it.sections, { id: newId(), title: 'Einmalcode', fields: [{ id: newId(), label: 'Einmalcode', kind: 'totp', value: '' }] }],
    }));

  const addSection = () =>
    setItem((it) => ({ ...it, sections: [...it.sections, { id: newId(), title: 'Neuer Abschnitt', fields: [] }] }));

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!item.title.trim()) {
      setTitleMissing(true);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await onSave(target, cleanItem(item));
    } catch (err) {
      setError(describeError(err));
      setSaving(false);
    }
  }

  return (
    <Stack component="form" spacing={2.5} onSubmit={submit} noValidate sx={{ maxWidth: '42rem' }}>
      <Typography variant="h2" sx={{ fontSize: { xs: '1.875rem', md: '2.25rem' } }}>
        {isNew ? `Neu: ${TEMPLATES[item.type].label}` : 'Eintrag bearbeiten'}
      </Typography>

      <TextField
        label="Titel"
        placeholder="z. B. GitHub"
        value={item.title}
        onChange={(e) => {
          setItem({ ...item, title: e.target.value });
          setTitleMissing(false);
        }}
        error={titleMissing}
        helperText={titleMissing ? 'Gib dem Eintrag einen Titel.' : undefined}
        autoFocus
        fullWidth
      />

      {writable.length > 1 && (
        <TextField
          select
          label="Bereich"
          value={target}
          onChange={(e) => setTarget(e.target.value)}
          helperText={!isNew && target !== vaultId ? 'Der Eintrag wird beim Speichern in diesen Bereich verschoben.' : undefined}
          fullWidth
        >
          {writable.map((v) => (
            <MenuItem key={v.id} value={v.id}>
              {v.name}
            </MenuItem>
          ))}
        </TextField>
      )}

      {item.type === 'passkey' ? (
        <Typography variant="body2" color="text.secondary">
          Website, Benutzername und Schlüssel dieses Passkeys verwaltet MelonApp. Sie lassen sich nicht bearbeiten.
        </Typography>
      ) : (
        item.fields.map((f, i) => (
          <FieldInput key={f.id} field={f} custom={false} onChange={(nf) => update({ section: null, index: i }, nf)} />
        ))
      )}

      {item.sections.map((s, si) => (
        <Paper key={s.id} variant="outlined" sx={{ p: 2, borderRadius: '18px', borderStyle: 'dashed' }}>
          <Stack spacing={2}>
            <TextField
              variant="standard"
              label="Abschnitt"
              placeholder="Ohne Überschrift"
              value={s.title}
              onChange={(e) =>
                setItem((it) => ({
                  ...it,
                  sections: it.sections.map((x, i) => (i === si ? { ...x, title: e.target.value } : x)),
                }))
              }
            />
            {s.fields.map((f, i) => (
              <FieldInput
                key={f.id}
                field={f}
                custom
                onChange={(nf) => update({ section: si, index: i }, nf)}
                onRemove={() => removeField(si, i)}
              />
            ))}
            {s.fields.length === 0 && (
              <Typography variant="body2" color="text.secondary">
                Noch keine Felder in diesem Abschnitt.
              </Typography>
            )}
          </Stack>
        </Paper>
      ))}

      <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: 'wrap' }}>
        <Button variant="outlined" startIcon={<AddIcon />} onClick={(e) => setMenu(e.currentTarget)} aria-haspopup="menu">
          Feld hinzufügen
        </Button>
        {item.type === 'login' && totpFields(item).length === 0 && (
          <Button startIcon={<AddIcon />} onClick={addTotp} sx={{ color: 'text.secondary' }}>
            Einmalcode (2FA) hinzufügen
          </Button>
        )}
        <Button startIcon={<AddIcon />} onClick={addSection} sx={{ color: 'text.secondary' }}>
          Abschnitt hinzufügen
        </Button>
      </Stack>
      <Menu anchorEl={menu} open={menu !== null} onClose={() => setMenu(null)}>
        {KIND_ORDER.map((k) => (
          <MenuItem key={k} onClick={() => addField(k)}>
            <ListItemIcon>
              <AddIcon fontSize="small" />
            </ListItemIcon>
            {KIND_LABELS[k]}
          </MenuItem>
        ))}
      </Menu>

      <TextField label="Notizen" value={item.notes} onChange={(e) => setItem({ ...item, notes: e.target.value })} multiline minRows={4} fullWidth />

      {error && <Alert severity="error">{error}</Alert>}

      <Box>
        <Stack direction="row" spacing={1}>
          <Button type="submit" variant="contained" loading={saving}>
            Speichern
          </Button>
          <Button onClick={onCancel} disabled={saving} sx={{ color: 'text.secondary' }}>
            Abbrechen
          </Button>
        </Stack>
      </Box>
    </Stack>
  );
}
