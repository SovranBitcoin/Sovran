/**
 * Shared send/receive amount route shell: mint header, amount entry screen actions, AmountSelector.
 *
 * Follows the same pattern as LightningSendScreen, SendTokenScreen, etc:
 * receives a single serialized entry from the machine's step handler,
 * passes it to useScreenActions, and renders UI.
 */

import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { Stack } from 'expo-router';

import { useExecutionState, useScreenActions, usePaymentFlowMachine } from '@sovranbitcoin/colada/react';
import { fetchNip05Pubkey, type RecipientProfile } from '@sovranbitcoin/colada';

import { MintSelector } from '@/features/wallet';
import { useWalletContextWithOverride } from '@/shared/providers/WalletContextProvider';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { useNostrProfileMetadata } from '@/shared/hooks/useNostrProfileMetadata';
import { resolveIdentityName } from '@/shared/lib/identity';
import { IconSymbol } from '@/shared/ui/primitives/icon-symbol';
import { View } from '@/shared/ui/primitives/View/View';
import { ScreenErrorState } from '@/shared/ui/composed/ScreenStates';
import { paymentLog, useLifecycleLogger, Log } from '@/shared/lib/logger';
import { useNearPaySessionStore } from '@/shared/stores/runtime/nearPayStore';

import { RecipientHeader } from '../components/RecipientHeader';

import { AmountSelector } from './AmountSelector';

interface AmountFlowScreenProps {
  amountEntry?: string;
}

interface AmountFlowContentProps {
  amountEntry?: string;
  headerMode?: 'native' | 'none';
}

const AMOUNT_FLOW_DIAGNOSTIC_LOGS_ENABLED = false;

export function AmountFlowScreen({ amountEntry }: AmountFlowScreenProps) {
  return <AmountFlowContent amountEntry={amountEntry} headerMode="native" />;
}

