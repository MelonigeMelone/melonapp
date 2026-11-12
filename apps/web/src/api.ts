export interface Kdf {
  memory_kib: number;
  iterations: number;
  parallelism: number;
}

export const DEFAULT_KDF: Kdf = { memory_kib: 65536, iterations: 3, parallelism: 4 };

export type Role = 'owner' | 'editor' | 'viewer';

export interface RemoteMember {
  user_id: string;
  email: string;
  role: Role;
  public_key: string;
  has_key: boolean;
  key_version: number | null;
}

export interface RemoteVault {
  id: string;
  personal: boolean;
  encrypted_meta: string;
  key_version: number;
  revision: number;
  rotation_needed: boolean;
  role: Role;
  encrypted_vault_key: string | null;
  member_key_version: number | null;
  members: RemoteMember[];
}

export interface RemoteItem {
  id: string;
  data: string | null;
  key_version: number;
  revision: number;
  deleted: boolean;
}

export interface ItemPage {
  items: RemoteItem[];
  latest_revision: number;
  has_more: boolean;
}

export interface PutBody {
  data: string;
  key_version: number;
  base_revision: number | null;
}

export interface RegisterBody {
  user_id: string;
  email: string;
  kdf: Kdf;
  salt: string;
  auth_key: string;
  wrapped_account_key: string;
  public_key: string;
  encrypted_private_key: string;
  personal_vault: { id: string; encrypted_meta: string; encrypted_vault_key: string };
  invite_token: string | null;
}

export interface LoginResult {
  token: string;
  expires_in_seconds: number;
  user_id: string;
  wrapped_account_key: string;
  public_key: string;
  encrypted_private_key: string;
  has_recovery: boolean;
}

export interface NewCredentials {
  kdf: Kdf;
  salt: string;
  auth_key: string;
  wrapped_account_key: string;
}

export interface RotateBody {
  key_version: number;
  encrypted_meta: string;
  members: { user_id: string; encrypted_vault_key: string }[];
  items: { id: string; data: string; base_revision: number }[];
  remove_user_ids: string[];
}

export interface InviteInfo {
  id: string;
  email: string;
  role: Role;
  expires_in_hours: number;
}

export class NetworkError extends Error {}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(code);
  }
}

let apiBase = '';

export type NativeRequest = (method: string, path: string, opts: { token?: string; body?: unknown }) => Promise<{ status: number; body: string }>;
let nativeRequest: NativeRequest | null = null;
export function setNativeRequest(request: NativeRequest) { nativeRequest = request; }

export function setApiBase(base: string) {
  apiBase = base.replace(/\/+$/, '');
}

