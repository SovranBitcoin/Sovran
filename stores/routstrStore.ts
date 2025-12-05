import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { RoutstrModel } from 'helper/routstr/api';

interface RoutstrMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
}

export interface RoutstrSession {
  id: string;
  title: string;
  createdAt: number;
  messages: RoutstrMessage[];
}

// Cache TTL: 5 minutes
const MODELS_CACHE_TTL = 5 * 60 * 1000; // 300000ms

interface ModelsCache {
  data: RoutstrModel[];
  timestamp: number;
}

interface RoutstrState {
  // API key (Cashu token or persistent wallet key)
  apiKey: string | null;
  // Balance in msats
  balance: number | null;
  // Conversation history (current session's messages)
  conversationHistory: RoutstrMessage[];
  // Selected model ID
  selectedModel: string | null;
  // Models cache
  modelsCache: ModelsCache | null;
  // Sessions
  sessions: RoutstrSession[];
  // Current session ID
  currentSessionId: string | null;
  // Anonymous mode (not persisted - temporary conversations)
  isAnonymousMode: boolean;
}

interface RoutstrActions {
  // API key management
  setApiKey: (apiKey: string) => void;
  getApiKey: () => string | null;
  clearApiKey: () => void;

  // Balance management
  setBalance: (balance: number) => void;
  getBalance: () => number | null;
  clearBalance: () => void;

  // Conversation management
  addMessage: (message: RoutstrMessage) => void;
  getConversationHistory: () => RoutstrMessage[];
  clearConversation: () => void;
  updateMessage: (id: string, content: string) => void;

  // Model management
  setSelectedModel: (modelId: string) => void;
  getSelectedModel: () => string;
  clearSelectedModel: () => void;

  // Models cache management
  getCachedModels: () => RoutstrModel[] | null;
  setCachedModels: (models: RoutstrModel[]) => void;
  isCacheStale: () => boolean;
  clearModelsCache: () => void;

  // Session management
  createSession: () => string;
  switchSession: (sessionId: string) => void;
  getAllSessions: () => RoutstrSession[];
  getCurrentSessionId: () => string | null;
  updateCurrentSessionTitle: () => void;
  deleteSession: (sessionId: string) => void;

  // Anonymous mode management
  setAnonymousMode: (isAnonymous: boolean) => void;
  getAnonymousMode: () => boolean;

  // Utility methods
  clearAllData: () => Promise<void>;
}

type RoutstrStore = RoutstrState & RoutstrActions;

