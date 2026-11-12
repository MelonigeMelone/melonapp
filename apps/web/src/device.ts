import { nativePlatform } from './platform';

export function deviceName(userAgent = navigator.userAgent, protocol = location.protocol): string {
  const native = nativePlatform();
  if (native) return native.supportsAutofill ? 'MelonApp für iPhone' : 'MelonApp für Mac';
  const browser = /Edg\//.test(userAgent)
    ? 'Edge'
    : /OPR\/|Opera/.test(userAgent)
      ? 'Opera'
      : /Firefox\//.test(userAgent)
        ? 'Firefox'
        : /Chrome\//.test(userAgent)
          ? 'Chrome'
          : /Safari\//.test(userAgent)
            ? 'Safari'
            : 'Browser';
  const os = /iPhone|iPad/.test(userAgent)
    ? 'iOS'
    : /Android/.test(userAgent)
      ? 'Android'
      : /Mac OS X/.test(userAgent)
        ? 'macOS'
        : /Windows/.test(userAgent)
          ? 'Windows'
          : /Linux/.test(userAgent)
            ? 'Linux'
            : '';
  const extension = /^(chrome|moz)-extension:$/.test(protocol);
  return `${extension ? 'Erweiterung in ' : ''}${browser}${os ? ` auf ${os}` : ''}`;
}
