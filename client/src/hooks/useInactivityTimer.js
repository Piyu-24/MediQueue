import { useEffect, useRef, useCallback } from 'react';

const INACTIVITY_EVENTS = ['mousemove', 'mousedown', 'keydown', 'touchstart', 'scroll', 'click'];

/**
 * Calls `onTimeout` after `timeoutMs` of user inactivity.
 * Resets on any mouse, keyboard, touch, or scroll event.
 * Only active when `enabled` is true.
 */
const useInactivityTimer = ({ timeoutMs = 10 * 60 * 1000, onTimeout, enabled = true }) => {
  const timerRef = useRef(null);

  const resetTimer = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(onTimeout, timeoutMs);
  }, [onTimeout, timeoutMs]);

  useEffect(() => {
    if (!enabled) {
      if (timerRef.current) clearTimeout(timerRef.current);
      return;
    }

    INACTIVITY_EVENTS.forEach((event) => window.addEventListener(event, resetTimer, { passive: true }));
    resetTimer();

    return () => {
      INACTIVITY_EVENTS.forEach((event) => window.removeEventListener(event, resetTimer));
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [enabled, resetTimer]);
};

export default useInactivityTimer;
