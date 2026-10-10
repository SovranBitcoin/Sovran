import { Screen } from '@/shared/ui/composed/Screen';
/**
 * Shared amount route shell: compact title, amount actions and mint selection below the keypad.
 *
 * Follows the same pattern as LightningSendScreen, SendTokenScreen, etc:
 * receives a single serialized entry from the machine's step handler,
 * passes it to useScreenActions, and renders UI.
 */

import { useCallback, useContext, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { Stack } from 'expo-router';
import { HeaderHeightContext } from 'expo-router/react-navigation';

import { useExecutionState, useScreenActions, usePaymentFlowMachine } from 'wallet/react';
import {
  decodePaymentRequestInfo,
  fetchNip05Pubkey,
  minorToRawInput,
  type RecipientProfile,
} from 'wallet';

import { useMints } from '@cashu/coco-react';

import { useWalletContextWithOverride } from '@/shared/providers/WalletContextProvider';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { useNostrProfileMetadata } from '@/shared/hooks/useNostrProfileMetadata';
import { resolveIdentityName } from '@/shared/lib/identity';
import { Text } from '@/shared/ui/primitives/Text';
import { View } from '@/shared/ui/primitives/View/View';
import { withGlassHeaderItems } from '@/navigation/headerItems';
import { ScreenErrorState } from '@/shared/ui/composed/ScreenStates';
import { paymentLog, useLifecycleLogger, Log } from '@/shared/lib/logger';
import { guardedRouter as router } from '@/shared/hooks/useGuardedRouter';
import { useNearPaySessionStore } from '@/shared/stores/runtime/nearPayStore';
import { useOfflineStatus } from '@/shared/providers/OfflineProvider';
import { useSettingsStore } from '@/shared/stores/global/settingsStore';
import { useAmountDraftStore } from '@/shared/stores/runtime/amountDraftStore';
import { useContactSendStore } from '@/shared/stores/runtime/contactSendStore';
import { useRoutstrTopUpStore } from '@/shared/stores/runtime/routstrTopUpStore';
import { useNotePickerStore } from '@/shared/stores/runtime/notePickerStore';
import { zIndex } from '@/shared/styles/tokens';
import { E2EActionMenuProbe } from '@/shared/lib/popup/E2EActionMenuProbe';
import type { MintNuts } from '@/shared/lib/cashu/mintNuts';

import { AmountSelectedMintProbe } from '../components/AmountSelectedMintProbe';

import { RecipientHeader, RecipientHeaderBand } from '../components/RecipientHeader';
import { useSendLock } from '../hooks/useSendLock';
import { describeSendDelivery, requestCarrierOf } from '../lib/sendDelivery';

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
  return (
    <Screen name="AmountFlowScreen" scroll="none">
      <AmountFlowContent amountEntry={amountEntry} headerMode="native" />
    </Screen>
  );
}

