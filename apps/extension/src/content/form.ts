const USERNAME_TYPES = new Set(['text', 'email', 'tel', '']);

export function isVisible(el: HTMLElement): boolean {
  if (!el.isConnected) return false;
  const style = getComputedStyle(el);
  if (style.visibility === 'hidden' || style.display === 'none' || Number(style.opacity) === 0) return false;
  const rect = el.getBoundingClientRect();
  return rect.width >= 4 && rect.height >= 4;
}

export interface LoginFields {
  username: HTMLInputElement | null;
  password: HTMLInputElement;
  isNew: boolean;
}

function scopeOf(input: HTMLInputElement): ParentNode {
  return input.form ?? input.ownerDocument;
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

export function setValue(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  input.focus();
  setter ? setter.call(input, value) : (input.value = value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
}
