import { useEffect, useRef } from 'react';

const EVENTS = ['pointerdown', 'keydown', 'wheel', 'touchstart'] as const;

export function useIdle(timeoutMs: number, onIdle: () => void) {
  const callback = useRef(onIdle);
  callback.current = onIdle;

  useEffect(() => {
    let last = Date.now();
    const touch = () => {
      last = Date.now();
    };
    const check = () => {
      if (Date.now() - last >= timeoutMs) callback.current();
    };
    const interval = setInterval(check, 5000);
    const onVisible = () => document.visibilityState === 'visible' && check();
    for (const e of EVENTS) window.addEventListener(e, touch, { passive: true });
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(interval);
      for (const e of EVENTS) window.removeEventListener(e, touch);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [timeoutMs]);
}
