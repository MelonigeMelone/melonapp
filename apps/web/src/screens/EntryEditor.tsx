import { useState, type FormEvent } from 'react';
import { Generator } from '../components/Generator';
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

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!title.trim()) {
      setError('Gib dem Eintrag einen Titel.');
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
    <form className="detail-body editor" onSubmit={submit} noValidate>
      <h2>{isNew ? 'Neuer Eintrag' : 'Eintrag bearbeiten'}</h2>

      <label className="field">
        <span>Titel</span>
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="z. B. GitHub" autoFocus required />
      </label>
      <label className="field">
        <span>Benutzername oder E-Mail</span>
        <input value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="off" spellCheck={false} />
      </label>

      <div className="field">
        <label htmlFor="entry-password">Passwort</label>
        <div className="input-with-actions">
          <input
            id="entry-password"
            className="mono"
            type={showPassword ? 'text' : 'password'}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="new-password"
            spellCheck={false}
          />
          <button type="button" className="btn btn-small" aria-pressed={showPassword} onClick={() => setShowPassword(!showPassword)}>
            {showPassword ? 'Verbergen' : 'Anzeigen'}
          </button>
          <button type="button" className="btn btn-small" aria-expanded={showGenerator} onClick={() => setShowGenerator(!showGenerator)}>
            Generieren
          </button>
        </div>
      </div>

      {showGenerator && (
        <Generator
          onUse={(pw) => {
            setPassword(pw);
            setShowPassword(true);
            setShowGenerator(false);
          }}
        />
      )}

      <label className="field">
        <span>Websites, eine pro Zeile</span>
        <textarea rows={2} value={urls} onChange={(e) => setUrls(e.target.value)} placeholder="github.com" spellCheck={false} />
      </label>
      <label className="field">
        <span>Notizen</span>
        <textarea rows={4} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </label>

      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}

      <div className="row actions">
        <button type="submit" className="btn btn-primary" disabled={saving}>
          {saving ? 'Wird gespeichert …' : 'Speichern'}
        </button>
        <button type="button" className="btn-link" onClick={onCancel} disabled={saving}>
          Abbrechen
        </button>
      </div>
    </form>
  );
}
