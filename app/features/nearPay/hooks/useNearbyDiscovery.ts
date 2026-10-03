import { CocoManager } from '@/shared/lib/cashu/manager';
import { NEARBY_PAYMENT_PREFIX, nearbyPayments } from '../lib/nearbyPayments';
import { useEffect, useMemo, useRef } from 'react';
import { AppState } from 'react-native';
import { useBalanceContext, useMints } from '@cashu/coco-react';
import { isTestnutUnit } from 'wallet';
import { useStandingPaymentRequest } from 'wallet/react';
import {
  startBLE,
  stopBLE,
  getBLEPeers,
  addBLEStateListener,
  addBLEPeerListener,
  addBLEPrivateMessageListener,
  startBLEPrivateChat,
  sendBLEPrivateMessage,
  isPublicBLEMesh,
  type BLEPeer,
} from 'bitchat-module';
import { useBitchatNickname } from '@/features/bitchat/hooks/useBitchatNickname';
import { useBitchatBLEIdentityMaterial } from '@/features/bitchat/hooks/useBitchatBLEIdentityMaterial';
import {
  getBitchatProfileScope,
  useBitchatProfileScope,
} from '@/features/bitchat/lib/profileScope';
import { useBLEPeerDirectory } from '@/features/bitchat/hooks/useBLEPeers';
import {
  areBLEPeerSnapshotsEquivalent,
  filterFreshBLEPeers,
} from '@/features/bitchat/lib/blePeerSnapshots';
import { useNostrKeysContext } from '@/shared/providers/NostrKeysProvider';
import { useNostrProfileMetadataMany } from '@/shared/hooks/useNostrProfileMetadata';
import { cashuP2pkPubkeyFromNostrHex } from '@/shared/lib/protocolIds';
import { amountToNumber } from '@/shared/lib/cashu/amount';
import { rankAdvertisedMints } from '@/shared/lib/nutCreq';
import { useIsTestnutMint } from '@/shared/stores/global/mintTestnutStore';
import { useMintStore } from '@/shared/stores/profile/mintStore';
import { standingQuoteIdentityStore } from '@/features/receive/lib/standingQuoteIdentityStore';
import { bitchatLog } from '@/shared/lib/logger';
import {
  CAPABILITY_PREFIX,
  createNearbyCapability,
  nearbyNoiseIdentity,
  verifyNearbyCapability,
  type VerifiedNearbyCapability,
} from '../lib/nearbyCapability';

