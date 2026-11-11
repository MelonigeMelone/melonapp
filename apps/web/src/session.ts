import { api, ApiError, DEFAULT_KDF, NetworkError } from './api';
import { cryptoCall } from './crypto/client';
import { VaultStore } from './vault/store';

export interface Session {
  email: string;
  token: string;
  store: VaultStore;
}

function openStore(token: string): VaultStore {
  return new VaultStore(
    {
      encrypt: (module, id, plaintext) => cryptoCall('encrypt', { module, id, plaintext }),
      decryptMany: (module, items) => cryptoCall('decryptMany', { module, items }),
    },
    {
      list: (since) => api.listItems(token, since),
      put: (id, body) => api.putItem(token, id, body),
      remove: (id, base) => api.deleteItem(token, id, base),
    },
  );
}

export async function login(email: string, password: string): Promise<Session> {
  const pre = await api.prelogin(email);
  const authKey = await cryptoCall('derive', { password, salt: pre.salt, kdf: pre.kdf });
  try {
    const res = await api.login({ email, auth_key: authKey });
    await cryptoCall('unlock', { wrapped: res.wrapped_vault_key });
    return { email, token: res.token, store: openStore(res.token) };
  } catch (e) {
    await cryptoCall('lock');
    throw e;
  }
}

export async function register(email: string, password: string): Promise<Session> {
  const salt = await cryptoCall('generateSalt');
  const authKey = await cryptoCall('derive', { password, salt, kdf: DEFAULT_KDF });
  try {
    const wrapped = await cryptoCall('createVault');
    await api.register({ email, kdf: DEFAULT_KDF, salt, auth_key: authKey, wrapped_vault_key: wrapped });
    const res = await api.login({ email, auth_key: authKey });
    return { email, token: res.token, store: openStore(res.token) };
  } catch (e) {
    await cryptoCall('lock');
    throw e;
  }
}

export async function lock(session: Session | null) {
  await cryptoCall('lock');
  if (session) await api.logout(session.token).catch(() => undefined);
}

const messages: Record<string, string> = {
  unauthorized: 'E-Mail oder Master-Passwort ist falsch.',
  too_many_requests: 'Zu viele Fehlversuche. Warte 15 Minuten und versuche es dann erneut.',
  registration_disabled:
    'Auf diesem Server ist die Registrierung ausgeschaltet. Setze MELON_ALLOW_REGISTRATION=true und starte den Server neu.',
  email_taken: 'Für diese E-Mail gibt es schon ein Konto. Melde dich an.',
  invalid_email: 'Gib eine gültige E-Mail-Adresse ein.',
  item_too_large: 'Der Eintrag ist zu groß. Kürze die Notizen.',
  revision_mismatch: 'Der Eintrag wurde gleichzeitig auf einem anderen Gerät geändert. Versuche es erneut.',
};

export function describeError(e: unknown): string {
  if (e instanceof ApiError) return messages[e.code] ?? `Der Server meldet einen Fehler (${e.code}).`;
  if (e instanceof NetworkError) return 'Der Server ist nicht erreichbar. Prüfe deine Verbindung.';
  if (e instanceof Error && e.message.includes('KDF')) {
    return 'Der Server hat ungültige Sicherheitsparameter geschickt. Anmeldung abgebrochen.';
  }
  console.error(e);
  return 'Etwas ist schiefgelaufen. Lade die Seite neu und versuche es erneut.';
}
