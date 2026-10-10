/**
 * The part of the app that belongs to one account.
 *
 * `AccountScopedProviders` is mounted with `key={account-<index>}`, so changing
 * the active account unmounts every provider here and mounts a fresh set:
 * keys, relay pool, signer, Whitenoise, the wallet core and everything under
 * them. What lives outside React is not replaced by that remount; it is listed
 * in `shared/lib/account/accountRegistry.ts`.
 *
 * `AccountSwitchBoundary` wraps that tree so an in-process profile switch can
 * hold it unmounted while stores are reset. The three small components after
 * it register the layout's hooks with the account flows.
 */
import { resetProfileNavigation } from '@/shared/lib/profile/resetProfileNavigation';
import { reportAsyncStorageUsage } from '@/shared/lib/persist/storageUsage';
import { registerProfileSwitchBoundary } from '@/shared/lib/account/accountRegistry';
import { useNavigationContainerRef } from 'expo-router';
import { DmEcashAutoRedeemProvider } from '@/features/payments/hooks/useDmEcashAutoRedeem';
import { cashuLog, initLog, useInitMount } from '@/shared/lib/logger';
import AppGate from '@/shared/blocks/AppGate';
import { useInitializationReset } from '@/shared/providers/InitializationProvider';
import { compose } from '@/shared/lib/utils';
import { NostrKeysProvider } from '@/shared/providers/NostrKeysProvider';
import { NostrNDKProvider } from '@/shared/providers/NostrNDKProvider';
import { NostrSignerProvider } from '@/shared/providers/NostrSignerProvider';
import { PricelistProvider } from '@/shared/providers/PricelistProvider';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { hasFeature } from '@/shared/config/features';
import { CocoProvider } from '@/shared/providers/CocoProvider';
import { BitchatBLEProvider } from '@/shared/providers/BitchatBLEProvider';
import { WhitenoiseProvider } from '@/features/whitenoise/WhitenoiseProvider';
import { WalletContextProvider } from '@/shared/providers/WalletContextProvider';
import { SovranColadaProvider } from '@/features/send/providers/Colada';
import { useRegisterKeyDerivation } from '@/shared/hooks/useRegisterKeyDerivation';
import {
  clearTransitionGuardOnStartup,
  registerTransitionControls,
} from '@/shared/lib/profile/profileTransition';

// Inner providers — remounted on profile switch via React key change
export function AccountScopedProviders({
  accountIndex,
  children,
}: {
  accountIndex: number;
  children: React.ReactNode;
}) {
  useInitMount('AccountScopedProviders');
  initLog('AccountScoped', `render — accountIndex=${accountIndex}`);
  useEffect(() => {
    cashuLog.info('app.account_scoped_providers.mount', { accountIndex });
    return () => {
      cashuLog.info('app.account_scoped_providers.unmount', { accountIndex });
    };
  }, [accountIndex]);
  const InnerProviders = useMemo(
    () =>
      compose([
        [NostrKeysProvider, { defaultAccountIndex: accountIndex }],
        [NostrNDKProvider, { accountIndex }],
        // NIP-46 signer service — stays cold (no sockets) until the user has
        // ≥1 connected app or an in-flight pairing. Must sit directly after
        // NostrNDKProvider: it gates on its isInitialized flag.
        NostrSignerProvider,
        [WhitenoiseProvider, { accountIndex }],
        CocoProvider,
        WalletContextProvider,
        SovranColadaProvider,
        PricelistProvider,
        // Mounts BitChat DM listeners once per account scope without
        // starting BLE on app launch. BLE discovery announces to nearby
        // bitchat clients, so explicit peer-list/chat surfaces own startup.
        // Proximity DMs ship only with Nut Drop (ADR 0021).
        ...(hasFeature('nutDrop') ? [BitchatBLEProvider] : []),
        // Ecash sent as a Nostr message is redeemed here, with no chat screen
        // involved, so the conversation pages can be switched off (ADR 0021).
        ...(hasFeature('ecashMessages') ? [DmEcashAutoRedeemProvider] : []),
        AppGate,
      ]),
    [accountIndex]
  );

  return <InnerProviders>{children}</InnerProviders>;
}

/** Hold the old tree unmounted until all new-account stores have hydrated. */
const STORAGE_USAGE_REPORT_DELAY_MS = 60_000;

export function AccountSwitchBoundary({ children }: { children: React.ReactNode }) {
  const navigation = useNavigationContainerRef();
  const [suspended, setSuspended] = useState(false);
  const suspendedRef = useRef(false);
  const acknowledgement = useRef<{ resolve: () => void; reject: (error: unknown) => void } | null>(
    null
  );
  useEffect(
    () =>
      registerProfileSwitchBoundary({
        suspend: () =>
          suspendedRef.current
            ? Promise.resolve()
            : new Promise<void>((resolve, reject) => {
                acknowledgement.current = { resolve, reject };
                setSuspended(true);
              }),
        resume: () =>
          new Promise<void>((resolve, reject) => {
            acknowledgement.current = { resolve, reject };
            setSuspended(false);
          }),
      }),
    []
  );
  useEffect(() => {
    suspendedRef.current = suspended;
    if (!acknowledgement.current) return;
    const pending = acknowledgement.current;
    acknowledgement.current = null;
    try {
      if (!suspended) resetProfileNavigation(navigation);
      pending.resolve();
    } catch (error) {
      pending.reject(error);
    }
  }, [suspended, navigation]);
  return suspended ? null : children;
}

/** Registers resetStages/cancelResetStages with the orchestrator so profile transitions can show a splash. */
export function TransitionControlRegistrar() {
  const { resetStages, cancelResetStages } = useInitializationReset();

  useEffect(() => {
    registerTransitionControls({ resetStages, cancelResetStages });
  }, [resetStages, cancelResetStages]);

  return null;
}

/** Registers key derivation function with the orchestrator so createAndSwitchProfile can derive keys. */
export function KeyDerivationRegistrar() {
  useRegisterKeyDerivation();
  return null;
}

/** Clears the AsyncStorage transition guard on app startup (if leftover from a previous restart). */
export function TransitionGuardCleanup() {
  useEffect(() => {
    void clearTransitionGuardOnStartup();
    // Once per run, well after startup: how full AsyncStorage is. Android caps
    // it, and a full database fails saves with nothing on screen to show for it.
    const timer = setTimeout(() => void reportAsyncStorageUsage(), STORAGE_USAGE_REPORT_DELAY_MS);
    return () => clearTimeout(timer);
  }, []);
  return null;
}

/** Subscribes to coco mint-quote events and shows payment status sheet for NPC payments */
