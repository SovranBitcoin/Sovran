import React, { ReactNode, useEffect, useRef, useState } from 'react';

import { initLog, log, Log, useInitMount, useLifecycleLogger } from '@/shared/lib/logger';
import { useInitializationStage } from '@/shared/providers/InitializationProvider';

interface InitializationGateProps {
  /** Component name — used for mount/lifecycle logs and the children Log wrapper. */
  tag: string;
  /** Stage id registered with the InitializationProvider; must be unique. */
  stageId: string;
  /** Splash message shown while the stage is loading. */
  message: string;
  /** Stage IDs this stage waits on. Used as a splash hint, not as a render gate. */
  dependsOn?: string[];
  /** Logger event prefix, e.g. `gate.global_migration` — emits `.start`/`.complete`/`.failed`. */
  logEvent: string;
  /** Async work that resolves the gate. Called exactly once on mount. */
  run: () => Promise<void>;
  /**
   * Fired exactly once after `run` resolves successfully and before children mount.
   * Use for side effects (e.g. signal a downstream storage gate) that must NOT
   * fire when `run` rejects — see audit-46 F-001 for the catch-branch pitfall.
   */
  onSuccess?: () => void;
  children: ReactNode;
}

/**
 * Generic blocking gate for app-startup work. Replaces the three near-identical
 * gate components flagged in audit-46 F-005
 * (GlobalMigrationGate). The single primitive owns the
 * hasStarted ref, the stage wiring, the success/error fork, and the children
 * Log wrapper — callers supply only the async `run` and the per-gate metadata.
 *
 * Failure semantics: when `run` rejects, the gate renders `errorFallback`
 * (or `null`) and `onSuccess` is NOT called. Audit-46 F-001 documents why
 * downstream signal calls (e.g. `signalMigrationsComplete()`) must not fire
 * from a catch branch — they would open profile-scoped storage on top of an
 * incomplete migration and cause silent shape corruption.
 */
export function InitializationGate({
  tag,
  stageId,
  message,
  dependsOn,
  logEvent,
  run,
  onSuccess,
  children,
}: InitializationGateProps) {
  useInitMount(tag);
  useLifecycleLogger(tag);
  const stage = useInitializationStage(stageId, {
    message,
    blocking: true,
    dependsOn,
  });
  const [status, setStatus] = useState<'pending' | 'complete' | 'failed'>('pending');
  const hasStarted = useRef(false);

  useEffect(() => {
    if (hasStarted.current) return;
    hasStarted.current = true;

    void (async () => {
      try {
        stage.log(message);
        initLog(tag, 'starting');
        log.info(`${logEvent}.start`);
        await run();
        onSuccess?.();
        stage.complete();
        setStatus('complete');
        log.info(`${logEvent}.complete`);
        initLog(tag, 'complete');
      } catch (error) {
        const msg = error instanceof Error ? error.message : `${tag} failed`;
        log.error(`${logEvent}.failed`, {
          error: error instanceof Error ? error : new Error(String(error)),
        });
        stage.error(msg);
        setStatus('failed');
        initLog(tag, `ERROR: ${error}`);
      }
    })();
    // run/onSuccess captured at mount on purpose — gates run exactly once per AccountScopedProviders lifecycle.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (status === 'failed') return null;
  if (status !== 'complete') return null;

  return <Log name={tag}>{children}</Log>;
}
