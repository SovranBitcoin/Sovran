import React, { type ReactNode } from 'react';

import { useConnectSheetOpener } from '@/features/nostrSigner/hooks/useConnectSheetOpener';
import { useNostrSignerService } from '@/features/nostrSigner/hooks/useNostrSignerService';
import { useResumePendingPairing } from '@/features/nostrSigner/hooks/useResumePendingPairing';
import { useSignerApprovalController } from '@/features/nostrSigner/hooks/useSignerApprovalController';
import { useInitMount } from '@/shared/lib/logger';

interface NostrSignerProviderProps {
  children: ReactNode;
}

/**
 * Thin mount point for the NIP-46 signer service. Renders children only — no
 * context, no UI. Mounted directly after NostrNDKProvider (account-scoped, so
 * a profile switch remounts it and the unmount path stops the engine).
 *
 * Cold path: with zero connections, no pending pairing intent, and no
 * UI-requested hot flag, the hooks gate every side effect — the engine never
 * starts and no sockets open.
 */
export function NostrSignerProvider({ children }: NostrSignerProviderProps) {
  useInitMount('NostrSignerProvider');
  useNostrSignerService();
  useResumePendingPairing();
  useSignerApprovalController();
  useConnectSheetOpener();
  return <>{children}</>;
}
