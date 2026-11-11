import { lazy, Suspense, useCallback, useEffect, useState } from 'react';
import { AuthScreen } from './screens/AuthScreen';
import { lock, type Account, type Session } from './session';
import { useAutoLockMinutes } from './prefs';
import { useIdle } from './useIdle';
import { nativePlatform } from './platform';

const loadShell = () => import('./Shell');
const Shell = lazy(() => loadShell().then((m) => ({ default: m.Shell })));

const INVITE = /^#\/invite\/([A-Za-z0-9_-]{20,})$/;

function inviteFromUrl(): string | null {
  return INVITE.exec(window.location.hash)?.[1] ?? null;
}

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

  useEffect(() => {
    const platform = nativePlatform();
    if (!platform) return;
    let disposed = false;
    let cleanup: (() => void) | undefined;
    void platform.onLock(() => {
      setSession(null);
      setNotice('MelonApp wurde gesperrt.');
    }).then((off) => { if (disposed) off(); else cleanup = off; });
    return () => { disposed = true; cleanup?.(); };
  }, []);

  const onUpdate = useCallback((update: Partial<Account>) => {
    setSession((s) => (s ? { ...s, ...update } : s));
  }, []);

  useEffect(() => {
    void loadShell();
  }, []);

  const autoLock = useAutoLockMinutes();
  useIdle(autoLock * 60_000, () => {
    if (session) onLock(`MelonApp wurde nach ${autoLock === 1 ? '1 Minute' : `${autoLock} Minuten`} ohne Aktivität gesperrt.`);
  });

  return session ? (
    <Suspense fallback={null}>
      <Shell session={session} onLock={onLock} onUpdate={onUpdate} />
    </Suspense>
  ) : (
    <AuthScreen initialEmail={email} notice={notice} inviteToken={inviteToken} onSession={onSession} />
  );
}