/** One warm directory for the account, independent of Send and NutDrop screens. */
export function useNearbyDiscovery(): void {
  const nickname = useBitchatNickname();
  const profileScope = useBitchatProfileScope();
  const identityMaterial = useBitchatBLEIdentityMaterial();
  const { keys } = useNostrKeysContext();
  const { trustedMints } = useMints();
  const { balances } = useBalanceContext();
  const preferredMint = useMintStore((state) => state.selectedMint);
  const isTestnutMint = useIsTestnutMint();
  const testnutAccount = useMintStore((state) => isTestnutUnit(state.activeUnit));
  const mintUrlsKey = useMemo(() => {
    const mints = trustedMints
      .map((m) => m.mintUrl)
      .filter((mintUrl) => isTestnutMint(mintUrl) === testnutAccount);
    const fundedMints = new Set(
      mints.filter((mintUrl) => {
        const sats = balances.byMintAndUnit?.[mintUrl]?.sat;
        return !!sats && amountToNumber(sats.total) > 0;
      })
    );
    return rankAdvertisedMints({ mints, fundedMints, preferredMint }).join(',');
  }, [trustedMints, balances, preferredMint, isTestnutMint, testnutAccount]);

  const identityStore = useMemo(
    () => ({
      ...standingQuoteIdentityStore,
      get: (key: string) => {
        if (getBitchatProfileScope() !== profileScope) throw new Error('Wallet profile changed');
        return standingQuoteIdentityStore.get(key);
      },
      set: (key: string, id: string) => {
        if (getBitchatProfileScope() !== profileScope) throw new Error('Wallet profile changed');
        standingQuoteIdentityStore.set(key, id);
      },
    }),
    [profileScope]
  );
  const { request } = useStandingPaymentRequest(
    identityMaterial && mintUrlsKey
      ? {
          purpose: 'nearby',
          unit: 'sat',
          mints: mintUrlsKey.split(',').slice(0, 5),
          displayMints: mintUrlsKey.split(',').slice(0, 5),
          lockP2pkPubkey: cashuP2pkPubkeyFromNostrHex(identityMaterial.nostrPubkey),
        }
      : null,
    identityStore
  );
  // Withdraw synchronously when the trusted mint set changes; do not advertise
  // an old request during asynchronous regeneration.
  const currentMints = mintUrlsKey.split(',').slice(0, 5);
  const creq =
    request && mintUrlsKey && request.mints.every((mint) => currentMints.includes(mint))
      ? request.encodedRequest
      : null;
  const capabilityInput = useRef({ keys, creq });
  useEffect(() => {
    capabilityInput.current = { keys, creq };
  }, [keys, creq]);
  const peers = useBLEPeerDirectory((state) => state.peers);
  const pubkeys = useMemo(
    () => peers.flatMap((peer) => (peer.nostrPubkeyHex ? [peer.nostrPubkeyHex] : [])).slice(0, 32),
    [peers]
  );
  useNostrProfileMetadataMany(pubkeys);

  useEffect(() => {
    if (!keys || !identityMaterial || !CocoManager.isInitialized()) return;
    const manager = CocoManager.getInstance();
    const payments = nearbyPayments(manager);
    let disposed = false;
    const pump = () => {
      if (!disposed)
        void payments.drain(keys.privateKey, identityMaterial, nickname).catch((error: unknown) =>
          bitchatLog.warn('bitchat.payment.retry', {
            error: error instanceof Error ? error.name : 'unknown',
          })
        );
    };
    const messages = addBLEPrivateMessageListener((event) => {
      if (disposed || event.isOwn || !event.content.startsWith(NEARBY_PAYMENT_PREFIX)) return;
      const peer = useBLEPeerDirectory
        .getState()
        .peers.find((candidate) => candidate.peerID === event.peerID);
      void payments
        .ingest(
          event.content.slice(NEARBY_PAYMENT_PREFIX.length),
          identityMaterial.nostrPubkey,
          peer?.nostrPubkeyHex
        )
        .then(pump)
        .catch(() => undefined);
    });
    const foreground = AppState.addEventListener('change', (state) => {
      if (state === 'active') pump();
    });
    const interval = setInterval(pump, 5_000);
    pump();
    return () => {
      disposed = true;
      messages.remove();
      foreground.remove();
      clearInterval(interval);
    };
  }, [keys, identityMaterial, nickname]);

  useEffect(() => {
    if (!identityMaterial || !profileScope) return;
    let disposed = false;
    const capabilities = new Map<string, VerifiedNearbyCapability>();
    const sent = new Map<string, { at: number; creq: string | null; fingerprint: string }>();
    const handshakes = new Map<string, number>();
    let peerCursor = 0;
    const ourPeerID = nearbyNoiseIdentity(identityMaterial.noisePrivateKeyHex).peerID;
    const current = () => !disposed && getBitchatProfileScope() === profileScope;
    const report = (error: unknown) =>
      bitchatLog.debug('bitchat.discovery.retry', {
        error: error instanceof Error ? error.name : 'unknown',
      });
    const refresh = () => {
      if (!current()) return;
      const now = Date.now();
      const raw = filterFreshBLEPeers(getBLEPeers(), now);
      const next: BLEPeer[] = raw.map((peer) => {
        const cap = capabilities.get(peer.peerID);
        const valid =
          cap && cap.expiresAt > now && cap.fingerprint === peer.authenticatedNoiseFingerprint;
        // Native favorites and announces are self-assertions, not payment identity.
        return {
          ...peer,
          nostrPubkeyHex: valid ? cap.nostrPubkeyHex : undefined,
          creq: valid ? (cap.creq ?? undefined) : undefined,
          walletCapabilityExpiresAt: valid ? cap.expiresAt : undefined,
        };
      });
      if (!areBLEPeerSnapshotsEquivalent(useBLEPeerDirectory.getState().peers, next))
        useBLEPeerDirectory.setState({ peers: next });
      let handshakeBudget = 2;
      // Bound each tick without permanently starving peers beyond the first page.
      const page = [...raw.slice(peerCursor), ...raw.slice(0, peerCursor)].slice(0, 16);
      peerCursor = raw.length ? (peerCursor + page.length) % raw.length : 0;
      for (const peer of page) {
        // Unknown stock clients must never receive wallet control messages.
        if (isPublicBLEMesh() && !capabilities.has(peer.peerID)) continue;
        const fingerprint = peer.authenticatedNoiseFingerprint;
        if (!fingerprint) {
          if (
            ourPeerID < peer.peerID &&
            handshakeBudget > 0 &&
            now - (handshakes.get(peer.peerID) ?? 0) > 15_000
          ) {
            handshakes.set(peer.peerID, now);
            handshakeBudget--;
            void startBLEPrivateChat(peer.peerID).catch(report);
          }
          continue;
        }
        const input = capabilityInput.current;
        if (!input.keys) continue;
        const previous = sent.get(peer.peerID);
        if (
          previous &&
          previous.fingerprint === fingerprint &&
          previous.creq === input.creq &&
          now - previous.at < 30_000
        )
          continue;
        const message = createNearbyCapability(
          input.keys.privateKey,
          identityMaterial.noisePrivateKeyHex,
          input.creq,
          now
        );
        sent.set(peer.peerID, { at: now, creq: input.creq, fingerprint });
        void sendBLEPrivateMessage(peer.peerID, message, nickname, `cap-${ourPeerID}-${now}`).catch(
          (error) => {
            sent.delete(peer.peerID);
            report(error);
          }
        );
      }
      // Bound hostile discovery churn as well as work per tick.
      for (const [id, cap] of capabilities)
        if (cap.expiresAt + 120_000 < now) capabilities.delete(id);
      for (const [id, at] of handshakes) if (now - at > 120_000) handshakes.delete(id);
      for (const [id, value] of sent) if (now - value.at > 120_000) sent.delete(id);
    };
    const messages = addBLEPrivateMessageListener((event) => {
      if (!current() || event.isOwn || !event.content.startsWith(CAPABILITY_PREFIX)) return;
      const peer = getBLEPeers().find((candidate) => candidate.peerID === event.peerID);
      const cap = verifyNearbyCapability(event.content, peer?.authenticatedNoiseFingerprint);
      if (
        !cap ||
        (capabilities.get(event.peerID)?.issuedAt ?? 0) > cap.issuedAt ||
        (capabilities.size >= 64 && !capabilities.has(event.peerID))
      )
        return;
      capabilities.set(event.peerID, cap);
      refresh();
    });
    const start = () => {
      if (!current() || AppState.currentState !== 'active') return;
      void startBLE(nickname || 'sovran', profileScope, identityMaterial, null)
        .then(refresh)
        .catch(report);
    };
    const state = addBLEStateListener((event) => {
      if (event.state === 'poweredOn') start();
    });
    const foreground = AppState.addEventListener('change', (state) => {
      if (state === 'active') start();
    });
    const updates = addBLEPeerListener(refresh);
    const interval = setInterval(refresh, 3_000);
    start();
    return () => {
      disposed = true;
      messages.remove();
      updates.remove();
      state.remove();
      foreground.remove();
      clearInterval(interval);
      useBLEPeerDirectory.setState({ peers: [] });
      void stopBLE().catch(report);
    };
  }, [identityMaterial, nickname, profileScope]);
}
