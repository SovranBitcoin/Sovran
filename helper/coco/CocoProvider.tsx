import React, { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { CocoCashuProvider } from 'coco-cashu-react';
import { Manager } from 'coco-cashu-core';
import { CocoManager } from './manager';
import { DataMigration } from './migration';
import { View } from 'components/ui/View';
import { VideoScreen } from 'components/ui/VideoPlayer';
import Image from 'components/ui/Image';
interface CocoContextValue {
  manager: Manager | null;
  isReady: boolean;
  isMigrating: boolean;
  migrationError: Error | null;
}

const CocoContext = createContext<CocoContextValue>({
  manager: null,
  isReady: false,
  isMigrating: false,
  migrationError: null,
});

export const useCocoContext = () => {
  const context = useContext(CocoContext);
  if (!context) {
    throw new Error('useCocoContext must be used within a CocoProvider');
  }
  return context;
};

interface CocoProviderProps {
  children: ReactNode;
}

/**
 * Initialize default mints for new users
 * This adds the Sovran mint and Minibits mint so users have mints available immediately
 */
async function initializeDefaultMints(manager: Manager): Promise<void> {
  try {
    console.log('Initializing default mints...');

    const defaultMints = ['https://mint.sovran.money', 'https://mint.minibits.cash/Bitcoin'];

    // Add each default mint (only if not already exists)
    for (const mintUrl of defaultMints) {
      try {
        // Check if mint already exists
        const isKnown = await manager.mint.isKnownMint(mintUrl);
        if (isKnown) {
          console.log(`ℹ️ Default mint already exists: ${mintUrl}`);
          continue;
        }

        await manager.mint.addMint(mintUrl);
        console.log(`✅ Added default mint: ${mintUrl}`);
      } catch (error) {
        console.warn(`⚠️ Failed to add default mint ${mintUrl}:`, error);
        // Continue with other mints even if one fails
      }
    }

    console.log('Default mints initialization completed');
  } catch (error) {
    console.error('Failed to initialize default mints:', error);
    // Don't throw - this shouldn't prevent the app from starting
  }
}

/**
 * CocoProvider handles the initialization of the Coco Manager and data migration
 * This should wrap your entire app and be placed above other providers
 */
export function CocoProvider({ children }: CocoProviderProps) {
  const [manager, setManager] = useState<Manager | null>(null);
  const [isReady, setIsReady] = useState(false);
  const [isMigrating, setIsMigrating] = useState(false);
  const [migrationError, setMigrationError] = useState<Error | null>(null);

  useEffect(() => {
    const initializeCoco = async () => {
      try {
        console.log('Initializing Coco Provider...');

        // Initialize the manager (includes enabling proof state watcher)
        const mgr = await CocoManager.initialize();
        setManager(mgr);

        // Check if migration is needed
        const migration = new DataMigration(mgr);
        const needsMigration = await migration.isMigrationNeeded();

        if (needsMigration) {
          console.log('Migration needed, starting data migration...');
          setIsMigrating(true);

          try {
            const result = await migration.migrateFromRedux();

            if (result.errors.length > 0) {
              console.warn('Migration completed with errors:', result.errors);
            } else {
              console.log('Migration completed successfully:', result);
            }
          } catch (error) {
            console.error('Migration failed:', error);
            setMigrationError(error instanceof Error ? error : new Error('Migration failed'));
          } finally {
            setIsMigrating(false);
          }
        } else {
          console.log('No migration needed');
        }

        // Initialize default mints for new users
        await initializeDefaultMints(mgr);

        setIsReady(true);
      } catch (error) {
        console.error('Failed to initialize Coco Provider:', error);
        setMigrationError(error instanceof Error ? error : new Error('Initialization failed'));
      }
    };

    initializeCoco();

    // Cleanup function
    return () => {
      console.log('CocoProvider unmounting, cleaning up...');
      // Cleanup the manager to prevent transaction conflicts
      CocoManager.cleanup().catch((error) => {
        console.error('Failed to cleanup Coco Manager on unmount:', error);
      });
    };
  }, []);

  const contextValue: CocoContextValue = {
    manager,
    isReady,
    isMigrating,
    migrationError,
  };

  // Show loading state while initializing
  if (!isReady || !manager) {
    return (
      <CocoContext.Provider value={contextValue}>
        {/* You can replace this with your own loading component */}
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
          {isMigrating && <View>Migrating data...</View>}
          {migrationError && <View style={{ color: 'red' }}>Error: {migrationError.message}</View>}
        </View>
      </CocoContext.Provider>
    );
  }

  // Wrap with CocoCashuProvider once manager is ready
  return (
    <CocoContext.Provider value={contextValue}>
      <CocoCashuProvider manager={manager}>{children}</CocoCashuProvider>
    </CocoContext.Provider>
  );
}
