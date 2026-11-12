import { nativePlatform } from './platform';
import { api, ApiError, authed, DEFAULT_KDF, NetworkError, type Kdf } from './api';
import { cryptoCall } from './crypto/client';
import { deviceName } from './device';
import { newId } from './vault/item';
import { VaultsManager } from './vault/manager';

export interface Account {
  kdf: Kdf;
  salt: string;
  wrappedAccountKey: string;
  publicKey: string;
  hasRecovery: boolean;
}

export interface Session extends Account {
  email: string;
  userId: string;
  token: string;
  vaults: VaultsManager;
}

export function open(email: string, userId: string, token: string, account: Account): Session {
  return { email, userId, token, vaults: new VaultsManager(userId, authed(token), cryptoCall), ...account };
}

export async function login(email: string, password: string): Promise<Session> {
  const pre = await api.prelogin(email);
  const authKey = await cryptoCall('derive', { password, salt: pre.salt, kdf: pre.kdf });
  try {
    const res = await api.login({ email, auth_key: authKey, device: deviceName() });
    const publicKey = await cryptoCall('unlock', {
      wrappedAccountKey: res.wrapped_account_key,
      encryptedPrivateKey: res.encrypted_private_key,
    });
    if (publicKey !== res.public_key) {
      await api.logout(res.token).catch(() => undefined);
      throw new ApiError(409, 'public_key_mismatch');
    }
    return open(email, res.user_id, res.token, {
      kdf: pre.kdf,
      salt: pre.salt,
      wrappedAccountKey: res.wrapped_account_key,
      publicKey,
      hasRecovery: res.has_recovery,
    });
  } catch (e) {
    await cryptoCall('lock');
    throw e;
  }
}

export async function register(email: string, password: string, inviteToken: string | null): Promise<Session> {
  const salt = await cryptoCall('generateSalt');
  const authKey = await cryptoCall('derive', { password, salt, kdf: DEFAULT_KDF });
  const userId = newId();
  const personalVaultId = newId();
  try {
    const account = await cryptoCall('createAccount', {
      userId,
      personalVaultId,
      meta: JSON.stringify({ name: 'Persönlich' }),
    });
    await api.register({
      user_id: userId,
      email,
      kdf: DEFAULT_KDF,
      salt,
      auth_key: authKey,
      wrapped_account_key: account.wrappedAccountKey,
      public_key: account.publicKey,
      encrypted_private_key: account.encryptedPrivateKey,
      personal_vault: {
        id: personalVaultId,
        encrypted_meta: account.personalVault.encryptedMeta,
        encrypted_vault_key: account.personalVault.encryptedVaultKey,
      },
      invite_token: inviteToken,
    });
    const res = await api.login({ email, auth_key: authKey, device: deviceName() });
    return open(email, res.user_id, res.token, {
      kdf: DEFAULT_KDF,
      salt,
      wrappedAccountKey: account.wrappedAccountKey,
      publicKey: account.publicKey,
      hasRecovery: false,
    });
  } catch (e) {
    await cryptoCall('lock');
    throw e;
  }
}

function reauth(session: Session, password: string) {
  return { password, salt: session.salt, kdf: session.kdf, wrappedAccountKey: session.wrappedAccountKey };
}

export function sealExport(session: Session, password: string, exportPassword: string, plaintext: string): Promise<string> {
  return cryptoCall('sealExport', { ...reauth(session, password), exportPassword, plaintext });
}

export async function checkPassword(session: Session, password: string): Promise<void> {
  await cryptoCall('checkPassword', reauth(session, password));
}

export function openExport(password: string, data: string): Promise<string> {
  return cryptoCall('openExport', { password, data });
}

export async function setupRecovery(session: Session, password: string): Promise<{ recoveryKey: string; account: Partial<Account> }> {
  const r = await cryptoCall('setupRecovery', reauth(session, password));
  await authed(session.token).setRecovery({
    current_auth_key: r.currentAuthKey,
    recovery_auth_key: r.recoveryAuthKey,
    recovery_wrapped_account_key: r.recoveryWrappedAccountKey,
  });
  return { recoveryKey: r.recoveryKey, account: { hasRecovery: true } };
}

export async function changePassword(session: Session, current: string, next: string): Promise<Partial<Account>> {
  const newSalt = await cryptoCall('generateSalt');
  const r = await cryptoCall('changePassword', { ...reauth(session, current), newPassword: next, newSalt, newKdf: DEFAULT_KDF });
  await authed(session.token).changePassword({
    current_auth_key: r.currentAuthKey,
    kdf: DEFAULT_KDF,
    salt: newSalt,
    auth_key: r.authKey,
    wrapped_account_key: r.wrappedAccountKey,
  });
  return { kdf: DEFAULT_KDF, salt: newSalt, wrappedAccountKey: r.wrappedAccountKey };
}

