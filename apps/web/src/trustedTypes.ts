type ScriptUrlPolicy = { createScriptURL: (url: string) => string };
type PolicyFactory = { createPolicy: (name: string, rules: ScriptUrlPolicy) => unknown };

export function sameOriginScriptUrl(url: string, base: string): string {
  const parsed = new URL(url, base);
  const ownOrigin = new URL(base).origin;
  if ((parsed.protocol !== 'https:' && parsed.protocol !== 'http:') || parsed.origin !== ownOrigin) {
    throw new TypeError(`script URL not allowed: ${url}`);
  }
  return parsed.href;
}

export function installDefaultPolicy(factory: PolicyFactory | undefined, base: string): void {
  factory?.createPolicy('default', { createScriptURL: (url) => sameOriginScriptUrl(url, base) });
}

if (typeof location !== 'undefined') {
  installDefaultPolicy((globalThis as { trustedTypes?: PolicyFactory }).trustedTypes, location.href);
}
