/**
 * The part of the app that belongs to one account.
 *
 * `AccountScope` is mounted with `key={account-<index>}`, so changing the
 * active account unmounts everything here and mounts a fresh set: keys, the
 * Nostr client, the wallet core and everything under them. It binds the
 * account to the headless `appRuntime` and keeps only what React needs:
 * Coco's bindings, the payment machine, the gate and the per-account hosts.
 * What lives outside React is not replaced by that remount; it is listed in
 * `shared/lib/account/accountRegistry.ts`.
 *
 * `AccountSwitchBoundary` wraps it so an in-process profile switch can hold
 * the tree unmounted while stores are reset.
 */
import React, { useEffect, useRef, useState } from 'react';
import { useNavigationContainerRef } from 'expo-router';

import { resetProfileNavigation } from '@/shared/lib/profile/resetProfileNavigation';
import { hasPresentedRoutes, joinOrStart } from '@/shared/lib/profile/suspendHelpers';
import { registerProfileSwitchBoundary } from '@/shared/lib/account/accountRegistry';
import { DmEcashAutoRedeemProvider } from '@/features/payments/hooks/useDmEcashAutoRedeem';
import { useBitchatAccountServices } from '@/features/bitchat/hooks/useBitchatAccountServices';
import { cashuLog, initLog, paymentLog, useInitMount } from '@/shared/lib/logger';
import AppGate from '@/shared/blocks/AppGate';
import PopupHost from '@/shared/blocks/popup/PopupHost';
import { ActionMenuHost } from '@/shared/blocks/popup/ActionMenuHost';
import { E2EToastProbe } from '@/shared/lib/popup/E2EToastProbe';
import { NostrKeysProvider } from '@/shared/providers/NostrKeysProvider';
import { hasFeature } from '@/shared/config/features';
import { BackupFlowProvider } from '@/features/backup/BackupFlowProvider';
import { SovranColadaProvider } from '@/features/send/providers/Colada';
import { useRegisterKeyDerivation } from '@/shared/hooks/useRegisterKeyDerivation';
import { useProfileBalanceSync } from '@/features/wallet';
import { usePaymentStatusListener } from '@/shared/hooks/usePaymentStatusListener';
import { useSwapLegReconciler } from '@/shared/hooks/useSwapLegReconciler';
import { useSwapStatusListener } from '@/shared/hooks/useSwapStatusListener';
import { useOwnEventsSync } from '@/shared/lib/nostr/ownsync/useOwnEventsSync';
import { useOwnSocialGraphSeed } from '@/shared/lib/nostr/ownsync/useOwnSocialGraphSeed';
import { appRuntime } from './AppRuntime';
import { useNostrClientLifecycle } from './nostrClient';
import { WalletCore } from './WalletCore';
import { WalletProjection } from './WalletProjection';

function NostrClientLifecycle({ accountIndex }: { accountIndex: number }) {
  useNostrClientLifecycle(accountIndex);
  return null;
}

/**
 * BitChat DM listeners and Nut Drop auto-redeem, without starting BLE on app
 * launch: discovery announces to nearby bitchat clients, so explicit
 * peer-list and chat surfaces own startup. Ships only with Nut Drop (ADR 0021).
 */
function BitchatServices() {
  useBitchatAccountServices();
  return null;
}

/**
 * The account's invisible listeners: key derivation for new profiles, payment
 * and swap status sheets, the profile balance mirror, and the own-events relay
 * sync that hydrates the canonical own-state stores (profile, follows, likes,
 * reposts, replies, own notes). The follow seed reads from the tiered facade
 * (ADR 0003); the relay sub stays the write-authoritative live-delta listener,
 * merged via the same LWW gate.
 */
function AccountListeners() {
  useEffect(() => {
    paymentLog.info('app.payment_status_listener.mount');
    return () => {
      paymentLog.info('app.payment_status_listener.unmount');
    };
  }, []);
  useRegisterKeyDerivation();
  usePaymentStatusListener();
  useSwapLegReconciler();
  // Re-pops the unified Swap toast on running→terminal transitions when the
  // user dismissed it mid-flight.
  useSwapStatusListener();
  useProfileBalanceSync();
  useOwnEventsSync();
  useOwnSocialGraphSeed();
  return null;
}