async function request<T>(method: string, path: string, opts: { token?: string; body?: unknown } = {}): Promise<T> {
  const headers: Record<string, string> = {};
  if (opts.body !== undefined) headers['content-type'] = 'application/json';
  if (opts.token) headers.authorization = `Bearer ${opts.token}`;
  let res: Response;
  try {
    res = nativeRequest ? await nativeRequest(method, path, opts).then((r) => new Response(r.status === 204 ? null : r.body, { status: r.status })) : await fetch(`${apiBase}/api/v1${path}`, {
      method,
      headers,
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
      cache: 'no-store',
      credentials: 'omit',
    });
  } catch (e) {
    throw new NetworkError(e instanceof Error ? e.message : String(e));
  }
  if (!res.ok) {
    let code = `http_${res.status}`;
    try {
      const json: unknown = await res.json();
      if (json && typeof json === 'object' && typeof (json as { error?: unknown }).error === 'string') {
        code = (json as { error: string }).error;
      }
    } catch {
      code = `http_${res.status}`;
    }
    throw new ApiError(res.status, code);
  }
  const text = await res.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

const v = (id: string) => `/vaults/${encodeURIComponent(id)}`;

export const api = {
  prelogin: (email: string) => request<{ kdf: Kdf; salt: string }>('POST', '/auth/prelogin', { body: { email } }),
  register: (body: RegisterBody) => request<{ user_id: string }>('POST', '/auth/register', { body }),
  login: (body: { email: string; auth_key: string; device?: string }) => request<LoginResult>('POST', '/auth/login', { body }),
  logout: (token: string) => request<void>('POST', '/auth/logout', { token }),
  recoverStart: (email: string, recovery_auth_key: string) =>
    request<{ token: string; expires_in_seconds: number; recovery_wrapped_account_key: string }>('POST', '/auth/recover/start', {
      body: { email, recovery_auth_key },
    }),
  recoverComplete: (token: string, body: NewCredentials) =>
    request<void>('POST', '/auth/recover/complete', { token, body }),
  invitePreview: (token: string) =>
    request<{ email: string; invited_by: string }>('POST', '/auth/invites/preview', { body: { token } }),
};

export type Api = ReturnType<typeof authed>;

export interface DeviceSession {
  id: string;
  device: string;
  created_at: number;
  last_seen_at: number;
  current: boolean;
}

export function authed(token: string) {
  const o = { token };
  return {
    lookupUser: (email: string) =>
      request<{ user_id: string; email: string; public_key: string }>(
        'GET',
        `/users/lookup?email=${encodeURIComponent(email)}`,
        o,
      ),
    changePassword: (body: NewCredentials & { current_auth_key: string }) =>
      request<void>('PUT', '/account/password', { ...o, body }),
    setRecovery: (body: { current_auth_key: string; recovery_auth_key: string; recovery_wrapped_account_key: string }) =>
      request<void>('PUT', '/account/recovery', { ...o, body }),
    listSessions: () => request<{ sessions: DeviceSession[] }>('GET', '/sessions', o),
    revokeSession: (id: string) => request<void>('DELETE', `/sessions/${encodeURIComponent(id)}`, o),
    revokeOtherSessions: () => request<void>('DELETE', '/sessions', o),
    listVaults: () => request<{ vaults: RemoteVault[] }>('GET', '/vaults', o),
    createVault: (body: { id: string; encrypted_meta: string; encrypted_vault_key: string }) =>
      request<{ revision: number }>('POST', '/vaults', { ...o, body }),
    updateVault: (id: string, body: { encrypted_meta: string; key_version: number }) =>
      request<{ revision: number }>('PUT', v(id), { ...o, body }),
    deleteVault: (id: string) => request<void>('DELETE', v(id), o),
    listItems: (id: string, since: number) => request<ItemPage>('GET', `${v(id)}/items?since=${since}`, o),
    putItem: (id: string, itemId: string, body: PutBody) =>
      request<{ revision: number }>('PUT', `${v(id)}/items/${encodeURIComponent(itemId)}`, { ...o, body }),
    deleteItem: (id: string, itemId: string, base: number) =>
      request<{ revision: number }>('DELETE', `${v(id)}/items/${encodeURIComponent(itemId)}?base_revision=${base}`, o),
    addMember: (id: string, body: { user_id: string; role: Role; encrypted_vault_key: string; key_version: number }) =>
      request<void>('POST', `${v(id)}/members`, { ...o, body }),
    changeRole: (id: string, userId: string, role: Role) =>
      request<void>('PUT', `${v(id)}/members/${encodeURIComponent(userId)}`, { ...o, body: { role } }),
    grantKey: (id: string, userId: string, body: { encrypted_vault_key: string; key_version: number }) =>
      request<void>('PUT', `${v(id)}/members/${encodeURIComponent(userId)}/key`, { ...o, body }),
    removeMember: (id: string, userId: string) =>
      request<void>('DELETE', `${v(id)}/members/${encodeURIComponent(userId)}`, o),
    rotate: (id: string, body: RotateBody) => request<void>('POST', `${v(id)}/rotate`, { ...o, body }),
    createInvite: (id: string, email: string, role: Role) =>
      request<{ id: string; token: string; expires_in_days: number }>('POST', `${v(id)}/invites`, {
        ...o,
        body: { email, role },
      }),
    listInvites: (id: string) => request<{ invites: InviteInfo[] }>('GET', `${v(id)}/invites`, o),
    deleteInvite: (id: string, inviteId: string) =>
      request<void>('DELETE', `${v(id)}/invites/${encodeURIComponent(inviteId)}`, o),
  };
}
