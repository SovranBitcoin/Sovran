import React, { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { CocoCashuProvider } from 'coco-cashu-react';
import { Manager } from 'coco-cashu-core';
import { CocoManager } from './manager';
import { DataMigration } from './migration';
import { View } from 'components/ui/View';

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

        // Initialize the manager
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

        setIsReady(true);
        console.log('Coco Provider initialized successfully');
      } catch (error) {
        console.error('Failed to initialize Coco Provider:', error);
        setMigrationError(error instanceof Error ? error : new Error('Initialization failed'));
      }
    };

    initializeCoco();
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
            height: '100vh',
            flexDirection: 'column',
            gap: '1rem',
          }}>
          <View>Initializing Coco...</View>
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
