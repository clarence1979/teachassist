import { useEffect, useState } from 'react';

export function useOrientation(): 'portrait' | 'landscape' {
  const getOrientation = (): 'portrait' | 'landscape' => {
    if (typeof window === 'undefined') return 'portrait';
    if (window.screen?.orientation?.type) {
      return window.screen.orientation.type.startsWith('landscape') ? 'landscape' : 'portrait';
    }
    return window.innerWidth > window.innerHeight ? 'landscape' : 'portrait';
  };

  const [orientation, setOrientation] = useState<'portrait' | 'landscape'>(getOrientation);

  useEffect(() => {
    const update = () => setOrientation(getOrientation());

    window.addEventListener('resize', update);
    window.addEventListener('orientationchange', update);
    if (window.screen?.orientation) {
      window.screen.orientation.addEventListener('change', update);
    }

    return () => {
      window.removeEventListener('resize', update);
      window.removeEventListener('orientationchange', update);
      if (window.screen?.orientation) {
        window.screen.orientation.removeEventListener('change', update);
      }
    };
  }, []);

  return orientation;
}
