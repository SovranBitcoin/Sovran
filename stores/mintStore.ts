import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';

interface MintState {
  // Map of pubkey to selectedMint
  selectedMints: Record<string, string | undefined>;
}

interface MintActions {
  setSelectedMint: (pubkey: string, mintUrl: string) => void;
  getSelectedMint: (pubkey: string) => string | undefined;
  clearSelectedMint: (pubkey: string) => void;
  getAllSelectedMints: () => Record<string, string | undefined>;
  debugStorage: () => Promise<any>;
  clearAllData: () => Promise<void>;
}

type MintStore = MintState & MintActions;

export const useMintStore = create<MintStore>()(
  persist(
    (set, get) => ({
      // Initial state
      selectedMints: {},

      // Actions
      setSelectedMint: (pubkey: string, mintUrl: string) => {
        console.log('MintStore: setSelectedMint called with:', { pubkey, mintUrl });
        set((state) => {
          const newState = {
            selectedMints: {
              ...state.selectedMints,
              [pubkey]: mintUrl,
            },
          };
          console.log('MintStore: Updated selectedMints:', newState.selectedMints);
          return newState;
        });
      },

      getSelectedMint: (pubkey: string) => {
        const currentState = get();
        const result = currentState.selectedMints[pubkey];
        console.log('MintStore: getSelectedMint called with pubkey:', pubkey, 'result:', result);
        console.log('MintStore: Current selectedMints state:', currentState.selectedMints);
        console.log(
          'MintStore: All keys in selectedMints:',
          Object.keys(currentState.selectedMints)
        );
        return result;
      },

      clearSelectedMint: (pubkey: string) => {
        set((state) => {
          const newSelectedMints = { ...state.selectedMints };
          delete newSelectedMints[pubkey];
          return { selectedMints: newSelectedMints };
        });
      },

      getAllSelectedMints: () => {
        const currentState = get();
        console.log(
          'MintStore: getAllSelectedMints called, returning:',
          currentState.selectedMints
        );
        return currentState.selectedMints;
      },

      // Debug method to check what's actually stored in AsyncStorage
      debugStorage: async () => {
        try {
          const stored = await AsyncStorage.getItem('mint-store');
          console.log('MintStore: Raw storage data:', stored);
          const parsed = stored ? JSON.parse(stored) : null;
          console.log('MintStore: Parsed storage data:', parsed);
          return parsed;
        } catch (error) {
          console.error('MintStore: Error reading from storage:', error);
          return null;
        }
      },

      // Clear all data from both state and storage
      clearAllData: async () => {
        try {
          console.log('MintStore: clearAllData called');
          // Clear from AsyncStorage
          await AsyncStorage.removeItem('mint-store');
          // Reset state to initial values
          set({
            selectedMints: {},
          });
          console.log('MintStore: All data cleared successfully');
        } catch (error) {
          console.error('MintStore: Error clearing data:', error);
          throw error;
        }
      },
    }),
    {
      name: 'mint-store',
      storage: createJSONStorage(() => AsyncStorage),
      // Only persist the selectedMints
      partialize: (state) => ({ selectedMints: state.selectedMints }),
      // Add error handling for storage issues
      onRehydrateStorage: () => (state, error) => {
        console.log('MintStore: onRehydrateStorage called with state:', state, 'error:', error);
        if (error) {
          console.warn('MintStore: Failed to rehydrate from storage:', error);
        } else {
          console.log('MintStore: Successfully rehydrated from storage:', state?.selectedMints);
        }
      },
    }
  )
);
