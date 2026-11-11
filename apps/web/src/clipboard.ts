export const CLIPBOARD_CLEAR_SECONDS = 30;

let timer: ReturnType<typeof setTimeout> | undefined;

async function clearIfUnchanged(secret: string) {
  try {
    if ((await navigator.clipboard.readText()) !== secret) return;
  } catch {
    if (!document.hasFocus()) return;
  }
  await navigator.clipboard.writeText('').catch(() => undefined);
}

export async function copySecret(secret: string): Promise<void> {
  await navigator.clipboard.writeText(secret);
  clearTimeout(timer);
  timer = setTimeout(() => void clearIfUnchanged(secret), CLIPBOARD_CLEAR_SECONDS * 1000);
}
