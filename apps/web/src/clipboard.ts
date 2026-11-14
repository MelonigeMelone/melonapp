export const CLIPBOARD_CLEAR_SECONDS = 30;

interface Pending {
  secret: string;
  due: number;
}

let pending: Pending | null = null;
let timer: ReturnType<typeof setTimeout> | undefined;
let watching = false;

async function readClipboard(): Promise<string | null> {
  try {
    return await navigator.clipboard.readText();
  } catch {
    return null;
  }
}

async function clearPending(now: boolean): Promise<void> {
  const p = pending;
  if (!p || (!now && Date.now() < p.due) || !document.hasFocus()) return;
  const current = await readClipboard();
  if (current !== null && current !== p.secret) {
    if (pending === p) pending = null;
    return;
  }
  try {
    await navigator.clipboard.writeText('');
    if (pending === p) pending = null;
  } catch {
    return;
  }
}

function retryOnReturn() {
  if (pending) void clearPending(false);
}

function watch() {
  if (watching) return;
  watching = true;
  window.addEventListener('focus', retryOnReturn);
  document.addEventListener('visibilitychange', retryOnReturn);
}

export async function copySecret(secret: string): Promise<void> {
  await navigator.clipboard.writeText(secret);
  watch();
  pending = { secret, due: Date.now() + CLIPBOARD_CLEAR_SECONDS * 1000 };
  clearTimeout(timer);
  timer = setTimeout(() => void clearPending(false), CLIPBOARD_CLEAR_SECONDS * 1000);
}

export function clearClipboardNow(): Promise<void> {
  clearTimeout(timer);
  return clearPending(true);
}
