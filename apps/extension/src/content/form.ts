const USERNAME_TYPES = new Set(['text', 'email', 'tel', '']);
const IDENTIFIER_HINT = /e-?mail|user|login|benutzer|konto|account|identifier|anmeld|kunden/i;
const NOT_IDENTIFIER = /search|suche|query|newsletter|coupon|gutschein|promo|captcha|otp|code|zip|plz/i;

export function isVisible(el: HTMLElement): boolean {
  if (!el.isConnected) return false;
  const style = getComputedStyle(el);
  if (style.visibility === 'hidden' || style.display === 'none' || Number(style.opacity) === 0) return false;
  const rect = el.getBoundingClientRect();
  return rect.width >= 4 && rect.height >= 4;
}

export interface LoginFields {
  username: HTMLInputElement | null;
  password: HTMLInputElement | null;
  isNew: boolean;
  otp?: HTMLInputElement;
}

function scopeOf(input: HTMLInputElement): ParentNode {
  return input.form ?? input.ownerDocument;
}

function describe(i: HTMLInputElement): string {
  return [i.name, i.id, i.autocomplete, i.placeholder, i.getAttribute('aria-label') ?? ''].join(' ');
}

export function findLoginFields(root: ParentNode, visible: (el: HTMLElement) => boolean = isVisible): LoginFields[] {
  const passwords = [...root.querySelectorAll<HTMLInputElement>('input[type="password"]')].filter(
    (p) => !p.disabled && !p.readOnly && visible(p),
  );
  return passwords.map((password) => {
    const scope = scopeOf(password);
    const inputs = [...scope.querySelectorAll<HTMLInputElement>('input')].filter((i) => !i.disabled && visible(i));
    const before = inputs.slice(0, inputs.indexOf(password)).reverse();
    const username =
      before.find((i) => USERNAME_TYPES.has(i.type) && /user|mail|login|name|konto|kunde|id/i.test(`${i.name} ${i.id} ${i.autocomplete}`)) ??
      before.find((i) => USERNAME_TYPES.has(i.type)) ??
      null;
    const siblings = inputs.filter((i) => i.type === 'password');
    const isNew = password.autocomplete === 'new-password' || siblings.length > 1;
    return { username, password, isNew };
  });
}

export function findIdentifierFields(root: ParentNode, visible: (el: HTMLElement) => boolean = isVisible): LoginFields[] {
  const candidates = [...root.querySelectorAll<HTMLInputElement>('input')].filter((i) => {
    if (i.disabled || i.readOnly || !USERNAME_TYPES.has(i.type) || !visible(i)) return false;
    if (i.closest('[role="search"]') || NOT_IDENTIFIER.test(describe(i))) return false;
    const auto = i.autocomplete.toLowerCase();
    return i.type === 'email' || auto.includes('username') || auto.includes('email') || IDENTIFIER_HINT.test(describe(i));
  });
  return candidates
    .filter((i) => ![...scopeOf(i).querySelectorAll<HTMLInputElement>('input[type="password"]')].some((p) => visible(p)))
    .map((username) => ({ username, password: null, isNew: false }));
}

const OTP_HINT = /otp|totp|2fa|mfa|one.?time|einmal|verif|bestätigung|authenticat|security.?code|sicherheitscode|token|\bcode\b/i;
const OTP_TYPES = new Set(['text', 'tel', 'number', '']);

export function isOtpField(i: HTMLInputElement): boolean {
  if (i.disabled || i.readOnly || !OTP_TYPES.has(i.type)) return false;
  if (i.autocomplete.toLowerCase() === 'one-time-code') return true;
  if (!OTP_HINT.test(describe(i))) return false;
  return !/zip|plz|post|promo|coupon|gutschein|captcha|search|such/i.test(describe(i));
}

export function findOtpFields(root: ParentNode, visible: (el: HTMLElement) => boolean = isVisible): HTMLInputElement[] {
  return [...root.querySelectorAll<HTMLInputElement>('input')].filter((i) => visible(i) && isOtpField(i));
}

export function fillOtp(input: HTMLInputElement, code: string, visible: (el: HTMLElement) => boolean = isVisible) {
  if (input.maxLength !== 1) {
    setValue(input, code);
    return;
  }
  const scope = input.form ?? input.parentElement?.parentElement ?? input.ownerDocument;
  const boxes = [...scope.querySelectorAll<HTMLInputElement>('input')].filter((i) => i.maxLength === 1 && !i.disabled && visible(i));
  const start = boxes.length >= code.length ? 0 : Math.max(0, boxes.indexOf(input));
  [...code].forEach((c, n) => {
    const box = boxes[start + n];
    if (box) setValue(box, c);
  });
}

export function setValue(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  input.focus();
  setter ? setter.call(input, value) : (input.value = value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
}
