import { lazy, Suspense, useCallback, useEffect, useState } from 'react';
import { AuthScreen } from './screens/AuthScreen';
import { lock, type Account, type Session } from './session';
import { useIdle } from './useIdle';

const loadShell = () => import('./Shell');
const Shell = lazy(() => loadShell().then((m) => ({ default: m.Shell })));

const INVITE = /^#\/invite\/([A-Za-z0-9_-]{20,})$/;

function inviteFromUrl(): string | null {
  return INVITE.exec(window.location.hash)?.[1] ?? null;
}

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
  const [inviteToken, setInviteToken] = useState(inviteFromUrl);

  const onSession = useCallback((s: Session) => {
    rememberEmail(s.email);
    setEmail(s.email);
    setNotice(null);
    setInviteToken(null);
    if (window.location.hash.startsWith('#/invite/')) window.history.replaceState(null, '', `${window.location.pathname}#/`);
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

  const onUpdate = useCallback((update: Partial<Account>) => {
    setSession((s) => (s ? { ...s, ...update } : s));
  }, []);

  useEffect(() => {
    void loadShell();
  }, []);

  useIdle(AUTO_LOCK_MS, () => {
    if (session) onLock('MelonApp wurde nach 5 Minuten ohne Aktivität gesperrt.');
  });

  return session ? (
    <Suspense fallback={null}>
      <Shell session={session} onLock={onLock} onUpdate={onUpdate} />
    </Suspense>
  ) : (
    <AuthScreen initialEmail={email} notice={notice} inviteToken={inviteToken} onSession={onSession} />
  );
}
