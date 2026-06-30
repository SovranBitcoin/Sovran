// ═══════════════════════════════════════════════════════════════════════════════
// REACT HOOKS — Render & Performance Debugging
// ═══════════════════════════════════════════════════════════════════════════════

import { useEffect, useRef } from 'react';

import { log, monotonicNow, type Logger } from './loggerCore';

/**
 * Track render count for a component. Escalates to 'warn' after threshold.
 *
 * Usage:
 *   function MyComponent() {
 *     useRenderLogger('MyComponent');
 *     // ...
 *   }
 */
export function useRenderLogger(
  componentName: string,
  warnAfter: number = 20,
  logger: Logger = log
): void {
  const renderCount = useRef(0);
  const mountTime = useRef(monotonicNow());
  renderCount.current += 1;

  useEffect(() => {
    const count = renderCount.current;
    const aliveMs = Math.round((monotonicNow() - mountTime.current) * 100) / 100;
    const level = count > warnAfter ? 'warn' : 'debug';
    logger[level]('render.count', {
      component: componentName,
      renders: count,
      aliveMs,
      rendersPerSec: aliveMs > 0 ? Math.round((count / aliveMs) * 1000 * 100) / 100 : 0,
    });
  });

  useEffect(() => {
    logger.debug('component.mount', { component: componentName });
    return () => {
      logger.debug('component.unmount', {
        component: componentName,
        totalRenders: renderCount.current,
        aliveMs: Math.round((monotonicNow() - mountTime.current) * 100) / 100,
      });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}

/** Logs mount and unmount events for a component. */
export function useLifecycleLogger(componentName: string, logger: Logger = log): void {
  useEffect(() => {
    logger.info('lifecycle.mount', { component: componentName });
    return () => logger.info('lifecycle.unmount', { component: componentName });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
