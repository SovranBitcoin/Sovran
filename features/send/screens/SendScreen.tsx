/**
 * @fileoverview Send screen — the destination-first front door for sending.
 *
 * Reached from the wallet Send button (`machine.startSend()` → the Colada
 * `selectDestination` step → this route). Instead of jumping straight to amount
 * entry, the user picks HOW to pay:
 *
 *   • a destination input (top) that accepts any payment string (lightning
 *     address, bolt11, cashu token, NUT-18 creq, on-chain, npub) via Paste /
 *     keyboard-submit — routed through Colada's parser (`machine.scan`/
 *     `machine.execute`), never a new app-side parser;
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

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Platform, ScrollView, StyleSheet, TextInput } from 'react-native';
import { useHeaderHeight } from 'expo-router/react-navigation';
import { usePaymentFlowMachine } from '@sovranbitcoin/colada/react';
import { describeDestination, defaultDetectors, parsePaymentInput } from '@sovranbitcoin/colada';
import type { BLEPeer } from 'bitchat-module';
import Animated, {
  Easing,
  Extrapolation,
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import opacity from 'hex-color-opacity';

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
import { useContactSearch, type DisplayResult } from '@/features/payments/hooks/useContactSearch';
import {
  useQuickPayPeople,
  type QuickPayPerson,
  type QuickPaySource,
} from '@/features/send/hooks/useQuickPayPeople';
import { clearPaymentContext } from '@/shared/stores/runtime/clearPaymentContext';
import { useContactSendStore } from '@/shared/stores/runtime/contactSendStore';
import { normalizeRecentPersonPubkey } from '@/shared/stores/profile/recentPeopleStore';
import { useNfcSupported } from '@/shared/lib/nfc';
import { useNfcTapStore } from '@/shared/stores/runtime/nfcTapStore';
import { showActionSheet } from '@/shared/lib/popup';
import { guardedRouter as router } from '@/shared/hooks/useGuardedRouter';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { paymentLog } from '@/shared/lib/logger';
import { ListRow } from '@/shared/ui/composed/ListRow';
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

// Quick-pay row subtitle, by the most recent interaction with the person.
const SOURCE_SUBTITLE: Record<QuickPaySource, string> = {
  sent: 'Sent',
  received: 'Received',
  peer: 'Nut Drop',
  search: 'Searched',
};

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

function resultDisplayName(profile: NonNullable<DisplayResult['profile']>): string {
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

  // ── Quick-pay tier (people we've paid / been paid by / stood near) ────────
  // Live peers already show in the "Nearby" tier, so exclude them here.
  const livePeerPubkeys = useMemo(
    () =>
      freshPeers
        .map((p) => normalizeRecentPersonPubkey(peerNostrPubkey(p)))
        .filter((key): key is string => !!key),
    [freshPeers]
  );
  const quickPayPeople = useQuickPayPeople(livePeerPubkeys);

  // ── Contact search (nagg / primal facade) ────────────────────────────────
  const { displayResults, searchLoading, showNoResults } = useContactSearch(query);
  const trimmed = query.trim();
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
  const handlePaste = useCallback(() => {
    paymentLog.info('send.destination.paste');
    void machine.scan?.();
  }, [machine]);

  const handleSubmitDestination = useCallback(() => {
    // A pasted/typed destination is a single token (npub, lnaddr, invoice,
    // token, creq…). Multi-word input is a name search, so only hand
    // whitespace-free input to the parser; names fall through to the results.
    if (!trimmed || /\s/.test(trimmed)) return;
    paymentLog.info('send.destination.execute', { length: trimmed.length });
    void machine.execute(trimmed);
  }, [machine, trimmed]);

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
    void machine.startSendEcash({});
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
    (result: Extract<DisplayResult, { profile: object }>) => {
      const { pubkey, profile } = result;
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

  const handleSelectQuickPay = useCallback(
    (person: QuickPayPerson) => {
      paymentLog.info('send.recent.select', { source: person.source, hasLud16: !!person.lud16 });
      startContactSend(person);
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

  // Anyone already surfaced in the Nearby or Recent tiers is dropped from the
  // name-search results so they don't appear twice.
  const pinnedPubkeys = useMemo(() => {
    const set = new Set(livePeerPubkeys);
    for (const person of quickPayPeople) set.add(person.pubkey);
    return set;
  }, [livePeerPubkeys, quickPayPeople]);
  const realResults = useMemo(
    () =>
      displayResults.filter(
        (r): r is Extract<DisplayResult, { profile: object }> =>
          !!r.profile && !pinnedPubkeys.has(r.pubkey)
      ),
    [displayResults, pinnedPubkeys]
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
      trailing={<Icon name="mdi:chevron-right" size={24} color={opacity(foreground, 0.25)} />}
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
      {/* Destination input + Paste */}
      <View style={[styles.inputWrap, { backgroundColor: surfaceSecondary }]}>
        <Icon name="mdi:magnify" size={20} color={opacity(foreground, 0.5)} />
        <TextInput
          value={query}
          onChangeText={setQuery}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onSubmitEditing={handleSubmitDestination}
          placeholder="Address, invoice, token, or name"
          placeholderTextColor={opacity(foreground, 0.4)}
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="go"
          style={[styles.input, { color: foreground }]}
          testID="send-destination-input"
        />
        <Text
          onPress={handlePaste}
          color={accent}
          bold
          size={15}
          style={styles.pasteBtn}
          testID="send-paste">
          Paste
        </Text>
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
          Recent; tap reuses machine.execute or startContactSend — no new
          routing. */}
      {destinationDescriptor ? (
        <DetectedActionRow
          descriptor={destinationDescriptor}
          onExecute={() => {
            paymentLog.info('send.detected.execute', { kind: destinationDescriptor.kind });
            void machine.execute(destinationDescriptor.raw);
          }}
          onStartContactSend={startContactSend}
        />
      ) : null}

      {/* Quick-pay: recent people we've paid, been paid by, or stood near.
          Shown both at rest (under the methods) and while searching. */}
      {quickPayPeople.length > 0 ? (
        <VStack spacing={0}>
          <SectionLabel text="Recent" color={opacity(foreground, 0.5)} />
          {quickPayPeople.map((person) => (
            <ListRow
              key={person.pubkey}
              avatar={{
                picture: person.picture ?? undefined,
                seed: person.pubkey,
                name: person.displayName,
                size: ROW_ICON,
              }}
              title={person.displayName}
              subtitle={SOURCE_SUBTITLE[person.source] || undefined}
              onPress={() => handleSelectQuickPay(person)}
              testID={`send-recent-${person.pubkey.slice(0, 8)}`}
            />
          ))}
        </VStack>
      ) : null}

      {inSearch ? (
        <VStack spacing={0}>
          {/* Nearby peers stay pinned above search results. */}
          {freshPeers.length > 0 ? (
            <SectionLabel text="Nearby" color={opacity(foreground, 0.5)} />
          ) : null}
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
          {realResults.length > 0 ? (
            <SectionLabel text="People" color={opacity(foreground, 0.5)} />
          ) : null}
          {realResults.map((result) => {
            const name = resultDisplayName(result.profile);
            return (
              <ListRow
                key={result.pubkey}
                avatar={{
                  picture: result.profile.picture,
                  seed: result.pubkey,
                  name,
                  size: ROW_ICON,
                }}
                title={name || 'Unknown'}
                subtitle={result.profile.lud16 ?? result.profile.nip05 ?? undefined}
                loading={searchLoading && realResults.length === 0}
                onPress={() => handleSelectContact(result)}
                testID={`send-contact-${result.pubkey.slice(0, 8)}`}
              />
            );
          })}
          {showNoResults && freshPeers.length === 0 ? (
            <View style={styles.emptyWrap}>
              <Text color={opacity(foreground, 0.5)}>No people found</Text>
            </View>
          ) : null}
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
    position: 'relative',
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