export const useRoutstrStore = create<RoutstrStore>()(
  persist(
    (set, get) => ({
      // Initial state
      apiKey: null,
      balance: null,
      conversationHistory: [],
      selectedModel: null,
      modelsCache: null,
      sessions: [],
      currentSessionId: null,
      isAnonymousMode: false,

      // API key management
      setApiKey: (apiKey: string) => {
        console.log('RoutstrStore: setApiKey called');
        set({ apiKey });
      },

      getApiKey: () => {
        const apiKey = get().apiKey;
        console.log('RoutstrStore: getApiKey called, returning:', apiKey ? '***' : null);
        return apiKey;
      },

      clearApiKey: () => {
        set({ apiKey: null });
      },

      // Balance management
      setBalance: (balance: number) => {
        console.log('RoutstrStore: setBalance called with:', balance);
        set({ balance });
      },

      getBalance: () => {
        const balance = get().balance;
        console.log('RoutstrStore: getBalance called, returning:', balance);
        return balance;
      },

      clearBalance: () => {
        set({ balance: null });
      },

      // Conversation management
      addMessage: (message: RoutstrMessage) => {
        console.log('RoutstrStore: addMessage called with:', {
          id: message.id,
          role: message.role,
        });
        set((state) => {
          const newHistory = [...state.conversationHistory, message];
          // Skip saving to sessions if in anonymous mode
          if (state.isAnonymousMode) {
            return { conversationHistory: newHistory };
          }
          // Update current session's messages if it exists
          if (state.currentSessionId) {
            const updatedSessions = state.sessions.map((session) =>
              session.id === state.currentSessionId ? { ...session, messages: newHistory } : session
            );
            return {
              conversationHistory: newHistory,
              sessions: updatedSessions,
            };
          }
          return { conversationHistory: newHistory };
        });
      },

      getConversationHistory: () => {
        const history = get().conversationHistory;
        console.log(
          'RoutstrStore: getConversationHistory called, returning',
          history.length,
          'messages'
        );
        return history;
      },

      clearConversation: () => {
        console.log('RoutstrStore: clearConversation called');
        // Only clear conversationHistory, don't delete session
        set({ conversationHistory: [] });
      },

      updateMessage: (id: string, content: string) => {
        console.log('RoutstrStore: updateMessage called for id:', id);
        set((state) => {
          const updatedHistory = state.conversationHistory.map((msg) =>
            msg.id === id
              ? {
                  ...msg,
                  content,
                }
              : msg
          );
          // Skip saving to sessions if in anonymous mode
          if (state.isAnonymousMode) {
            return { conversationHistory: updatedHistory };
          }
          // Update current session's messages if it exists
          if (state.currentSessionId) {
            const updatedSessions = state.sessions.map((session) =>
              session.id === state.currentSessionId
                ? { ...session, messages: updatedHistory }
                : session
            );
            return {
              conversationHistory: updatedHistory,
              sessions: updatedSessions,
            };
          }
          return { conversationHistory: updatedHistory };
        });
      },

      // Model management
      setSelectedModel: (modelId: string) => {
        console.log('RoutstrStore: setSelectedModel called with:', modelId);
        set({ selectedModel: modelId });
      },

      getSelectedModel: () => {
        const selectedModel = get().selectedModel;
        // Default to gpt-3.5-turbo if not set
        return selectedModel || 'gpt-3.5-turbo';
      },

      clearSelectedModel: () => {
        set({ selectedModel: null });
      },

      // Models cache management
      getCachedModels: () => {
        const cache = get().modelsCache;
        if (!cache) return null;
        // Check if cache is stale
        const isStale = Date.now() - cache.timestamp > MODELS_CACHE_TTL;
        if (isStale) {
          console.log('RoutstrStore: Cache is stale, returning null');
          return null;
        }
        console.log('RoutstrStore: Returning cached models');
        return cache.data;
      },

      setCachedModels: (models: RoutstrModel[]) => {
        console.log('RoutstrStore: Caching models, count:', models.length);
        set({
          modelsCache: {
            data: models,
            timestamp: Date.now(),
          },
        });
      },

      isCacheStale: () => {
        const cache = get().modelsCache;
        if (!cache) return true;
        const isStale = Date.now() - cache.timestamp > MODELS_CACHE_TTL;
        console.log('RoutstrStore: Cache stale check:', isStale);
        return isStale;
      },

      clearModelsCache: () => {
        console.log('RoutstrStore: Clearing models cache');
        set({ modelsCache: null });
      },

      // Session management
      createSession: () => {
        const sessionId = `session-${Date.now()}`;
        const newSession: RoutstrSession = {
          id: sessionId,
          title: 'New Session',
          createdAt: Date.now(),
          messages: [],
        };
        console.log('RoutstrStore: createSession called, new session ID:', sessionId);
        set((state) => ({
          sessions: [newSession, ...state.sessions],
          currentSessionId: sessionId,
          conversationHistory: [],
        }));
        return sessionId;
      },

      switchSession: (sessionId: string) => {
        console.log('RoutstrStore: switchSession called with:', sessionId);
        const state = get();
        const session = state.sessions.find((s) => s.id === sessionId);
        if (session) {
          set({
            currentSessionId: sessionId,
            conversationHistory: session.messages,
          });
        } else {
          console.warn('RoutstrStore: Session not found:', sessionId);
        }
      },

      getAllSessions: () => {
        const sessions = get().sessions;
        // Sort by createdAt, newest first
        return [...sessions].sort((a, b) => b.createdAt - a.createdAt);
      },

      getCurrentSessionId: () => {
        return get().currentSessionId;
      },

      updateCurrentSessionTitle: () => {
        const state = get();
        if (!state.currentSessionId) return;

        // Find first user message to use as title
        const firstUserMessage = state.conversationHistory.find((msg) => msg.role === 'user');
        if (firstUserMessage) {
          const title =
            firstUserMessage.content.length > 50
              ? firstUserMessage.content.substring(0, 50) + '...'
              : firstUserMessage.content;

          const updatedSessions = state.sessions.map((session) =>
            session.id === state.currentSessionId ? { ...session, title } : session
          );
          set({ sessions: updatedSessions });
        }
      },

      deleteSession: (sessionId: string) => {
        console.log('RoutstrStore: deleteSession called for:', sessionId);
        const state = get();
        const updatedSessions = state.sessions.filter((s) => s.id !== sessionId);
        let newCurrentSessionId = state.currentSessionId;
        let newConversationHistory = state.conversationHistory;

        // If deleting current session, switch to another or create new one
        if (state.currentSessionId === sessionId) {
          if (updatedSessions.length > 0) {
            // Switch to first session (newest)
            const firstSession = updatedSessions[0];
            newCurrentSessionId = firstSession.id;
            newConversationHistory = firstSession.messages;
          } else {
            // No sessions left, clear current
            newCurrentSessionId = null;
            newConversationHistory = [];
          }
        }

        set({
          sessions: updatedSessions,
          currentSessionId: newCurrentSessionId,
          conversationHistory: newConversationHistory,
        });
      },

      // Anonymous mode management
      setAnonymousMode: (isAnonymous: boolean) => {
        console.log('RoutstrStore: setAnonymousMode called with:', isAnonymous);
        set({ isAnonymousMode: isAnonymous });
        // Clear conversation history when switching modes
        if (isAnonymous) {
          set({ conversationHistory: [] });
        }
      },

      getAnonymousMode: () => {
        return get().isAnonymousMode;
      },

      // Utility methods
      clearAllData: async () => {
        try {
          console.log('RoutstrStore: clearAllData called');
          // Clear from AsyncStorage
          await AsyncStorage.removeItem('routstr-store');
          // Reset state to initial values
          set({
            apiKey: null,
            balance: null,
            conversationHistory: [],
            selectedModel: null,
            modelsCache: null,
            sessions: [],
            currentSessionId: null,
            isAnonymousMode: false,
          });
          console.log('RoutstrStore: All data cleared successfully');
        } catch (error) {
          console.error('RoutstrStore: Error clearing data:', error);
          throw error;
        }
      },
    }),
    {
      name: 'routstr-store',
      storage: createJSONStorage(() => AsyncStorage),
      // Persist all state (don't persist cache, it will be refreshed)
      partialize: (state) => ({
        apiKey: state.apiKey,
        balance: state.balance,
        conversationHistory: state.conversationHistory,
        selectedModel: state.selectedModel,
        sessions: state.sessions,
        currentSessionId: state.currentSessionId,
        // Note: modelsCache is intentionally not persisted - it's ephemeral cache
      }),
      onRehydrateStorage: () => (state, error) => {
        console.log('RoutstrStore: onRehydrateStorage called with state:', state, 'error:', error);
        if (error) {
          console.warn('RoutstrStore: Failed to rehydrate from storage:', error);
        } else {
          console.log('RoutstrStore: Successfully rehydrated from storage');
        }
      },
    }
  )
);
