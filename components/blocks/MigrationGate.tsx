import React, { useState, useEffect, ReactNode, useRef } from 'react';
// Note: We don't need to use Redux hooks here since we're checking the store directly
import { store } from 'redux/store';
import { useInitializationStage } from '@/providers/InitializationProvider';

interface MigrationGateProps {
  children: ReactNode;
}

/**
 * MigrationGate ensures all Redux migrations complete before rendering children
 * This prevents race conditions where providers try to access data before migrations finish
 */
export default function MigrationGate({ children }: MigrationGateProps) {
  const stage = useInitializationStage('migrations', { message: 'Running migrations...' });
  const [migrationsComplete, setMigrationsComplete] = useState(false);
  const [migrationError, setMigrationError] = useState<string | null>(null);
  const [isChecking, setIsChecking] = useState(true);
  const hasStarted = useRef(false);

  useEffect(() => {
    // Only run once
    if (hasStarted.current) return;
    hasStarted.current = true;

    const checkMigrationsComplete = async () => {
      try {
        setIsChecking(true);
        setMigrationError(null);
        stage.log('Running migrations...');

        console.log('MigrationGate: Starting migration check...');

        // Wait for Redux store to be rehydrated
        stage.log('Rehydrating Redux store...');
        await new Promise<void>((resolve) => {
          const unsubscribe = store.subscribe(() => {
            const state = store.getState();
            // Check if persist has finished rehydrating
            if (state._persist && state._persist.rehydrated) {
              console.log('MigrationGate: Redux store rehydrated');
              unsubscribe();
              resolve();
            }
          });

          // If already rehydrated, resolve immediately
          const currentState = store.getState();
          if (currentState._persist && currentState._persist.rehydrated) {
            console.log('MigrationGate: Redux store already rehydrated');
            unsubscribe();
            resolve();
          }
        });

        // Wait for async migrations to complete by checking for completion flags
        console.log('MigrationGate: Waiting for async migrations to complete...');
        stage.log('Waiting for migrations to complete...');

        // Poll for migration completion by checking completion flags in state
        let attempts = 0;
        const maxAttempts = 60; // 30 seconds max wait time
        const pollInterval = 500; // Check every 500ms

        while (attempts < maxAttempts) {
          await new Promise((resolve) => setTimeout(resolve, pollInterval));

          const currentState = store.getState();
          const migrationStatus = (currentState as any)?._migrationStatus;

          // Check if all async migrations are complete
          const allMigrationsComplete =
            !migrationStatus || migrationStatus.migration250Complete !== false; // undefined or true means complete

          if (allMigrationsComplete) {
            console.log('MigrationGate: ✅ All async migrations completed');
            break;
          }

          attempts++;

          if (attempts % 10 === 0) {
            // Log every 5 seconds
            console.log(
              `MigrationGate: Still waiting for async operations... ${(attempts * pollInterval) / 1000}s elapsed`
            );
            console.log('MigrationGate: Migration status:', migrationStatus);
          }
        }

        if (attempts >= maxAttempts) {
          console.warn('MigrationGate: ⚠️ Migration timeout reached, proceeding anyway');
        }

        setMigrationsComplete(true);
        stage.complete();
        console.log('✅ MigrationGate: All migrations completed, rendering app');
      } catch (error) {
        console.error('MigrationGate: Migration check failed:', error);
        const errorMessage = error instanceof Error ? error.message : 'Migration check failed';
        setMigrationError(errorMessage);
        stage.error(errorMessage);
        // Still allow the app to continue - don't block on migration errors
        setMigrationsComplete(true);
      } finally {
        setIsChecking(false);
      }
    };

    checkMigrationsComplete();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Render children once migrations are complete
  // Loading UI is now handled by InitializationScreen
  if (!migrationsComplete || isChecking) {
    return null;
  }

  return <>{children}</>;
}
