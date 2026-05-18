import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { z } from 'zod';

import { createProfileScopedStorage } from '@/shared/lib/cashu/profileScopedStorage';
import { storeLog } from '@/shared/lib/logger';
import { persistConfig } from '@/shared/lib/persist/persistConfig';

export type SendReachabilityStatus =
  | 'checking'
  | 'device-offline'
  | 'mint-unreachable'
  | 'mint-reachable';

interface SendReachabilityEntry {
  status: SendReachabilityStatus;
  mintUrl: string;
  updatedAt: number;
}

interface SendReachabilityState {
  byTransactionId: Record<string, SendReachabilityEntry>;
}

interface SendReachabilityActions {
  markChecking: (transactionId: string, mintUrl: string) => void;
  markDeviceOffline: (transactionId: string, mintUrl: string) => void;
  markMintReachable: (transactionId: string, mintUrl: string) => void;
  markMintUnreachable: (transactionId: string, mintUrl: string) => void;
  pruneOld: () => void;
}

type SendReachabilityStore = SendReachabilityState & SendReachabilityActions;

const ENTRY_TTL_MS = 30 * 24 * 60 * 60 * 1000;

const PersistedSendReachabilityStore = z.object({
  byTransactionId: z
    .record(
      z.string().max(256),
      z.looseObject({
        status: z.enum(['checking', 'device-offline', 'mint-unreachable', 'mint-reachable']),
        mintUrl: z.string().min(1).max(2048),
        updatedAt: z.number().int().nonnegative(),
      })
    )
    .default({}),
});

function setStatus(
  status: SendReachabilityStatus,
  transactionId: string,
  mintUrl: string,
  set: (partial: (state: SendReachabilityState) => SendReachabilityState) => void
): void {
  if (!transactionId || !mintUrl) return;
  storeLog.debug('store.send_reachability.set', { transactionId, status });
  set((state) => ({
    byTransactionId: {
      ...state.byTransactionId,
      [transactionId]: {
        status,
        mintUrl,
        updatedAt: Date.now(),
      },
    },
  }));
}

export const useSendReachabilityStore = create<SendReachabilityStore>()(
  persist(
    (set) => ({
      byTransactionId: {},

      markChecking: (transactionId, mintUrl) => setStatus('checking', transactionId, mintUrl, set),
      markDeviceOffline: (transactionId, mintUrl) =>
        setStatus('device-offline', transactionId, mintUrl, set),
      markMintReachable: (transactionId, mintUrl) =>
        setStatus('mint-reachable', transactionId, mintUrl, set),
      markMintUnreachable: (transactionId, mintUrl) =>
        setStatus('mint-unreachable', transactionId, mintUrl, set),

      pruneOld: () => {
        const cutoff = Date.now() - ENTRY_TTL_MS;
        set((state) => ({
          byTransactionId: Object.fromEntries(
            Object.entries(state.byTransactionId).filter(([, entry]) => entry.updatedAt >= cutoff)
          ),
        }));
      },
    }),
    persistConfig({
      name: 'send-reachability-store',
      storage: createProfileScopedStorage(),
      schema: PersistedSendReachabilityStore,
      logKey: 'send_reachability',
      partialize: (state) => ({
        byTransactionId: state.byTransactionId,
      }),
    })
  )
);

export function useSendReachability(
  transactionId: string | undefined
): SendReachabilityEntry | null {
  return useSendReachabilityStore((state) =>
    transactionId ? (state.byTransactionId[transactionId] ?? null) : null
  );
}
