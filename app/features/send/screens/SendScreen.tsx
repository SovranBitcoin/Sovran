/**
 * @fileoverview Send screen — the destination-first front door for sending.
 *
 * Reached from the wallet Send button (`machine.startSend()` → the Colada
 * `selectDestination` step → this route). Instead of jumping straight to amount
 * entry, the user picks HOW to pay:
 *
 *   • a destination input (top) that accepts any payment string (lightning
 *     address, bolt11, cashu token, NUT-18 creq, on-chain, npub) via Paste /
 *     keyboard-submit / the detected-action row — every path routed through the
 *     one canonical `machine.scan` entry (identical parse, dedup, and `'paste'`
 *     source tagging), never `machine.execute` directly and never a new
 *     app-side parser;
 *   • four method rows (QR Scan, Create Ecash, Tap-to-pay, Nut Drop), each with
 *     a `CircleActionButton` circle as its leading icon — liquid glass on
 *     supported devices, flat otherwise. On focus they collapse into a compact
 *     row of the SAME buttons, clearing room for contact search results — nearby
 *     Nut Drop peers, then nagg/primal. The icon never changes type across the
 *     fade.
 *
 * Tapping a searched contact seeds `recipientPubkey` (+ `meltTarget` when they
 * advertise a lud16) and marks `contactSendStore`, so after the amount the user
 * can pay over Lightning (recommended when available) or have a bearer ecash
 * token delivered to them over an encrypted Nostr DM.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Platform, ScrollView, StyleSheet, TextInput } from 'react-native';
import { useHeaderHeight } from 'expo-router/react-navigation';
import { usePaymentFlowMachine } from 'wallet/react';
import { describeDestination, defaultDetectors, parsePaymentInput } from 'wallet';
import type { BLEPeer } from 'bitchat-module';
import Animated, {
  Easing,
  Extrapolation,
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { withAlpha } from '@/shared/lib/color';

import { useWalletContext } from '@/shared/providers/WalletContextProvider';
import { useHandleCameraPermission } from '@/features/camera';
import { useBLEPeers } from '@/features/bitchat/hooks/useBLEPeers';
import {
  BLE_PEER_FRESHNESS_TICK_MS,
  filterFreshBLEPeers,
} from '@/features/bitchat/lib/blePeerSnapshots';
import {
  peerDisplayName,
  peerIdentitySeed,
  peerNostrPubkey,
} from '@/features/nearPay/lib/peerProfile';
import { useRememberPeers } from '@/features/nearPay/hooks/useRememberPeers';
import {
  useOverlaidContactSearch,
  CONTACT_SEARCH_MIN_LENGTH,
} from '@/features/contacts/hooks/useOverlaidContactSearch';
import { useQuickPayPeople, type QuickPayPerson } from '@/features/send/hooks/useQuickPayPeople';
import { E2EToastProbe } from '@/shared/lib/popup/E2EToastProbe';
import { clearPaymentContext } from '@/shared/stores/runtime/clearPaymentContext';
import { useContactSendStore } from '@/shared/stores/runtime/contactSendStore';
import { normalizeRecentPersonPubkey } from '@/shared/stores/profile/recentPeopleStore';
import type { NostrSearchResult } from '@/shared/lib/apiClient';
import { useNfcSupported } from '@/shared/lib/nfc';
import { useNfcTapStore } from '@/shared/stores/runtime/nfcTapStore';
import { showActionSheet } from '@/shared/lib/popup';
import { guardedRouter as router } from '@/shared/hooks/useGuardedRouter';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { paymentLog } from '@/shared/lib/logger';
import { ListRow } from '@/shared/ui/composed/ListRow';
import { ContactRow, nostrIdentity } from '@/shared/ui/composed/ContactRow';
import { useScreenOptions } from '@/shared/ui/composed/Screen';
import { DetectedActionRow } from '@/features/send/components/DetectedActionRow';
import { CircleActionButton } from '@/shared/ui/composed/CircleActionButton';
import { Text } from '@/shared/ui/primitives/Text';
import { View } from '@/shared/ui/primitives/View/View';
import { VStack } from '@/shared/ui/primitives/View/VStack';
import Icon from 'assets/icons';

// Leading icon size — matched to the liquid-glass CircleActionButton (52).
const ROW_ICON = 52;
// One ListRow's height: leading icon (52) + 2× vertical padding (12).
const LISTROW_H = ROW_ICON + 24;
// Collapsed glass row: 12 top pad + CircleActionButton (52 + 6 + 18 label) + a little.
const COLLAPSED_H = 92;
// Duration of the expanded-rows ⇄ collapsed-row cross-fade, both directions.
const METHODS_FADE_MS = 300;

interface SendMethod {
  id: 'qr' | 'createEcash' | 'nfc' | 'nutDrop';
  /** Row title (also the VoiceOver/TalkBack name). */
  title: string;
  /** Row subtitle in the expanded list. */
  subtitle: string;
  /** Short caption under the icon in the collapsed row. */
  caption: string;
  /** Monicon glyph (Android + non-glass iOS fallback). */
  icon: string;
  /** SF Symbol — renders the circle as liquid glass on supported iOS devices. */
  systemIcon: string;
  onPress: () => void | Promise<void>;
}

