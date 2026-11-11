import { ReactNode, useEffect, useRef, useState } from 'react';

import { signalMigrationsComplete } from '@/shared/lib/cashu/profileScopedStorage';
import { migrateThenLoad } from '@/shared/lib/migrations/migrateThenLoad';
import { initLog, log, Log, useInitMount, useLifecycleLogger } from '@/shared/lib/logger';
import { useInitializationStage } from '@/shared/providers/InitializationProvider';
import { StartupFailedScreen } from '@/shared/blocks/StartupFailedScreen';

initLog('Module', 'GlobalMigrationGate loaded');

const TAG = 'GlobalMigrationGate';
const MESSAGE = 'Running global migrations...';

type Status = 'pending' | 'complete' | 'failed';
type Stage = ReturnType<typeof useInitializationStage>;

/**
 * Runs one attempt and reports the outcome to the stage.
 *
 * At module scope rather than inline in the effect: React Compiler cannot lower
 * a try/catch containing ternaries, and an inline body would cost the gate — and
 * therefore everything it wraps — its auto-memoization.
 */
async function runGlobalMigrations(
  stage: Stage,
  setStatus: (status: Status) => void
): Promise<void> {
  try {
    stage.log(MESSAGE);
    initLog(TAG, 'starting');
    log.info('gate.global_migration.start');
    await migrateThenLoad();
    signalMigrationsComplete();
    stage.complete();
    setStatus('complete');
    log.info('gate.global_migration.complete');
    initLog(TAG, 'complete');
  } catch (error) {
    const msg = error instanceof Error ? error.message : `${TAG} failed`;
    log.error('gate.global_migration.failed', {
      error: error instanceof Error ? error : new Error(String(error)),
    });
    stage.error(msg);
    setStatus('failed');
    initLog(TAG, `ERROR: ${error}`);
  }
}

interface GlobalMigrationGateProps {
  children: ReactNode;
}

/**
 * Runs all global migrations (profile-scoped key rename, etc.) once at
 * app start, before any AccountScopedProviders mount. Blocks rendering of
 * children until the runner completes.
 *
 * `signalMigrationsComplete()` opens the profile-scoped storage gate that
 * Zustand persist waits on. It MUST fire only on success — opening the gate
 * after a partial migration causes stores to load empty defaults and then
 * overwrite the migrated data on first write (audit-46 F-001).
 *
 * A failed run therefore stops here, on a screen with a retry. Nothing below
 * mounts and no store reads or writes until a run succeeds.
 *
 * The same goes for the three stores everything below reads before it can
 * decide anything: the account list, the settings and the wallet lifecycle.
 * If one cannot be read, starting on its defaults would show a wallet with no
 * accounts or ask a long-standing user to restore.
 */
export default function GlobalMigrationGate({ children }: GlobalMigrationGateProps) {
  useInitMount(TAG);
  useLifecycleLogger(TAG);
  const stage = useInitializationStage('global-migrations');
  const [status, setStatus] = useState<Status>('pending');
  // Bumped by a retry; the effect runs once per attempt.
  const [attempt, setAttempt] = useState(0);
  const startedAttempt = useRef(-1);

  useEffect(() => {
    if (startedAttempt.current === attempt) return;
    startedAttempt.current = attempt;
    void runGlobalMigrations(stage, setStatus);
  }, [stage, attempt]);

  if (status === 'failed') {
    return (
      <StartupFailedScreen
        step="storage"
        onRetry={() => {
          setStatus('pending');
          setAttempt((current) => current + 1);
        }}
      />
    );
  }
  if (status !== 'complete') return null;

  return <Log name={TAG}>{children}</Log>;
}