export function AmountFlowContent({ amountEntry, headerMode = 'native' }: AmountFlowContentProps) {
  useLifecycleLogger(headerMode === 'native' ? 'AmountFlowScreen' : 'NearPayInlineAmountFlow');
  const foreground = useThemeColor('foreground');
  const background = useThemeColor('background');

  const { entry, error, actions, suggestions, mintUrl } = useScreenActions(
    'amountEntry',
    amountEntry
  );

  const walletContext = useWalletContextWithOverride();
  const machine = usePaymentFlowMachine({ walletContext, unit: 'sat' });
  const { isExecuting } = useExecutionState(machine);

  const handleRequestMintList = useCallback(() => {
    void machine.requestMintSelector();
  }, [machine]);

  const canSendOffline = typeof entry?.canSendOffline === 'boolean' ? entry.canSendOffline : null;

  // Recipient identity resolution. Three read paths so we cover every
  // race / wiring quirk:
  //   1. `entry.recipientPubkey/Profile` — snapshot baked into the route
  //      param when the machine's resolver beat the navigation (e.g. the
  //      Contacts/chat path that seeds pubkey at flow start).
  //   2. Live `machine.getContext()` via `useSyncExternalStore` — picks up
  //      pubkey/profile the machine resolves *after* the user navigated.
  //   3. Screen-level NIP-05 fallback — when the machine never plumbed a
  //      pubkey down (scan-LA flow can land here before the machine
  //      finishes resolving, and the `useSyncExternalStore` live-read has
  //      been observed to miss the update in some setups), we run the
  //      same `fetchNip05Pubkey` locally off `entry.meltTarget`. Pure HTTP
  //      one-shot, safe to call from a screen effect.
  //   • `useNostrProfileMetadata(pubkey)` then resolves the kind-0 profile
  //     for whichever pubkey landed first. Shared SWR cache means warm
  //     hits across ContactRow / HistoryEntryHeader / profile screens.
  const liveCtx = useSyncExternalStore(machine.subscribe, machine.getContext, machine.getContext);
  const entryRecipientPubkey =
    typeof entry?.recipientPubkey === 'string' ? entry.recipientPubkey : undefined;
  const entryRecipientProfile = entry?.recipientProfile as RecipientProfile | undefined;
  const entryMeltTarget = typeof entry?.meltTarget === 'string' ? entry.meltTarget : null;
  const nearPaySession = useNearPaySessionStore((s) => s.active);
  const nearPayRecipient =
    entry?.destination === 'sendEcash' ? (nearPaySession?.recipient ?? null) : null;

  // Path 3: local NIP-05 fallback. Kicks in only when neither the entry
  // nor the live ctx already supplied a pubkey. Cancellable so a melt
  // target swap (or unmount) doesn't apply a stale resolution.
  const [localPubkey, setLocalPubkey] = useState<string | null>(null);
  useEffect(() => {
    if (entryRecipientPubkey || liveCtx.recipientPubkey || !entryMeltTarget) return;
    const controller = new AbortController();
    let cancelled = false;
    void (async () => {
      try {
        const pk = await fetchNip05Pubkey(entryMeltTarget, { signal: controller.signal });
        if (cancelled) return;
        if (pk) setLocalPubkey(pk);
      } catch (e) {
        if (cancelled) return;
        paymentLog.debug('amount_flow.local_nip05.failed', {
          target: entryMeltTarget.slice(0, 40),
          error: e instanceof Error ? e.message : String(e),
        });
      }
    })();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [entryRecipientPubkey, liveCtx.recipientPubkey, entryMeltTarget]);

  const recipientPubkey =
    entryRecipientPubkey ?? liveCtx.recipientPubkey ?? localPubkey ?? undefined;
  const recipientProfile = entryRecipientProfile ?? liveCtx.recipientProfile;
  const { metadata: liveNostrMetadata } = useNostrProfileMetadata(recipientPubkey);
  const fallbackDisplayName = liveNostrMetadata
    ? resolveIdentityName({ pubkey: recipientPubkey ?? '', nostrProfile: liveNostrMetadata })
    : null;
  const nostrHeaderDisplayName = recipientProfile?.displayName ?? fallbackDisplayName ?? null;
  const headerDisplayName = nearPayRecipient?.nickname ?? nostrHeaderDisplayName;
  const headerAvatarUrl = nearPayRecipient
    ? null
    : (recipientProfile?.avatarUrl ?? liveNostrMetadata?.picture ?? null);
  const headerSeed = nearPayRecipient?.peerID ?? recipientPubkey;
  const recipientReady = !!(headerDisplayName && (recipientPubkey || nearPayRecipient));

  useEffect(() => {
    if (!nearPayRecipient) return;
    return () => {
      const current = useNearPaySessionStore.getState().active;
      if (current?.recipient.peerID === nearPayRecipient.peerID) {
        useNearPaySessionStore.getState().clear();
      }
    };
  }, [nearPayRecipient]);

  // Profile bundle forwarded to AmountSelector → `actions.next.execute(...)` →
  // machine.enterAmount → entry.metadata. Forwarded whenever we have a
  // display name (with or without an avatar), so LightningSendScreen renders
  // the recipient header on first paint instead of paying a second kind-0
  // round-trip. The previous gate (`recipientReady && headerDisplayName`)
  // dropped the whole profile when `headerDisplayName` was momentarily
  // null at tap-time, causing the flicker the user observed.
  //
  // Memoized so the prop ref is stable across renders that don't change
  // identity — avoids spurious `AmountSelector.nextExecuteParams`
  // invalidation that would otherwise propagate through useMemo deps.
  const forwardedRecipientProfile = useMemo<RecipientProfile | undefined>(
    () =>
      headerDisplayName
        ? {
            displayName: headerDisplayName,
            avatarUrl: headerAvatarUrl,
            nip05: nearPayRecipient ? null : (liveNostrMetadata?.nip05 ?? null),
          }
        : undefined,
    [headerDisplayName, headerAvatarUrl, liveNostrMetadata?.nip05, nearPayRecipient]
  );

  useEffect(() => {
    if (error) paymentLog.warn('send.amount_flow.error', { error });
  }, [error]);

  useEffect(() => {
    if (!AMOUNT_FLOW_DIAGNOSTIC_LOGS_ENABLED) return;
    paymentLog.debug('amount_flow.entry_dump', {
      entryKeys: entry ? Object.keys(entry) : null,
      entryRecipientPubkey:
        typeof entry?.recipientPubkey === 'string' ? entry.recipientPubkey.slice(0, 8) : null,
      entryRecipientProfilePresent: !!entry?.recipientProfile,
      entryMeltTarget: typeof entry?.meltTarget === 'string' ? entry.meltTarget.slice(0, 40) : null,
      entryDestination: entry?.destination ?? null,
      nearPayPeerID: nearPayRecipient?.peerID ?? null,
    });
  }, [entry, nearPayRecipient?.peerID]);

  useEffect(() => {
    if (!AMOUNT_FLOW_DIAGNOSTIC_LOGS_ENABLED) return;
    const log = () => {
      const ctx = machine.getContext();
      paymentLog.debug('amount_flow.machine_ctx_snapshot', {
        step: machine.getStep(),
        destination: ctx.destination ?? null,
        meltTarget: ctx.meltTarget ? ctx.meltTarget.slice(0, 40) : null,
        recipientPubkey: ctx.recipientPubkey ? ctx.recipientPubkey.slice(0, 8) : null,
        recipientProfileDisplayName: ctx.recipientProfile?.displayName ?? null,
      });
    };
    log();
    return machine.subscribe(log);
  }, [machine]);

  const emptyEntryStyle = useMemo(() => ({ flex: 1, backgroundColor: background }), [background]);
  const amountBodyStyle = useMemo(() => ({ flex: 1 }), []);
  const isSendOperation = entry?.destination !== 'mintQuote';
  const offlineIconStyle = useMemo(
    () => ({ opacity: canSendOffline === null ? 0.3 : 1 }),
    [canSendOffline]
  );
  const renderHeaderTitle = useCallback(
    () =>
      recipientReady ? (
        <RecipientHeader
          pubkey={recipientPubkey}
          seed={headerSeed}
          displayName={headerDisplayName!}
          avatarUrl={headerAvatarUrl}
        />
      ) : (
        <MintSelector selectedMintUrl={mintUrl} onRequestMintList={handleRequestMintList} />
      ),
    [
      handleRequestMintList,
      headerAvatarUrl,
      headerDisplayName,
      headerSeed,
      mintUrl,
      recipientPubkey,
      recipientReady,
    ]
  );
  const renderHeaderRight = useCallback(
    () => (
      <IconSymbol
        name={canSendOffline === true ? 'airplane' : 'wifi'}
        size={18}
        color={foreground}
        style={offlineIconStyle}
      />
    ),
    [canSendOffline, foreground, offlineIconStyle]
  );
  const stackOptions = useMemo(
    () => ({
      title: 'Select amount',
      headerTitleAlign: 'center' as const,
      headerTitle: renderHeaderTitle,
      headerTintColor: foreground,
      headerRight: isSendOperation && mintUrl ? renderHeaderRight : undefined,
    }),
    [foreground, isSendOperation, mintUrl, renderHeaderRight, renderHeaderTitle]
  );

  if (error) {
    return (
      <ScreenErrorState
        message={error}
        onGoBack={() => {
          void actions.back.execute();
        }}
      />
    );
  }

  if (!entry) {
    return <View style={emptyEntryStyle} />;
  }

  return (
    <Log name="AmountFlowScreen">
      {headerMode === 'native' ? <Stack.Screen options={stackOptions} /> : null}
      <View style={amountBodyStyle}>
        <AmountSelector
          entry={entry}
          actions={actions}
          suggestions={suggestions}
          transactionType={isSendOperation ? 'send' : 'receive'}
          machineBusy={isExecuting}
          showMintBottomButton={recipientReady}
          mintUrl={mintUrl}
          onRequestMintList={handleRequestMintList}
          recipientPubkey={recipientPubkey}
          recipientProfile={forwardedRecipientProfile}
          suppressNextVariants={!!nearPayRecipient}
        />
      </View>
    </Log>
  );
}