function resultDisplayName(profile: NostrSearchResult): string {
  return profile.displayName ?? profile.name ?? '';
}

export function SendScreen({ unit }: { unit: string }) {
  const walletContext = useWalletContext();
  const machine = usePaymentFlowMachine({ walletContext, unit });
  const headerHeight = useHeaderHeight();
  const { handlePermission } = useHandleCameraPermission();

  const [foreground, surfaceSecondary, accent, overlay] = useThemeColor([
    'foreground',
    'surface-secondary',
    'accent',
    'overlay',
  ] as const);

  // This screen paints its canvas with `overlay` (below) via a raw ScrollView
  // rather than the `Screen` component, so it misses Screen's bgColor→header
  // auto-sync. Declare the page color to the header so the Android sheet's
  // scrim (FlowSheetHeader) fades from `overlay`, not the darker theme
  // `background` — otherwise the header gradient reads as a wrong-colored slab.
  // iOS ignores headerStyle.backgroundColor under the transparent blur header.
  useScreenOptions(() => ({ headerStyle: { backgroundColor: overlay } }), [overlay]);

  const [query, setQuery] = useState('');
  const [focused, setFocused] = useState(false);

  // ── Nearby Nut Drop peers (passive BLE discovery) ────────────────────────
  const { peers } = useBLEPeers();
  // Persist identified peers (with their nickname) so they survive into the
  // quick-pay tier after they leave range.
  useRememberPeers(peers);
  // Re-tick so stale peers drop out of the fresh window without a peer event.
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), BLE_PEER_FRESHNESS_TICK_MS);
    return () => clearInterval(id);
  }, []);
  const freshPeers = useMemo(
    () => filterFreshBLEPeers(peers, Date.now()).filter((p) => peerNostrPubkey(p) != null),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- re-run on tick
    [peers, query]
  );

  // Live peers already show in the "Nearby" tier, so exclude them from the
  // People results (search hits + recents) below.
  const livePeerPubkeys = useMemo(
    () =>
      freshPeers
        .map((p) => normalizeRecentPersonPubkey(peerNostrPubkey(p)))
        .filter((key): key is string => !!key),
    [freshPeers]
  );

  // ── People search — the SAME canonical assembly wallet/feed use ───────────
  // `useOverlaidContactSearch` wraps `useContactSearch` + the kind-0 overlay so
  // Send inherits identical results and per-result metrics, but WITHOUT
  // `useAllSearchResults`' unconditional `useLocationTiers()` — no location
  // permission prompt on a payment screen.
  const { contactRows, loading: searchLoading } = useOverlaidContactSearch(query);
  const trimmed = query.trim();
  const isTyping = trimmed.length >= CONTACT_SEARCH_MIN_LENGTH;

  // Recent people — the rich merge: everyone we've searched, sent to, been paid
  // by, or stood near over the Nut Drop mesh (tx counterparties + recentPeopleStore).
  // Shown at rest AND while focused-empty; replaced by live results once typing.
  // Live Nearby peers are excluded (they get their own "Nearby" tier).
  const quickPayPeople = useQuickPayPeople(livePeerPubkeys);
  // Stay in search mode while the field is focused OR a query is present. Tying
  // this to focus alone snapped back to the method rows the moment a drag-scroll
  // dismissed the keyboard (which blurs the input) — so the results couldn't be
  // scrolled. A non-empty query keeps us in search until the user clears it.
  const inSearch = focused || trimmed.length > 0;

  // When the input parses into a payable destination, colada tells us what to
  // show (kind, amount, label, icon, action). Whitespace ⇒ name search (same
  // rule as handleSubmitDestination), and an unsupported/partial parse ⇒ no row.
  const destinationDescriptor = useMemo(() => {
    if (!trimmed || /\s/.test(trimmed)) return null;
    const d = describeDestination(
      parsePaymentInput(trimmed, defaultDetectors),
      defaultDetectors,
      walletContext
    );
    return d.kind === 'unsupported' ? null : d;
  }, [trimmed, walletContext]);

  // Drives the list → glass-row cross-fade + the container collapse.
  const progress = useSharedValue(0);
  useEffect(() => {
    progress.value = withTiming(inSearch ? 1 : 0, {
      duration: METHODS_FADE_MS,
      easing: Easing.inOut(Easing.cubic),
    });
  }, [inSearch, progress]);

  // Keep the collapsed icon row mounted through the fade-BACK so unfocusing is a
  // true reverse cross-fade — the expanded layer fades in over the still-present
  // collapsed row — instead of the row popping out the instant focus is lost.
  // Unmount once the fade settles so the glass row stays off at rest.
  const [showCollapsed, setShowCollapsed] = useState(false);
  useEffect(() => {
    if (inSearch) {
      setShowCollapsed(true);
      return;
    }
    const id = setTimeout(() => setShowCollapsed(false), METHODS_FADE_MS);
    return () => clearTimeout(id);
  }, [inSearch]);

  // ── Destination input actions (route through Colada's parser) ─────────────
  // The Paste button reads the clipboard via the same `machine.scan` the camera
  // uses (no data → clipboard source). Typed/pasted-into-field destinations are
  // handed to `machine.scan(input, …)` too — the SINGLE canonical entry — so
  // they get identical parse, dedup, and `'paste'` source tagging (via the app's
  // clipboard→paste sourceMap). Never `machine.execute` directly: that bypasses
  // scan's dedup and leaves the source untagged (mislabeled `'qr'` downstream).
  const handlePaste = useCallback(() => {
    paymentLog.info('send.destination.paste');
    void machine.scan?.();
  }, [machine]);

  // Once focused / typing, the Paste affordance becomes Cancel: clear the input
  // and blur so the user drops straight back to the methods + recents at rest.
  const inputRef = useRef<TextInput>(null);
  const handleCancel = useCallback(() => {
    paymentLog.info('send.destination.cancel');
    setQuery('');
    setFocused(false);
    inputRef.current?.blur();
  }, []);

  // One canonical seam for a whitespace-free destination the user typed, pasted,
  // or tapped (the DetectedActionRow) — the exact same pipeline as a scan.
  //
  // `reset: true` is load-bearing. Tapping a specific destination is a fresh,
  // deterministic "pay this now" intent, so it must start a clean generation.
  // Without it the scan pipeline's own guards silently swallow the tap: after a
  // prior scan parks the machine on an interactive step (option chooser / mint
  // selector) that the user dismisses without resolving, `processedRef` stays
  // set and/or `sendLocked` is still held, and `machine.scan(data)` — which runs
  // synchronously, unlike the Paste button's async clipboard read — returns
  // early before dispatching anything (the "tap does nothing" bug). resetInternal
  // clears both guards and stale-aborts any in-flight send; `unit` survives (it's
  // re-derived from getUnit) and the contact target lives in a separate store.
  const runDestinationScan = useCallback(
    (input: string) => {
      paymentLog.info('send.destination.scan', { length: input.length });
      void machine.scan?.(input, { source: 'clipboard', reset: true });
    },
    [machine]
  );

  const handleSubmitDestination = useCallback(() => {
    // A pasted/typed destination is a single token (npub, lnaddr, invoice,
    // token, creq…). Multi-word input is a name search, so only hand
    // whitespace-free input to the parser; names fall through to the results.
    if (!trimmed || /\s/.test(trimmed)) return;
    runDestinationScan(trimmed);
  }, [runDestinationScan, trimmed]);

  // ── Method handlers ──────────────────────────────────────────────────────
  const handleQrScan = useCallback(async () => {
    const granted = await handlePermission();
    if (!granted) return;
    clearPaymentContext('send.scan_qr');
    router.navigate({ pathname: '/camera', params: { to: 'sendToken', unit } });
  }, [handlePermission, unit]);

  const handleCreateEcash = useCallback(() => {
    paymentLog.info('send.method.create_ecash');
    // Drop any contact target left over from an abandoned contact tap so this
    // recipient-less bearer token is never DM'd to a stale npub on completion.
    useContactSendStore.getState().clear();
    // No reset: we're mid-flow on selectDestination and want to keep `unit`.
    // Routes to amount entry with no recipient — a bearer hand-off token.
    // entrySource lets the amount screen show a single "Create ecash" action
    // instead of the generic Next + Paste + Scan chrome.
    void machine.startSendEcash({ entrySource: 'createEcash' });
  }, [machine]);

  const nfcSupported = useNfcSupported();
  const nfcArmed = useNfcTapStore((s) => s.armed);
  const handleNfc = useCallback(() => {
    paymentLog.info('send.method.nfc', { armed: nfcArmed });
    if (Platform.OS === 'android' && nfcArmed) {
      showActionSheet('nfc-tap', {});
      return;
    }
    clearPaymentContext('send.nfc');
    void machine.scan?.(undefined, { source: 'nfc' });
  }, [machine, nfcArmed]);

  const handleNutDrop = useCallback(() => {
    paymentLog.info('send.method.nut_drop');
    clearPaymentContext('send.near_pay');
    router.push('/(send-flow)/nearPay');
  }, []);

  // ── Person taps ──────────────────────────────────────────────────────────
  // One remote-contact send seam shared by searched contacts and quick-pay
  // rows: mark the contact-delivery context (so a bearer ecash send completes
  // by DMing the token to this npub — see contactSendStore) and route to amount
  // entry, seeding `meltTarget` when they advertise a lud16 (Lightning option).
  const startContactSend = useCallback(
    (target: {
      pubkey: string;
      displayName: string | null;
      picture: string | null;
      nip05: string | null;
      lud16: string | null;
    }) => {
      const { pubkey, displayName, picture, nip05, lud16 } = target;
      useContactSendStore.getState().start({
        pubkey,
        ...(displayName ? { displayName } : {}),
        avatarUrl: picture,
        nip05,
        ...(lud16 ? { lud16 } : {}),
      });
      void machine.startSendEcash({
        recipientPubkey: pubkey,
        recipientProfile: { displayName: displayName ?? '', avatarUrl: picture, nip05 },
        ...(lud16 ? { meltTarget: lud16 } : {}),
      });
    },
    [machine]
  );

  const handleSelectContact = useCallback(
    (pubkey: string, profile: NostrSearchResult) => {
      const displayName = resultDisplayName(profile);
      paymentLog.info('send.contact.select', { hasLud16: !!profile.lud16 });
      startContactSend({
        pubkey,
        displayName: displayName || null,
        picture: profile.picture ?? null,
        nip05: profile.nip05 ?? null,
        lud16: profile.lud16 ?? null,
      });
    },
    [startContactSend]
  );

  // A recents row → the same payment seam. QuickPayPerson already carries a real
  // name + the fields the seam needs (source-tagged and profile-hydrated in-hook).
  const handleSelectQuickPay = useCallback(
    (person: QuickPayPerson) => {
      paymentLog.info('send.recent.select', { source: person.source, hasLud16: !!person.lud16 });
      startContactSend({
        pubkey: person.pubkey,
        displayName: person.displayName || null,
        picture: person.picture,
        nip05: person.nip05,
        lud16: person.lud16,
      });
    },
    [startContactSend]
  );

  const handleSelectPeer = useCallback((_peer: BLEPeer) => {
    // v1: hand off to the proven Nut Drop radar rather than reimplement the
    // peer P2PK consent/decision flow here. The peer is surfaced in the unified
    // list; selecting it routes through the radar (which owns the lock logic).
    paymentLog.info('send.peer.select_handoff');
    clearPaymentContext('send.near_pay');
    router.push('/(send-flow)/nearPay');
  }, []);

  const methods: SendMethod[] = useMemo(
    () => [
      {
        id: 'qr',
        title: 'Scan QR',
        subtitle: 'Scan a code to pay',
        caption: 'Scan',
        icon: 'mdi:qrcode-scan',
        systemIcon: 'qrcode.viewfinder',
        onPress: handleQrScan,
      },
      {
        id: 'createEcash',
        title: 'Create ecash',
        subtitle: 'Make a token to send',
        caption: 'Ecash',
        icon: 'mdi:cash-multiple',
        systemIcon: 'banknote',
        onPress: handleCreateEcash,
      },
      ...(nfcSupported
        ? [
            {
              id: 'nfc' as const,
              title: 'Tap to pay',
              subtitle: 'Contactless via NFC',
              caption: 'Tap',
              icon: 'lucide:nfc',
              systemIcon: 'wave.3.right',
              onPress: handleNfc,
            },
          ]
        : []),
      {
        id: 'nutDrop',
        title: 'Nut Drop',
        subtitle: 'Pay a nearby person',
        caption: 'Nut Drop',
        icon: 'mdi:bluetooth',
        systemIcon: 'dot.radiowaves.left.and.right',
        onPress: handleNutDrop,
      },
    ],
    [nfcSupported, handleQrScan, handleCreateEcash, handleNfc, handleNutDrop]
  );

  // Anyone already surfaced in the Nearby tier is dropped from the live People
  // results so they don't appear twice (recents already exclude them in-hook).
  const pinnedPubkeys = useMemo(() => new Set(livePeerPubkeys), [livePeerPubkeys]);
  // Live search rows: keep placeholder rows (they paint the loading skeletons)
  // but drop real rows already pinned in Nearby.
  const renderedPeople = useMemo(
    () => contactRows.filter((r) => !(r.profile && pinnedPubkeys.has(r.pubkey))),
    [contactRows, pinnedPubkeys]
  );

  const containerHeightStyle = useAnimatedStyle(() => ({
    height: interpolate(progress.value, [0, 1], [methods.length * LISTROW_H, COLLAPSED_H]),
  }));
  // The opaque expanded layer fades out to reveal the collapsed row beneath —
  // a parent-opacity fade (same technique the wallet headerLeft uses over its
  // glass via the drawer progress). NOTE: these buttons use expo-glass-effect
  // `GlassView` (scroll-safe, unlike the headerLeft's SwiftUI Host glass which
  // pins on scroll) — verify on device that its glass survives this fade.
  const listFadeStyle = useAnimatedStyle(() => ({
    opacity: interpolate(progress.value, [0, 0.85], [1, 0], Extrapolation.CLAMP),
  }));

  // The four method icons, shared by both states + both capability branches.
  // `CircleActionButton` renders glass (with `systemIcon`) on supported devices,
  // flat otherwise — so the icon type is identical across the transition.
  const collapsedButtons = methods.map((m) => (
    <CircleActionButton
      key={m.id}
      icon={m.icon}
      systemIcon={m.systemIcon}
      label={m.caption}
      accessibilityLabel={m.title}
      onPress={m.onPress}
      testID={`send-method-collapsed-${m.id}`}
    />
  ));
  const expandedRows = methods.map((m) => (
    <ListRow
      key={m.id}
      // icon-only, no onPress → non-interactive; the row owns the tap.
      leading={
        <CircleActionButton icon={m.icon} systemIcon={m.systemIcon} accessibilityLabel={m.title} />
      }
      title={m.title}
      subtitle={m.subtitle}
      trailing={<Icon name="mdi:chevron-right" size={24} color={withAlpha(foreground, 0.25)} />}
      onPress={m.onPress}
      testID={`send-method-${m.id}`}
    />
  ));

  return (
    <ScrollView
      style={[styles.screen, { backgroundColor: overlay }]}
      contentContainerStyle={[styles.content, { paddingTop: headerHeight + 8 }]}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="on-drag">
      {/* This screen is a sheet: iOS modal AX hides the root-layout probe, so
          toast evidence (e.g. balance-too-low) must be mirrored in-sheet. */}
      <E2EToastProbe />
      {/* Destination input + Paste/Cancel */}
      <View style={[styles.inputWrap, { backgroundColor: surfaceSecondary }]}>
        <Icon name="mdi:magnify" size={20} color={withAlpha(foreground, 0.5)} />
        <TextInput
          ref={inputRef}
          value={query}
          onChangeText={setQuery}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onSubmitEditing={handleSubmitDestination}
          placeholder="Name, address, or token"
          placeholderTextColor={withAlpha(foreground, 0.4)}
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="go"
          style={[styles.input, { color: foreground }]}
          testID="send-destination-input"
        />
        {/* Paste when the input is empty (the primary way to enter a
            destination); once there's something to clear, it becomes Cancel to
            wipe the input + unfocus in one tap. */}
        {query.length > 0 ? (
          <Text
            onPress={handleCancel}
            color={accent}
            bold
            size={15}
            style={styles.pasteBtn}
            testID="send-cancel">
            Cancel
          </Text>
        ) : (
          <Text
            onPress={handlePaste}
            color={accent}
            bold
            size={15}
            style={styles.pasteBtn}
            testID="send-paste">
            Paste
          </Text>
        )}
      </View>

      {/* Methods: four rows (expanded) ⇄ four icon buttons in one row (collapsed),
          cross-fading as the input gains focus. Both states use the SAME
          `CircleActionButton` (glass on supported devices, flat otherwise), so
          the icon never changes type across the fade. */}
      <Animated.View style={[styles.methodsContainer, containerHeightStyle]}>
        {/* Collapsed button row UNDERNEATH — revealed as the layer above fades.
            Mounted while focused AND through the fade-back on unfocus, so the
            cross-fade is symmetric in both directions. */}
        {showCollapsed ? (
          <View style={[styles.layerFill, styles.collapsedRow]}>{collapsedButtons}</View>
        ) : null}

        {/* Opaque expanded layer ON TOP — fades its opacity out to reveal the
            collapsed row beneath (same parent-opacity fade the wallet headerLeft
            uses over its glass). */}
        <Animated.View
          style={[styles.layerFill, { backgroundColor: overlay }, listFadeStyle]}
          pointerEvents={inSearch ? 'none' : 'auto'}>
          {expandedRows}
        </Animated.View>
      </Animated.View>

      {/* Detected destination: colada parses the input and tells us what to
          render (Pay 100 sats / Redeem X sats / Pay <name> + pfp). Sits above
          Recent; tap reuses machine.scan (same as the Paste button/input submit)
          or startContactSend — no new routing. */}
      {destinationDescriptor ? (
        <DetectedActionRow
          descriptor={destinationDescriptor}
          onExecute={() => {
            paymentLog.info('send.detected.execute', { kind: destinationDescriptor.kind });
            runDestinationScan(destinationDescriptor.raw);
          }}
          onStartContactSend={startContactSend}
        />
      ) : null}

      {/* Nearby: live Nut Drop peers, pinned above. Shown whenever peers are in
          range — at rest, focused, or searching. */}
      {freshPeers.length > 0 ? (
        <VStack gap={0}>
          <SectionLabel text="Nearby" color={withAlpha(foreground, 0.5)} />
          {freshPeers.map((peer) => (
            <ListRow
              key={peer.peerID}
              avatar={{ seed: peerIdentitySeed(peer), name: peerDisplayName(peer), size: ROW_ICON }}
              title={peerDisplayName(peer)}
              subtitle="Nearby · Nut Drop"
              trailing={<Icon name="mdi:bluetooth" size={20} color={accent} />}
              onPress={() => handleSelectPeer(peer)}
              testID={`send-peer-${peer.peerID}`}
            />
          ))}
        </VStack>
      ) : null}

      {/* People slot (canonical ContactRow + nostrIdentity, metrics parity):
          - typing a specific query → live search results at the top;
          - otherwise (at rest OR focused-empty) → the recent-people list
            (searched / sent / received / Nut Drop peers). */}
      {isTyping ? (
        <VStack gap={0}>
          {renderedPeople.length > 0 ? (
            <SectionLabel text="People" color={withAlpha(foreground, 0.5)} />
          ) : null}
          {renderedPeople.map((row) => (
            <ContactRow
              key={row.pubkey}
              identity={nostrIdentity(row.pubkey, row.profile, {
                isLoadingProfile: row.isLoadingProfile,
              })}
              // Placeholder rows (no profile) paint skeletons and aren't tappable.
              onPress={
                row.profile ? () => handleSelectContact(row.pubkey, row.profile!) : undefined
              }
              testID={`send-contact:${row.pubkey}`}
            />
          ))}
          {!searchLoading && renderedPeople.length === 0 && freshPeers.length === 0 ? (
            <View style={styles.emptyWrap}>
              <Text color={withAlpha(foreground, 0.5)}>No people found</Text>
            </View>
          ) : null}
        </VStack>
      ) : quickPayPeople.length > 0 ? (
        <VStack gap={0}>
          <SectionLabel text="Recent" color={withAlpha(foreground, 0.5)} />
          {quickPayPeople.map((person) => (
            <ContactRow
              key={person.pubkey}
              identity={nostrIdentity(
                person.pubkey,
                {
                  displayName: person.displayName,
                  picture: person.picture ?? undefined,
                  nip05: person.nip05 ?? undefined,
                  lud16: person.lud16 ?? undefined,
                },
                { isLoadingProfile: person.isLoading }
              )}
              onPress={() => handleSelectQuickPay(person)}
              testID={`send-contact:${person.pubkey}`}
            />
          ))}
        </VStack>
      ) : null}
    </ScrollView>
  );
}

