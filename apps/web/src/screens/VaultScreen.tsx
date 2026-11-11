import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { ApiError } from '../api';
import { Brand } from '../components/Brand';
import { describeError, type Session } from '../session';
import { matchesSearch, type PasswordEntry } from '../vault/entry';
import { EntryDetail } from './EntryDetail';
import { EntryEditor } from './EntryEditor';

const SYNC_INTERVAL_MS = 30_000;

type Editing = { id: string | null } | null;

export function VaultScreen({
  session,
  onLock,
}: {
  session: Session;
  onLock: (notice?: string) => void;
}) {
  const { store } = session;
  const items = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const [editing, setEditing] = useState<Editing>(null);
  const [loaded, setLoaded] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);

  useEffect(() => {
    const run = () =>
      store
        .sync()
        .then(() => setSyncError(null))
        .catch((e: unknown) => {
          if (e instanceof ApiError && e.status === 401) onLock('Deine Sitzung ist abgelaufen. Melde dich erneut an.');
          else setSyncError(describeError(e));
        })
        .finally(() => setLoaded(true));
    void run();
    const timer = setInterval(run, SYNC_INTERVAL_MS);
    window.addEventListener('focus', run);
    return () => {
      clearInterval(timer);
      window.removeEventListener('focus', run);
    };
  }, [store, onLock]);

  const visible = useMemo(() => items.filter((i) => matchesSearch(i.entry, query)), [items, query]);
  const current = selected ? items.find((i) => i.id === selected) ?? null : null;
  const showDetail = editing !== null || current !== null;

  const save = async (entry: PasswordEntry) => {
    const id = await store.save(editing?.id ?? null, entry);
    setEditing(null);
    setSelected(id);
  };

  const remove = async (id: string) => {
    try {
      await store.remove(id);
      setSelected(null);
    } catch (e) {
      setSyncError(describeError(e));
    }
  };

  return (
    <div className="shell" data-view={showDetail ? 'detail' : 'list'}>
      <header className="topbar">
        <Brand />
        <div className="topbar-actions">
          <button type="button" className="btn btn-primary" onClick={() => setEditing({ id: null })}>
            <span className="label-long">Neuer Eintrag</span>
            <span className="label-short" aria-hidden="true">
              Neu
            </span>
          </button>
          <button type="button" className="btn btn-quiet" onClick={() => onLock()}>
            Sperren
          </button>
        </div>
      </header>

      <aside className="list-pane" aria-label="Einträge">
        <label className="search">
          <span className="visually-hidden">Einträge durchsuchen</span>
          <input
            type="search"
            placeholder="Suchen"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            autoComplete="off"
          />
        </label>
        {syncError && <p className="sync-error" role="status">{syncError}</p>}
        {store.unreadableCount > 0 && (
          <p className="sync-error" role="status">
            {store.unreadableCount} Einträge ließen sich nicht entschlüsseln und werden ausgeblendet.
          </p>
        )}
        {loaded && items.length === 0 ? (
          <div className="empty">
            <p>Noch keine Einträge.</p>
            <button type="button" className="btn btn-primary" onClick={() => setEditing({ id: null })}>
              Ersten Eintrag anlegen
            </button>
          </div>
        ) : (
          <ul className="entries">
            {visible.map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  className="entry-row"
                  aria-current={item.id === selected && !editing ? 'true' : undefined}
                  onClick={() => {
                    setEditing(null);
                    setSelected(item.id);
                  }}
                >
                  <span className="entry-initial" aria-hidden="true">
                    {(item.entry.title.trim()[0] ?? '?').toLocaleUpperCase('de')}
                  </span>
                  <span className="entry-text">
                    <span className="entry-title">{item.entry.title || 'Ohne Titel'}</span>
                    <span className="entry-sub">{item.entry.username || item.entry.urls[0] || ' '}</span>
                  </span>
                </button>
              </li>
            ))}
            {loaded && items.length > 0 && visible.length === 0 && (
              <li className="no-results">Nichts gefunden für „{query}“.</li>
            )}
          </ul>
        )}
      </aside>

      <main className="detail-pane">
        {editing ? (
          <EntryEditor
            key={editing.id ?? 'new'}
            isNew={editing.id === null}
            initial={editing.id ? store.get(editing.id)?.entry ?? null : null}
            onSave={save}
            onCancel={() => setEditing(null)}
          />
        ) : current ? (
          <EntryDetail
            item={current}
            onEdit={() => setEditing({ id: current.id })}
            onDelete={() => remove(current.id)}
            onBack={() => setSelected(null)}
          />
        ) : (
          <div className="detail-placeholder">
            <p>Wähle links einen Eintrag aus oder lege einen neuen an.</p>
          </div>
        )}
      </main>
    </div>
  );
}
