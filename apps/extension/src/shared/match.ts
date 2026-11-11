export function hostOf(url: string): string | null {
  try {
    const u = new URL(/^[a-z][a-z0-9+.-]*:/i.test(url.trim()) ? url.trim() : `https://${url.trim()}`);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
    return u.hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return null;
  }
}

function protocolOf(url: string): string | null {
  try {
    return new URL(url).protocol;
  } catch {
    return null;
  }
}

export function urlMatches(pageUrl: string, itemUrl: string): boolean {
  const page = hostOf(pageUrl);
  const item = hostOf(itemUrl);
  if (!page || !item) return false;
  const pageProtocol = protocolOf(pageUrl);
  const itemProtocol = /^http:/i.test(itemUrl.trim()) ? 'http:' : 'https:';
  if (pageProtocol === 'http:' && itemProtocol === 'https:' && page !== 'localhost') return false;
  return page === item || page.endsWith(`.${item}`);
}

export function siteOf(url: string): string | null {
  const host = hostOf(url);
  if (!host) return null;
  if (/^[\d.]+$/.test(host) || host === 'localhost') return host;
  return host.split('.').slice(-2).join('.');
}

export function anyUrlMatches(pageUrl: string, itemUrls: readonly string[]): boolean {
  return itemUrls.some((u) => urlMatches(pageUrl, u));
}
