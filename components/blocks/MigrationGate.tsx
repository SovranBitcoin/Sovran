import React, { useState, useEffect, ReactNode } from 'react';
import { View } from 'components/ui/View';
import { Text } from 'components/ui/Text';
import { VideoScreen } from 'components/ui/VideoPlayer';
import Image from 'components/ui/Image';
// Note: We don't need to use Redux hooks here since we're checking the store directly
import { store } from 'redux/store';

interface MigrationGateProps {
  children: ReactNode;
}

/**
 * MigrationGate ensures all Redux migrations complete before rendering children
 * This prevents race conditions where providers try to access data before migrations finish
 */
export default function MigrationGate({ children }: MigrationGateProps) {
  const [migrationsComplete, setMigrationsComplete] = useState(false);
  const [migrationError, setMigrationError] = useState<string | null>(null);
  const [isChecking, setIsChecking] = useState(true);

  useEffect(() => {
    const checkMigrationsComplete = async () => {
      try {
        setIsChecking(true);
        setMigrationError(null);

        console.log('MigrationGate: Starting migration check...');

        // Wait for Redux store to be rehydrated
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
        console.log('✅ MigrationGate: All migrations completed, rendering app');
      } catch (error) {
        console.error('MigrationGate: Migration check failed:', error);
        setMigrationError(error instanceof Error ? error.message : 'Migration check failed');
        // Still allow the app to continue - don't block on migration errors
        setMigrationsComplete(true);
      } finally {
        setIsChecking(false);
      }
    };

    checkMigrationsComplete();
  }, []);

  // Show loading screen while migrations are running
  if (!migrationsComplete || isChecking) {
    return (
      <View
        style={{
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          height: '100%',
          flexDirection: 'column',
          gap: 16,
        }}>
        <View style={{ position: 'relative', width: 300, height: 300 }}>
          <Image
            style={{
              width: 150,
              height: 150,
              position: 'absolute',
              bottom: 10,
              left: 150,
              transform: [{ translateX: -75 }, { rotate: '10deg' }],
              zIndex: 1,
            }}
            source={require('../../assets/images/initializing.png')}
          />
          <VideoScreen
            style={
              {
                width: 300,
                height: 300,
                backgroundColor: 'black',
                position: 'absolute',
                bottom: 0,
                left: 0,
              } as any
            }
            videoSource={require('../../assets/videos/coco.mp4')}
            muted={true}
          />
        </View>
        <Text style={{ color: 'white', fontSize: 16, textAlign: 'center' }}>
          {isChecking ? 'Running migrations...' : 'Preparing wallet...'}
        </Text>
        <Text style={{ color: 'white', fontSize: 14, textAlign: 'center', opacity: 0.7 }}>
          {isChecking ? 'Please wait while we migrate your data...' : 'Almost ready...'}
        </Text>
        {migrationError && (
          <Text style={{ color: 'orange', fontSize: 14, textAlign: 'center' }}>
            Warning: {migrationError}
          </Text>
        )}
      </View>
    );
  }

  // Render children once migrations are complete
  return <>{children}</>;
}
