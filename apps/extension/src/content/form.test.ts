import { beforeEach, describe, expect, it } from 'vitest';
import { findLoginFields, setValue } from './form';

const always = () => true;

describe('login form detection', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('pairs the password with the username field before it', () => {
    document.body.innerHTML = `
      <form><input name="search"><input type="email" name="email"><input type="password" name="pw"></form>`;
    const [f] = findLoginFields(document, always);
    expect(f?.username?.name).toBe('email');
    expect(f?.password.name).toBe('pw');
    expect(f?.isNew).toBe(false);
  });

  it('recognises sign-up forms', () => {
    document.body.innerHTML = `
      <form><input name="user"><input type="password" name="a"><input type="password" name="b"></form>
      <form><input name="u2"><input type="password" autocomplete="new-password" name="c"></form>`;
    const found = findLoginFields(document, always);
    expect(found.every((f) => f.isNew)).toBe(true);
  });

  it('ignores hidden, disabled and read-only password fields', () => {
    document.body.innerHTML = `
      <form><input name="u"><input type="password" name="hidden" data-hidden><input type="password" disabled><input type="password" readonly></form>`;
    const visible = (el: HTMLElement) => !el.hasAttribute('data-hidden');
    expect(findLoginFields(document, visible)).toEqual([]);
  });

  it('works without a form element', () => {
    document.body.innerHTML = `<div><input id="login"><input type="password" id="pw"></div>`;
    const [f] = findLoginFields(document, always);
    expect(f?.username?.id).toBe('login');
  });

  it('fills in a way frameworks notice', () => {
    document.body.innerHTML = `<input id="x">`;
    const input = document.getElementById('x') as HTMLInputElement;
    const events: string[] = [];
    input.addEventListener('input', () => events.push('input'));
    input.addEventListener('change', () => events.push('change'));
    setValue(input, 'melone');
    expect(input.value).toBe('melone');
    expect(events).toEqual(['input', 'change']);
  });
});
