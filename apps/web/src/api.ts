export interface Kdf {
  memory_kib: number;
  iterations: number;
  parallelism: number;
}

export const DEFAULT_KDF: Kdf = { memory_kib: 65536, iterations: 3, parallelism: 4 };

export interface RemoteItem {
  id: string;
  module: string;
  data: string | null;
  revision: number;
  deleted: boolean;
}

export interface SyncPage {
  items: RemoteItem[];
  latest_revision: number;
  has_more: boolean;
}

export interface PutBody {
  module: string;
  data: string;
  base_revision: number | null;
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

async function request<T>(
  method: string,
  path: string,
  opts: { token?: string; body?: unknown } = {},
): Promise<T> {
  const headers: Record<string, string> = {};
  if (opts.body !== undefined) headers['content-type'] = 'application/json';
  if (opts.token) headers.authorization = `Bearer ${opts.token}`;
  let res: Response;
  try {
    res = await fetch(`/api/v1${path}`, {
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
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export const api = {
  prelogin: (email: string) =>
    request<{ kdf: Kdf; salt: string }>('POST', '/auth/prelogin', { body: { email } }),
  register: (body: {
    email: string;
    kdf: Kdf;
    salt: string;
    auth_key: string;
    wrapped_vault_key: string;
  }) => request<{ user_id: string }>('POST', '/auth/register', { body }),
  login: (body: { email: string; auth_key: string }) =>
    request<{ token: string; expires_in_seconds: number; user_id: string; wrapped_vault_key: string }>(
      'POST',
      '/auth/login',
      { body },
    ),
  logout: (token: string) => request<void>('POST', '/auth/logout', { token }),
  listItems: (token: string, since: number) =>
    request<SyncPage>('GET', `/vault/items?since=${since}`, { token }),
  putItem: (token: string, id: string, body: PutBody) =>
    request<{ revision: number }>('PUT', `/vault/items/${encodeURIComponent(id)}`, { token, body }),
  deleteItem: (token: string, id: string, baseRevision: number) =>
    request<{ revision: number }>(
      'DELETE',
      `/vault/items/${encodeURIComponent(id)}?base_revision=${baseRevision}`,
      { token },
    ),
};
