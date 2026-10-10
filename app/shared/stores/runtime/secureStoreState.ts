import { defineStore as create } from '@/shared/lib/persist/defineStore';

/** Keep failures sticky until recovery or a successful read restarts initialization. */
export const useSecureStoreState = create<{
  secureStoreState: 'available' | 'locked';
  errorName: string | null;
}>({ name: 'useSecureStoreState', scope: 'session' })(() => ({
  secureStoreState: 'available',
  errorName: null,
}));