export function AmountFlowContent({ amountEntry, headerMode = 'native' }: AmountFlowContentProps) {
  useLifecycleLogger(headerMode === 'native' ? 'AmountFlowScreen' : 'NearPayInlineAmountFlow');
  // Read the context directly, like `Screen` does: this content also renders
  // inline (Nut Drop) where no navigator header exists, and the hook throws there.
  const headerHeight = useContext(HeaderHeightContext) ?? 0;
  const foreground = useThemeColor('foreground');
  const background = useThemeColor('surface');

  const { entry, error, actions, suggestions, mintUrl } = useScreenActions(
    'amountEntry',
    amountEntry
  );

  const walletContext = useWalletContextWithOverride();
  // No explicit unit binding: the provider's getUnit already supplies the
  // live active unit, and a redundant binding here is last-binder-wins churn.
  const machine = usePaymentFlowMachine({ walletContext });
  const { isExecuting } = useExecutionState(machine);

  const handleRequestMintList = useCallback(() => {
    // Preserve the entered amount across the mint-selector round trip. colada
    // commits the typed amount to the machine only on `next`; opening the mint
    // selector tears down the amount session and re-enters a FRESH amount step
    // after a mint change, which would blank the keypad. Stash the live draft
    // here (the single chokepoint every flow's mint pill routes through) and
    // restore it on re-entry via the effect below.
    const rawInput = typeof entry?.rawInput === 'string' ? entry.rawInput : '';
    const inputMode = entry?.inputMode === 'fiat' ? 'fiat' : 'unit';
    const scope = typeof entry?.destination === 'string' ? entry.destination : '';
    const unit = typeof entry?.unit === 'string' ? entry.unit : 'sat';
    if (rawInput && rawInput !== '0') {
      useAmountDraftStore.getState().stash({ rawInput, inputMode, scope, unit });
    }
    void machine.requestMintSelector();
  }, [machine, entry]);

  // Restore the stashed amount when we return to a fresh amount step after a
  // mint change. `take` only returns the draft when the destination AND unit
  // match — a mint change can flip the active unit (pickHighestBalanceUnit
  // follow), and a draft typed as dollars must never replay into a sat keypad.
  // We re-apply via the same `setInput` action the keypad uses and only when
  // the keypad is currently empty.
  useEffect(() => {
    const scope = typeof entry?.destination === 'string' ? entry.destination : '';
    const unit = typeof entry?.unit === 'string' ? entry.unit : 'sat';
    const draft = useAmountDraftStore.getState().take(scope, unit);
    if (!draft) return;
    const currentRaw = typeof entry?.rawInput === 'string' ? entry.rawInput : '';
    if (currentRaw && currentRaw !== '0') return;
    void actions.setInput.execute({ input: draft.rawInput, mode: draft.inputMode });
  }, [mintUrl, entry?.destination, entry?.unit, entry?.rawInput, actions.setInput]);

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
  const [localIdentity, setLocalIdentity] = useState<{ target: string; pubkey: string } | null>(
    null
  );
  useEffect(() => {
    if (entryRecipientPubkey || liveCtx.recipientPubkey || !entryMeltTarget) return;
    const controller = new AbortController();
    let cancelled = false;
    void (async () => {
      try {
        const pk = await fetchNip05Pubkey(entryMeltTarget, { signal: controller.signal });
        if (cancelled) return;
        if (pk) setLocalIdentity({ target: entryMeltTarget, pubkey: pk });
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
    entryRecipientPubkey ??
    liveCtx.recipientPubkey ??
    (localIdentity?.target === entryMeltTarget ? localIdentity?.pubkey : undefined);
  const recipientProfile = entryRecipientProfile ?? liveCtx.recipientProfile;
  const { metadata: liveNostrMetadata } = useNostrProfileMetadata(recipientPubkey);
  const fallbackDisplayName = liveNostrMetadata
    ? resolveIdentityName({ pubkey: recipientPubkey ?? '', nostrProfile: liveNostrMetadata })
    : null;
  const nostrHeaderDisplayName = recipientProfile?.displayName ?? fallbackDisplayName ?? null;
  const headerDisplayName = nearPayRecipient?.nickname ?? nostrHeaderDisplayName;
  // A Nut Drop recipient resolves like any other: the peer's Nostr key is the
  // recipient pubkey, so its picture and seed are the ones the radar showed.
  // Only a peer that never exchanged identity falls back to its peerID.
  const headerAvatarUrl = recipientProfile?.avatarUrl ?? liveNostrMetadata?.picture ?? null;
  const headerSeed = recipientPubkey ?? nearPayRecipient?.peerID;
  const recipientReady = !!(headerDisplayName && (recipientPubkey || nearPayRecipient));

  // ── The lock ────────────────────────────────────────────────────────────
  // One owner for every flow: the header shows whether this ecash will be
  // locked, and no locked send leaves without the sender having said for how
  // long. See `useSendLock`.
  const { trustedMints } = useMints();
  const selectedMintNuts = useMemo(() => {
    const mint = trustedMints.find((m) => m.mintUrl === mintUrl);
    return (mint?.mintInfo as { nuts?: MintNuts } | undefined)?.nuts;
  }, [trustedMints, mintUrl]);
  const { isOffline: networkOffline } = useOfflineStatus();
  const mockOffline = useSettingsStore((state) => state.mockOffline);
  const sendOffline = mockOffline || networkOffline;
  const sendLock = useSendLock({
    entry: entry as Record<string, unknown> | undefined,
    ...(recipientPubkey ? { recipientPubkey } : {}),
    recipientName: headerDisplayName ?? 'this key',
    ...(mintUrl ? { selectedMintUrl: mintUrl } : {}),
    ...(selectedMintNuts ? { selectedMintNuts } : {}),
    offline: sendOffline,
  });

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
            nip05: recipientProfile?.nip05 ?? liveNostrMetadata?.nip05 ?? null,
          }
        : undefined,
    [headerDisplayName, headerAvatarUrl, liveNostrMetadata?.nip05, recipientProfile?.nip05]
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
  // The band hangs off the measured bar, and is raised over the amount body
  // because this screen mounts it first.
  const recipientBandStyle = useMemo(
    () => ({ top: headerHeight, zIndex: zIndex.sticky }),
    [headerHeight]
  );
  const amountBodyStyle = useMemo(() => ({ flex: 1 }), []);
  // A `headerTitle` function replaces the native title outright: the navigator
  // renders whatever this returns and ignores the `title` option entirely. So
  // both branches must return an ELEMENT — the fallback used to return the bare
  // string 'Select amount', which is not renderable in a native header view,
  // and left every amount page with no title at all.
  //
  // It also has to stay a function in both states. `recipientReady` flips
  // false → true as the kind-0 resolves, and React Navigation caches the header
  // title's form; swapping between the `title` string and a render function
  // mid-screen leaves the old form on screen (see MintAddScreen).
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
        <Text className="text-foreground" size={17} bold>
          Select amount
        </Text>
      ),
    [headerAvatarUrl, headerDisplayName, headerSeed, recipientPubkey, recipientReady]
  );
  const isSendOperation = entry?.destination !== 'mintQuote';
  // Who can take the ecash and whether sending it needs a network: the
  // display's offline mark, and the sentence behind it.
  const entryDestination = typeof entry?.destination === 'string' ? entry.destination : undefined;
  const entryPaymentRequest =
    typeof entry?.paymentRequest === 'string' ? entry.paymentRequest : null;
  // How the ecash gets there is the flow's, decided before any amount: a
  // request names its transport, a Nut Drop goes over the mesh, a contact is
  // sent a Nostr message, and anything else is shown for the other phone.
  const contactSendActive = useContactSendStore((state) => state.active !== null);
  const routstrTopUpActive = useRoutstrTopUpStore((state) => state.phase === 'active');
  const carrier = useMemo(() => {
    if (entryPaymentRequest) {
      return requestCarrierOf(decodePaymentRequestInfo(entryPaymentRequest)?.transports);
    }
    if (nearPayRecipient) return 'bluetooth' as const;
    // An AI-credit top-up is ecash posted to the provider, never handed over.
    if (routstrTopUpActive) return 'server' as const;
    return contactSendActive ? ('nostr' as const) : ('scan' as const);
  }, [contactSendActive, entryPaymentRequest, nearPayRecipient, routstrTopUpActive]);
  const delivery = useMemo(
    () =>
      describeSendDelivery({
        ...(entryDestination ? { destination: entryDestination } : {}),
        lockMode: sendLock.mode,
        locked: sendLock.locked,
        recipientName: headerDisplayName,
        canSendOffline,
        carrier,
      }),
    [entryDestination, sendLock.mode, sendLock.locked, headerDisplayName, canSendOffline, carrier]
  );
  // The notes held at the mint being sent from, for picking by hand. Only an
  // ecash send offers it: the point of picking is an amount that needs no mint.
  const heldNotes = mintUrl ? walletContext?.proofAmounts[mintUrl] : undefined;
  const entryUnit = typeof entry?.unit === 'string' ? entry.unit : 'sat';
  // In minor units of the account's unit, as the notes are. `numericValue`
  // is the typed figure, which is dollars on a fiat account.
  const effective = entry?.effectiveAmount as { value?: unknown } | undefined;
  const effectiveAmount = typeof effective?.value === 'number' ? effective.value : 0;
  // Offered on every ecash send from a mint, whatever the list holds at this
  // instant: the list empties for a moment whenever the wallet reloads its
  // proofs (creating ecash does), and a key that came and went with it made
  // the keypad's function column jump. An empty picker says so itself.
  const canPickNotes = entryDestination === 'sendEcash' && !!mintUrl;
  const handlePickNotes = useCallback(() => {
    const notes = heldNotes ?? [];
    paymentLog.info('amount_flow.notes.open', { held: notes.length, unit: entryUnit });
    useNotePickerStore.getState().present({
      notes,
      unit: entryUnit,
      // An amount that can already leave offline opens with its notes picked,
      // whichever currency it was typed in: a fiat entry resolves to a sat
      // amount, and that is the one the notes make. Any other amount opens
      // empty rather than on a near miss.
      amount: canSendOffline === true ? effectiveAmount : 0,
      onUse: (total) => {
        paymentLog.info('amount_flow.notes.use', { total, unit: entryUnit });
        void actions.setInput.execute({ input: minorToRawInput(total, entryUnit), mode: 'unit' });
      },
    });
    router.push('/notes');
  }, [actions.setInput, canSendOffline, effectiveAmount, entryUnit, heldNotes]);
  const stackOptions = useMemo(
    () =>
      withGlassHeaderItems({
        // Unused while `headerTitle` is set, but it is what the back button on
        // the next screen and the accessibility page title read.
        title: 'Select amount',
        headerTitleAlign: 'center' as const,
        headerTitle: renderHeaderTitle,
        headerTintColor: foreground,
      }),
    [foreground, renderHeaderTitle]
  );
  const handleErrorGoBack = useCallback(() => {
    void actions.back.execute();
  }, [actions.back]);

  if (error) {
    return <ScreenErrorState message={error} onGoBack={handleErrorGoBack} />;
  }

  if (!entry) {
    return <View style={emptyEntryStyle} />;
  }

  return (
    <Log name="AmountFlowContent">
      {headerMode === 'native' ? <Stack.Screen options={stackOptions} /> : null}
      {/* The name the bar gave up for a full-size picture. Mounted before the
          body, so it is raised over it rather than painted under. */}
      {headerMode === 'native' && recipientReady ? (
        <View pointerEvents="none" className="absolute left-0 right-0" style={recipientBandStyle}>
          <RecipientHeaderBand
            displayName={headerDisplayName!}
            pubkey={recipientPubkey}
            nip05={forwardedRecipientProfile?.nip05}
          />
        </View>
      ) : null}
      <View style={amountBodyStyle}>
        <E2EActionMenuProbe />
        {mintUrl ? <AmountSelectedMintProbe mintUrl={mintUrl} /> : null}
        <AmountSelector
          entry={entry}
          actions={actions}
          suggestions={suggestions}
          transactionType={isSendOperation ? 'send' : 'receive'}
          machineBusy={isExecuting}
          showMintBottomButton
          mintUrl={mintUrl}
          onRequestMintList={handleRequestMintList}
          recipientPubkey={recipientPubkey}
          recipientProfile={forwardedRecipientProfile}
          lockChoice={sendLock.lockChoice}
          confirmLock={sendLock.confirmLock}
          askLock={sendLock.askLock}
          delivery={delivery}
          onPickNotes={canPickNotes ? handlePickNotes : undefined}
          suppressNextVariants={!!nearPayRecipient}
        />
      </View>
    </Log>
  );
}