export async function recoverAccount(email: string, recoveryKey: string, newPassword: string): Promise<Session> {
  let recoveryAuthKey: string;
  try {
    recoveryAuthKey = await cryptoCall('recoveryAuth', { recoveryKey });
  } catch {
    throw new ApiError(400, 'invalid_recovery_key');
  }
  const started = await api.recoverStart(email, recoveryAuthKey);
  const newSalt = await cryptoCall('generateSalt');
  const creds = await cryptoCall('recoveryReset', {
    recoveryWrappedAccountKey: started.recovery_wrapped_account_key,
    newPassword,
    newSalt,
    newKdf: DEFAULT_KDF,
  });
  await api.recoverComplete(started.token, {
    kdf: DEFAULT_KDF,
    salt: newSalt,
    auth_key: creds.authKey,
    wrapped_account_key: creds.wrappedAccountKey,
  });
  return login(email, newPassword);
}

export async function lock(session: Session | null) {
  await cryptoCall('lock');
  if (!session) return;
  const platform = nativePlatform();
  if (platform && (await platform.biometricKeepsToken(session.token).catch(() => false))) return;
  await api.logout(session.token).catch(() => undefined);
}

const messages: Record<string, string> = {
  unauthorized: 'E-Mail oder Master-Passwort ist falsch.',
  wrong_password: 'Das Master-Passwort stimmt nicht.',
  invalid_recovery_key: 'Der Recovery-Key ist unvollständig oder hat einen Tippfehler. Prüfe jede Vierergruppe.',
  too_many_requests: 'Zu viele Fehlversuche. Warte 15 Minuten und versuche es dann erneut.',
  registration_disabled:
    'Auf diesem Server ist die Registrierung ausgeschaltet. Du brauchst einen Einladungslink, oder der Betreiber setzt MELON_ALLOW_REGISTRATION=true.',
  email_taken: 'Für diese E-Mail gibt es schon ein Konto. Melde dich an.',
  invalid_email: 'Gib eine gültige E-Mail-Adresse ein.',
  invalid_invite: 'Der Einladungslink ist abgelaufen oder wurde schon benutzt. Bitte um einen neuen.',
  invite_email_mismatch: 'Die Einladung gilt für eine andere E-Mail-Adresse.',
  item_too_large: 'Der Eintrag ist zu groß. Kürze die Notizen.',
  revision_mismatch: 'Der Eintrag wurde gleichzeitig auf einem anderen Gerät geändert. Versuche es erneut.',
  key_rotated: 'Der Bereich hat gerade einen neuen Schlüssel bekommen. Speichere noch einmal.',
  read_only: 'In diesem Bereich darfst du nur lesen.',
  owner_only: 'Das darf nur ein Besitzer des Bereichs.',
  last_owner: 'Ein Bereich braucht mindestens einen Besitzer. Mach zuerst jemand anderen zum Besitzer.',
  member_exists_or_unknown_user: 'Diese Person ist schon Mitglied.',
  user_exists: 'Für diese E-Mail gibt es schon ein Konto. Sie wird direkt hinzugefügt.',
  vault_key_pending: 'Ein Besitzer muss dir den Zugang noch freigeben. Das passiert automatisch, sobald er die App öffnet.',
  key_changed:
    'Der Sicherheitscode einer Person hat sich geändert, seit du ihn geprüft hast. Der Schlüssel wird ihr erst wieder gegeben, wenn du den Code im Bereich neu prüfst (Fingerabdruck-Knopf).',
  verifications_unavailable:
    'Deine geprüften Sicherheitscodes konnten nicht geladen werden oder sind älter als zuletzt gesehen. Bis das geklärt ist, gibt die App keine Bereichs-Schlüssel weiter. Lade neu, und wenn es bleibt, prüfe den Server.',
  vault_not_found: 'Diesen Bereich gibt es nicht mehr, oder du hast keinen Zugriff mehr.',
  public_key_mismatch:
    'Der Server hat für dein Konto einen falschen öffentlichen Schlüssel gemeldet. Die Anmeldung wurde abgebrochen. Prüfe den Server, bevor du weitermachst.',
};

export function describeError(e: unknown): string {
  if (e instanceof ApiError) return messages[e.code] ?? `Der Server meldet einen Fehler (${e.code}).`;
  if (e instanceof NetworkError) return 'Der Server ist nicht erreichbar. Prüfe deine Verbindung.';
  if (e instanceof Error && e.message.includes('KDF')) {
    return 'Der Server hat ungültige Sicherheitsparameter geschickt. Anmeldung abgebrochen.';
  }
  return 'Etwas ist schiefgelaufen. Lade die Seite neu und versuche es erneut.';
}
