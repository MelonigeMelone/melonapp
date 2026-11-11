import { lazy, Suspense, useCallback, useEffect, useState } from 'react';
import { AuthScreen } from './screens/AuthScreen';
import { lock, type Session } from './session';
import { useIdle } from './useIdle';

const loadVault = () => import('./screens/VaultScreen');
const VaultScreen = lazy(() => loadVault().then((m) => ({ default: m.VaultScreen })));

const AUTO_LOCK_MS = 5 * 60 * 1000;
const EMAIL_KEY = 'melon.email';

function rememberedEmail(): string {
  try {
    return localStorage.getItem(EMAIL_KEY) ?? '';
  } catch {
    return '';
  }
}

function rememberEmail(email: string) {
  try {
    localStorage.setItem(EMAIL_KEY, email);
  } catch {
    return;
  }
}

export function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [email, setEmail] = useState(rememberedEmail);

  const onSession = useCallback((s: Session) => {
    rememberEmail(s.email);
    setEmail(s.email);
    setNotice(null);
    setSession(s);
  }, []);

  const onLock = useCallback(
    (message?: string) => {
      void lock(session);
      setSession(null);
      setNotice(message ?? null);
    },
    [session],
  );

  useEffect(() => {
    void loadVault();
  }, []);

  useIdle(AUTO_LOCK_MS, () => {
    if (session) onLock('Der Tresor wurde nach 5 Minuten ohne Aktivität gesperrt.');
  });

  return session ? (
    <Suspense fallback={null}>
      <VaultScreen session={session} onLock={onLock} />
    </Suspense>
  ) : (
    <AuthScreen initialEmail={email} notice={notice} onSession={onSession} />
  );
}
