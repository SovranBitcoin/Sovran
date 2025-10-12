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
        }

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
              style={{
                width: 300,
                height: 300,
                backgroundColor: 'black',
                position: 'absolute',
                bottom: 0,
                left: 0,
              }}
              videoSource={require('../../assets/videos/coco.mp4')}
              muted={true}
            />
          </View>
          {isMigrating && <div>Migrating data...</div>}
          {migrationError && <div style={{ color: 'red' }}>Error: {migrationError.message}</div>}
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
