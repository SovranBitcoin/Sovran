import { create } from 'zustand';

/** A read failure is sticky for this session; only explicit recovery may replace keys. */
export const useSecureStoreState = create<{
  secureStoreState: 'available' | 'locked';
  errorName: string | null;
}>()(() => ({ secureStoreState: 'available', errorName: null }));
