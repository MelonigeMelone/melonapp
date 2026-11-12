import { describe, expect, it } from 'vitest';
import { deviceName } from './device';

const CHROME_WIN = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36';
const EDGE = `${CHROME_WIN} Edg/140.0`;
const OPERA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36 OPR/125.0';
const FIREFOX_LINUX = 'Mozilla/5.0 (X11; Linux x86_64; rv:140.0) Gecko/20100101 Firefox/140.0';
const SAFARI_MAC = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/19.0 Safari/605.1.15';
const SAFARI_IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 19_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/19.0 Mobile/15E148 Safari/604.1';

describe('deviceName', () => {
  it('names browser and operating system', () => {
    expect(deviceName(CHROME_WIN, 'https:')).toBe('Chrome auf Windows');
    expect(deviceName(EDGE, 'https:')).toBe('Edge auf Windows');
    expect(deviceName(OPERA, 'https:')).toBe('Opera auf Windows');
    expect(deviceName(FIREFOX_LINUX, 'https:')).toBe('Firefox auf Linux');
    expect(deviceName(SAFARI_MAC, 'https:')).toBe('Safari auf macOS');
    expect(deviceName(SAFARI_IPHONE, 'https:')).toBe('Safari auf iOS');
    expect(deviceName('curl/8', 'https:')).toBe('Browser');
  });

  it('marks the browser extension', () => {
    expect(deviceName(CHROME_WIN, 'chrome-extension:')).toBe('Erweiterung in Chrome auf Windows');
    expect(deviceName(FIREFOX_LINUX, 'moz-extension:')).toBe('Erweiterung in Firefox auf Linux');
  });
});
