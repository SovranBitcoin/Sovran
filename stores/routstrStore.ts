import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { createProfileScopedStorage } from '@/helper/profileScopedStorage';
import { RoutstrModel } from '@/helper/routstr/api';

const profileStorage = createProfileScopedStorage();

const DEFAULT_MODEL = 'gpt-3.5-turbo';

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
  /** Cashu token or persistent wallet key */
  apiKey: string | null;
  /** Balance in msats */
  balance: number | null;
  /**
   * Working copy of the active session's messages.
   * Synced bidirectionally with sessions[currentSessionId].messages.
   * In anonymous mode, this is the only copy (no session).
   */
  conversationHistory: RoutstrMessage[];
  selectedModel: string | null;
  modelsCache: ModelsCache | null;
  sessions: RoutstrSession[];
  currentSessionId: string | null;
  isAnonymousMode: boolean;
}

interface RoutstrActions {
  setApiKey: (apiKey: string) => void;
  getApiKey: () => string | null;
  clearApiKey: () => void;

  setBalance: (balance: number) => void;
  getBalance: () => number | null;
  clearBalance: () => void;

  addMessage: (message: RoutstrMessage) => void;
  getConversationHistory: () => RoutstrMessage[];
  clearConversation: () => void;
  updateMessage: (id: string, content: string) => void;

  setSelectedModel: (modelId: string) => void;
  getSelectedModel: () => string;
  clearSelectedModel: () => void;

  getCachedModels: () => RoutstrModel[] | null;
  setCachedModels: (models: RoutstrModel[]) => void;
  isCacheStale: () => boolean;
  clearModelsCache: () => void;

  createSession: () => string;
  switchSession: (sessionId: string) => void;
  getAllSessions: () => RoutstrSession[];
  getCurrentSessionId: () => string | null;
  updateCurrentSessionTitle: () => void;
  deleteSession: (sessionId: string) => void;

  setAnonymousMode: (isAnonymous: boolean) => void;
  getAnonymousMode: () => boolean;

  clearAllData: () => Promise<void>;
}

type RoutstrStore = RoutstrState & RoutstrActions;

export const useRoutstrStore = create<RoutstrStore>()(
  persist(
    (set, get) => ({
      apiKey: null,
      balance: null,
      conversationHistory: [],
      selectedModel: null,
      modelsCache: null,
      sessions: [],
      currentSessionId: null,
      isAnonymousMode: false,

      setApiKey: (apiKey: string) => {
        set({ apiKey });
      },

      getApiKey: () => get().apiKey,

      clearApiKey: () => {
        set({ apiKey: null });
      },

      setBalance: (balance: number) => {
        set({ balance });
      },

      getBalance: () => get().balance,

      clearBalance: () => {
        set({ balance: null });
      },

      addMessage: (message: RoutstrMessage) => {
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

      getConversationHistory: () => get().conversationHistory,

      clearConversation: () => {
        set({ conversationHistory: [] });
      },

      updateMessage: (id: string, content: string) => {
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

      setSelectedModel: (modelId: string) => {
        set({ selectedModel: modelId });
      },

      getSelectedModel: () => get().selectedModel || DEFAULT_MODEL,

      clearSelectedModel: () => {
        set({ selectedModel: null });
      },

      getCachedModels: () => {
        const cache = get().modelsCache;
        if (!cache) return null;
        if (Date.now() - cache.timestamp > MODELS_CACHE_TTL) return null;
        return cache.data;
      },

      setCachedModels: (models: RoutstrModel[]) => {
        set({ modelsCache: { data: models, timestamp: Date.now() } });
      },

      isCacheStale: () => {
        const cache = get().modelsCache;
        if (!cache) return true;
        return Date.now() - cache.timestamp > MODELS_CACHE_TTL;
      },

      clearModelsCache: () => {
        set({ modelsCache: null });
      },

      createSession: () => {
        const sessionId = `session-${Date.now()}`;
        const newSession: RoutstrSession = {
          id: sessionId,
          title: 'New Session',
          createdAt: Date.now(),
          messages: [],
        };
        set((state) => ({
          sessions: [newSession, ...state.sessions],
          currentSessionId: sessionId,
          conversationHistory: [],
        }));
        return sessionId;
      },

      switchSession: (sessionId: string) => {
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

      setAnonymousMode: (isAnonymous: boolean) => {
        set({ isAnonymousMode: isAnonymous });
        // Clear conversation history when switching modes
        if (isAnonymous) {
          set({ conversationHistory: [] });
        }
      },

      getAnonymousMode: () => get().isAnonymousMode,

      clearAllData: async () => {
        try {
          await profileStorage.removeItem('routstr-store');
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
        } catch (error) {
          console.error('RoutstrStore: Error clearing data:', error);
          throw error;
        }
      },
    }),
    {
      name: 'routstr-store',
      storage: createJSONStorage(() => createProfileScopedStorage()),
      partialize: (state) => ({
        apiKey: state.apiKey,
        balance: state.balance,
        conversationHistory: state.conversationHistory,
        selectedModel: state.selectedModel,
        sessions: state.sessions,
        currentSessionId: state.currentSessionId,
      }),
      onRehydrateStorage: () => (_state, error) => {
        if (error) {
          console.warn('RoutstrStore: Failed to rehydrate from storage:', error);
        }
      },
    }
  )
);
