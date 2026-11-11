import { beforeEach, describe, expect, it } from 'vitest';
import { fillOtp, findIdentifierFields, findLoginFields, findOtpFields, setValue } from './form';

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
    expect(f?.password?.name).toBe('pw');
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

  it('recognises the e-mail step of two-step logins', () => {
    document.body.innerHTML = `
      <form><input type="email" id="identifierId" autocomplete="username"><button>Weiter</button></form>`;
    const [f] = findIdentifierFields(document, always);
    expect(f?.username?.id).toBe('identifierId');
    expect(f?.password).toBeNull();
  });

  it('accepts text fields that look like a login name', () => {
    document.body.innerHTML = `<form><input name="login_name" placeholder="Benutzername"></form>`;
    expect(findIdentifierFields(document, always)).toHaveLength(1);
  });

  it('ignores search, newsletter and code fields and full login forms', () => {
    document.body.innerHTML = `
      <div role="search"><input type="email" name="q"></div>
      <form><input name="search" placeholder="Suche"></form>
      <form><input type="email" name="newsletter_email"></form>
      <form><input name="otp_code" autocomplete="one-time-code"></form>
      <form><input type="email" name="email"><input type="password" name="pw"></form>`;
    expect(findIdentifierFields(document, always)).toEqual([]);
  });
});

describe('one-time code fields', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('finds 2FA inputs but not postcodes, coupons or passwords', () => {
    document.body.innerHTML = `
      <form><input id="a" autocomplete="one-time-code"><input id="b" name="totp" inputmode="numeric"><input id="c" placeholder="Bestätigungscode"></form>
      <form><input name="plz_code"><input name="gutschein_code"><input type="password" name="otp"><input type="email" name="email"></form>`;
    expect(findOtpFields(document, always).map((i) => i.id)).toEqual(['a', 'b', 'c']);
  });

  it('spreads the code over single-digit boxes', () => {
    document.body.innerHTML = `<form>${'<input maxlength="1" autocomplete="one-time-code">'.repeat(6)}</form>`;
    const boxes = [...document.querySelectorAll('input')];
    fillOtp(boxes[2]!, '123456', always);
    expect(boxes.map((b) => b.value).join('')).toBe('123456');
  });

  it('fills a single field with the whole code', () => {
    document.body.innerHTML = `<input name="otp">`;
    const input = document.querySelector('input')!;
    fillOtp(input, '654321', always);
    expect(input.value).toBe('654321');
  });
});