function Gate({ children }: { children: React.ReactNode }) {
  return (
    <AppGate>
      <AccountListeners />
      {children}
      <E2EToastProbe />
      {/* Same-window host for the Android feed media lightbox; must sit
          BEFORE PopupHost so popups triggered from inside the lightbox stack
          above it. No-op on iOS / when empty. */}
      <PopupHost />
      <ActionMenuHost />
    </AppGate>
  );
}

export function AccountScope({
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
    appRuntime.start(accountIndex);
    return () => {
      appRuntime.stop();
      cashuLog.info('app.account_scoped_providers.unmount', { accountIndex });
    };
  }, [accountIndex]);

  // Ecash sent as a Nostr message is redeemed with no chat screen involved,
  // so the conversation pages can be switched off (ADR 0021).
  // The backup session sits above the route stack, so one session lasts from
  // the intro to done; it resets when the journey closes and per account.
  const gated = (
    <Gate>
      <BackupFlowProvider>{children}</BackupFlowProvider>
    </Gate>
  );
  return (
    <NostrKeysProvider defaultAccountIndex={accountIndex}>
      <NostrClientLifecycle accountIndex={accountIndex} />
      <WalletCore>
        <WalletProjection>
          <SovranColadaProvider>
            {hasFeature('nutDrop') ? <BitchatServices /> : null}
            {hasFeature('ecashMessages') ? (
              <DmEcashAutoRedeemProvider>{gated}</DmEcashAutoRedeemProvider>
            ) : (
              gated
            )}
          </SovranColadaProvider>
        </WalletProjection>
      </WalletCore>
    </NostrKeysProvider>
  );
}

/** Long enough for a sheet the system presented to finish going away. */
const SHEET_DISMISS_MS = 450;

/**
 * Sheets presented natively (a route modal such as Receive or the backup
 * prompt) stay on screen after the navigator that opened them is unmounted,
 * above everything, with controls that no longer do anything. Before
 * unmounting, send navigation back to its root, which closes them, and give
 * the dismissal time to finish.
 *
 * Only when something is presented: resetting remounts the drawer, which lets
 * the outgoing account's first screen run again for the moment before the
 * tree is unmounted. Keeping the root route's key avoids that remount but does
 * not close a sheet held by a nested navigator (tried on a device). Best
 * effort: unmounting matters more than a tidy dismissal.
 */
async function closePresentedSheets(
  navigation: ReturnType<typeof useNavigationContainerRef>
): Promise<void> {
  try {
    if (!navigation.isReady() || !hasPresentedRoutes(navigation.getRootState())) return;
    resetProfileNavigation(navigation);
    await new Promise((resolve) => setTimeout(resolve, SHEET_DISMISS_MS));
  } catch {
    // Nothing to do: the tree is unmounted next either way.
  }
}

/** Hold the old tree unmounted until all new-account stores have hydrated. */
export function AccountSwitchBoundary({ children }: { children: React.ReactNode }) {
  const navigation = useNavigationContainerRef();
  const [suspended, setSuspended] = useState(false);
  const suspendedRef = useRef(false);
  const suspending = useRef<Promise<void> | null>(null);
  const acknowledgement = useRef<{ resolve: () => void; reject: (error: unknown) => void } | null>(
    null
  );
  useEffect(
    () =>
      registerProfileSwitchBoundary({
        suspend: () => {
          if (suspendedRef.current) return Promise.resolve();
          // One suspension at a time. A second caller (the fallback hold,
          // while a timed-out switch is still pending) joins the first; two
          // would overwrite each other's acknowledgement and one would hang.
          return joinOrStart(suspending, async () => {
            await closePresentedSheets(navigation);
            await new Promise<void>((resolve, reject) => {
              acknowledgement.current = { resolve, reject };
              setSuspended(true);
            });
          });
        },
        resume: () =>
          new Promise<void>((resolve, reject) => {
            acknowledgement.current = { resolve, reject };
            setSuspended(false);
          }),
      }),
    [navigation]
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