function SectionLabel({ text, color }: { text: string; color: string }) {
  return (
    <View style={styles.sectionLabel}>
      <Text size={13} bold color={color}>
        {text.toUpperCase()}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  content: {
    paddingBottom: 32,
  },
  inputWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginHorizontal: 16,
    marginBottom: 6,
    paddingHorizontal: 12,
    height: 44,
    borderRadius: 14,
  },
  input: {
    flex: 1,
    fontSize: 16,
    paddingVertical: 0,
  },
  methodsContainer: {
    overflow: 'hidden',
    marginBottom: 4,
  },
  layerFill: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
  },
  collapsedRow: {
    flexDirection: 'row',
    // space-between + the ListRow's own 20px inset pins the FIRST icon (QR) to
    // exactly where the expanded ListRow icon sits, so it doesn't shift when the
    // rows fade to the collapsed row. No extra side spacing (unlike space-around).
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    // Match the ListRow's 12px vertical padding so the icon's vertical centre
    // (paddingTop + 26) lands at the same y as the expanded row icon — no shift.
    paddingTop: 12,
    paddingHorizontal: 20,
  },
  pasteBtn: {
    paddingHorizontal: 4,
    paddingVertical: 6,
  },
  sectionLabel: {
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 4,
  },
  emptyWrap: {
    paddingHorizontal: 20,
    paddingVertical: 24,
    alignItems: 'center',
  },
});
