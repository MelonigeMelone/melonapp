export class InsecureServerError extends Error {
  constructor() {
    super('insecure_server');
  }
}

export function normalizeServer(input: string): string {
  const trimmed = input.trim().replace(/\/+$/, '');
  const url = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  if (/^http:/i.test(url)) {
    let host = '';
    try {
      host = new URL(url).hostname;
    } catch {
      throw new InsecureServerError();
    }
    if (!['localhost', '127.0.0.1', '[::1]'].includes(host)) throw new InsecureServerError();
  }
  return url;
}
