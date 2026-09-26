import { useCallback, useState } from 'react';

import { useVisualActivityEffect } from '@/shared/hooks/useVisualActivityEffect';

/** Refresh at a time boundary and on foreground, without polling offscreen. */
export function useBoundaryClock(boundaryMs: number | null | undefined): number {
  const [now, setNow] = useState(() => Date.now());
  const watch = useCallback(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const refresh = () => {
      const current = Date.now();
      setNow(current);
      if (boundaryMs != null && boundaryMs >= current) {
        timer = setTimeout(refresh, Math.min(boundaryMs - current + 1, 0x7fffffff));
      }
    };
    refresh();
    return () => clearTimeout(timer);
  }, [boundaryMs]);
  useVisualActivityEffect(watch);
  return now;
}
