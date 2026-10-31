import { useEffect, useState } from 'react';

export function useMobile(breakpoint = 768): boolean {
  const [isMobile, setIsMobile] = useState(() => window.innerWidth < breakpoint);

  useEffect(() => {
    const mq = window.matchMedia(`(max-width: ${breakpoint - 1}px)`);
    const update = () => setIsMobile(window.innerWidth < breakpoint);
    const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches);

    mq.addEventListener('change', handler);
    // Re-evaluate on orientation change (iOS fires resize after a short delay,
    // but the orientationchange event fires first and innerWidth is already updated)
    window.addEventListener('orientationchange', update);
    window.addEventListener('resize', update);

    setIsMobile(mq.matches);
    return () => {
      mq.removeEventListener('change', handler);
      window.removeEventListener('orientationchange', update);
      window.removeEventListener('resize', update);
    };
  }, [breakpoint]);

  return isMobile;
}
