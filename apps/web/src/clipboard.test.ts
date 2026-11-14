import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type Listener = () => void;

function environment(readable: boolean) {
  const state = { text: '', focused: true, listeners: new Map<string, Listener[]>() };
  const on = (type: string, fn: Listener) => state.listeners.set(type, [...(state.listeners.get(type) ?? []), fn]);
  vi.stubGlobal('navigator', {
    clipboard: {
      readText: async () => {
        if (!readable || !state.focused) throw new Error('NotAllowedError');
        return state.text;
      },
      writeText: async (t: string) => {
        if (!state.focused) throw new Error('Document is not focused');
        state.text = t;
      },
    },
  });
  vi.stubGlobal('document', { hasFocus: () => state.focused, addEventListener: on });
  vi.stubGlobal('window', { addEventListener: on });
  const fire = async (type: string) => {
    for (const fn of state.listeners.get(type) ?? []) fn();
    await vi.advanceTimersByTimeAsync(0);
  };
  return { state, fire };
}

async function load() {
  vi.resetModules();
  return import('./clipboard');
}

describe('clearing copied secrets', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('clears after 30 seconds while the app has focus', async () => {
    const { state } = environment(true);
    const { copySecret } = await load();
    await copySecret('geheim');
    expect(state.text).toBe('geheim');
    await vi.advanceTimersByTimeAsync(30_000);
    expect(state.text).toBe('');
  });

  it('clears once the person comes back after switching away to paste', async () => {
    const { state, fire } = environment(false);
    const { copySecret } = await load();
    await copySecret('geheim');
    state.focused = false;
    await vi.advanceTimersByTimeAsync(40_000);
    expect(state.text).toBe('geheim');
    state.focused = true;
    await fire('focus');
    expect(state.text).toBe('');
  });

  it('does not clear early when focus returns within 30 seconds', async () => {
    const { state, fire } = environment(true);
    const { copySecret } = await load();
    await copySecret('geheim');
    await fire('visibilitychange');
    expect(state.text).toBe('geheim');
  });

  it('leaves something else the person copied alone', async () => {
    const { state } = environment(true);
    const { copySecret } = await load();
    await copySecret('geheim');
    state.text = 'Einkaufsliste';
    await vi.advanceTimersByTimeAsync(30_000);
    expect(state.text).toBe('Einkaufsliste');
  });

  it('clears right away when locking', async () => {
    const { state } = environment(true);
    const { copySecret, clearClipboardNow } = await load();
    await copySecret('geheim');
    await clearClipboardNow();
    expect(state.text).toBe('');
  });
});
