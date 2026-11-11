import { useEffect, useState } from 'react';
import { CLIPBOARD_CLEAR_SECONDS, copySecret } from '../clipboard';
import { PasswordText } from '../components/PasswordText';
import { safeHref, type VaultItem } from '../vault/entry';

const dateFormat = new Intl.DateTimeFormat('de-DE', { dateStyle: 'medium', timeStyle: 'short' });

function useCopy() {
  const [copied, setCopied] = useState<string | null>(null);
  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(null), 4000);
    return () => clearTimeout(t);
  }, [copied]);
  const copy = async (what: string, value: string) => {
    try {
      await copySecret(value);
      setCopied(what);
    } catch {
      setCopied('error');
    }
  };
  return { copied, copy };
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
  const { copied, copy } = useCopy();

  useEffect(() => {
    setRevealed(false);
    setConfirmDelete(false);
  }, [item.id]);

  const remove = async () => {
    setDeleting(true);
    try {
      await onDelete();
    } finally {
      setDeleting(false);
    }
  };

  return (
    <article className="detail-body">
      <button type="button" className="btn-link back" onClick={onBack}>
        Alle Einträge
      </button>
      <h2>{entry.title || 'Ohne Titel'}</h2>

      {entry.username && (
        <section className="field-view">
          <h3>Benutzername</h3>
          <div className="field-value">
            <span className="value-text">{entry.username}</span>
            <button type="button" className="btn btn-small" onClick={() => void copy('username', entry.username)}>
              Kopieren
            </button>
          </div>
        </section>
      )}

      {entry.password && (
        <section className="field-view password-view">
          <h3>Passwort</h3>
          <div className="password-stage">
            <PasswordText value={entry.password} revealed={revealed} size="lg" />
          </div>
          <div className="row">
            <button type="button" className="btn btn-small" aria-pressed={revealed} onClick={() => setRevealed(!revealed)}>
              {revealed ? 'Verbergen' : 'Anzeigen'}
            </button>
            <button type="button" className="btn btn-small btn-primary" onClick={() => void copy('password', entry.password)}>
              Kopieren
            </button>
          </div>
        </section>
      )}

      <p className="copy-status" aria-live="polite">
        {copied === 'error'
          ? 'Kopieren hat nicht geklappt. Erlaube den Zugriff auf die Zwischenablage.'
          : copied
            ? `Kopiert. Die Zwischenablage wird in ${CLIPBOARD_CLEAR_SECONDS} Sekunden geleert.`
            : ''}
      </p>

      {entry.urls.length > 0 && (
        <section className="field-view">
          <h3>{entry.urls.length === 1 ? 'Website' : 'Websites'}</h3>
          <ul className="url-list">
            {entry.urls.map((url) => {
              const href = safeHref(url);
              return (
                <li key={url}>
                  {href ? (
                    <a href={href} target="_blank" rel="noopener noreferrer">
                      {url}
                    </a>
                  ) : (
                    <span>{url}</span>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {entry.notes && (
        <section className="field-view">
          <h3>Notizen</h3>
          <p className="notes">{entry.notes}</p>
        </section>
      )}

      {entry.history.length > 0 && (
        <details className="history">
          <summary>Frühere Passwörter ({entry.history.length})</summary>
          <ul>
            {entry.history.map((h, i) => (
              <li key={i}>
                <PasswordText value={h.password} revealed />
                {h.changedAt && <time dateTime={h.changedAt}>bis {dateFormat.format(new Date(h.changedAt))}</time>}
              </li>
            ))}
          </ul>
        </details>
      )}

      <div className="row actions">
        <button type="button" className="btn" onClick={onEdit}>
          Bearbeiten
        </button>
        {confirmDelete ? (
          <>
            <button type="button" className="btn btn-danger" disabled={deleting} onClick={() => void remove()}>
              {deleting ? 'Wird gelöscht …' : 'Endgültig löschen'}
            </button>
            <button type="button" className="btn-link" onClick={() => setConfirmDelete(false)}>
              Abbrechen
            </button>
          </>
        ) : (
          <button type="button" className="btn btn-quiet" onClick={() => setConfirmDelete(true)}>
            Löschen
          </button>
        )}
      </div>
    </article>
  );
}
