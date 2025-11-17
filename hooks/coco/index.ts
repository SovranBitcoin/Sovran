/**
 * Coco Cashu Hooks
 *
 * This module provides custom React hooks that wrap the coco-cashu functionality
 * in a way that's idiomatic for React Native applications.
 *
 * These hooks replace the complex functions in cashuClient.ts and provide
 * a cleaner, more maintainable API.
 */

export { useLightningOperations } from './useLightningOperations';
export { useMintManagement } from './useMintManagement';
export { useAuditedMint } from './useAuditedMint';
export { useNostrDiscoveredMints } from './useNostrDiscoveredMints';
export { useMelt } from './useMelt';

// Re-export coco-cashu-react hooks for direct use when needed
export {
  useSend,
  useReceive,
  useManager,
  useManagerContext,
  useBalanceContext,
  useMints,
  usePaginatedHistory,
} from 'coco-cashu-react';
