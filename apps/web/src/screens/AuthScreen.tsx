import { useState, type FormEvent } from 'react';
import { MelonMark } from '../components/Brand';
import { describeError, login, register, type Session } from '../session';

type Mode = 'login' | 'register';
const MIN_LENGTH = 12;

export function AuthScreen({
  initialEmail,
  notice,
  onSession,
}: {
  initialEmail: string;
  notice: string | null;
  onSession: (s: Session) => void;
}) {
  const [mode, setMode] = useState<Mode>('login');
  const [email, setEmail] = useState(initialEmail);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const switchMode = (m: Mode) => {
    setMode(m);
    setError(null);
    setConfirm('');
  };

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (mode === 'register') {
      if (password.length < MIN_LENGTH) {
        setError(`Das Master-Passwort braucht mindestens ${MIN_LENGTH} Zeichen.`);
        return;
      }
      if (password !== confirm) {
        setError('Die beiden Passwörter stimmen nicht überein.');
        return;
      }
    }
    setBusy(true);
    try {
      const session = await (mode === 'login' ? login : register)(email.trim(), password);
      setPassword('');
      setConfirm('');
      onSession(session);
    } catch (err) {
      setError(describeError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="auth">
      <div className="auth-intro">
        <MelonMark size={72} />
        <h1>MelonApp</h1>
        <p>Deine Passwörter, nur für dich lesbar. Verschlüsselt wird auf diesem Gerät, der Server sieht nichts davon.</p>
      </div>

      <form className="auth-form" onSubmit={submit} noValidate>
        <div className="segmented" role="tablist" aria-label="Anmelden oder Konto erstellen">
          <button type="button" role="tab" aria-selected={mode === 'login'} onClick={() => switchMode('login')}>
            Anmelden
          </button>
          <button type="button" role="tab" aria-selected={mode === 'register'} onClick={() => switchMode('register')}>
            Konto erstellen
          </button>
        </div>

        {notice && mode === 'login' && <p className="notice">{notice}</p>}

        <label className="field">
          <span>E-Mail</span>
          <input
            type="email"
            autoComplete="username"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </label>
        <label className="field">
          <span>Master-Passwort</span>
          <input
            type="password"
            autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
            required
            autoFocus={!!initialEmail}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        {mode === 'register' && (
          <>
            <label className="field">
              <span>Master-Passwort wiederholen</span>
              <input
                type="password"
                autoComplete="new-password"
                required
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
              />
            </label>
            <p className="hint">
              Mindestens {MIN_LENGTH} Zeichen. Am sichersten sind vier bis sechs zufällige Wörter. Merk es dir gut:
              Ohne Master-Passwort kommt niemand an deine Daten, auch du nicht.
            </p>
          </>
        )}

        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}

        <button type="submit" className="btn btn-primary btn-block" disabled={busy}>
          {busy ? 'Schlüssel werden berechnet …' : mode === 'login' ? 'Tresor öffnen' : 'Konto erstellen'}
        </button>
      </form>
    </main>
  );
}
