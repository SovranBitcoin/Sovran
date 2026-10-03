import { useBLEPeerDirectory } from '@/features/bitchat/hooks/useBLEPeers';
import { z } from 'zod';
import { Amount, decodePaymentRequest, PaymentRequestTransportType } from '@cashu/cashu-ts';
import { type Manager, getEncodedToken, operationHistoryId } from '@cashu/coco-core';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js';
import {
  addBLEDeliveryStatusListener,
  sendBLEPrivateMessage,
  type BitchatBLEIdentityMaterial,
} from 'bitchat-module';
import type { DefaultOperationsConfig } from 'wallet/operations';
import { classifyMeshToken, normalizeMintUrl } from 'wallet';
import { createSecureVault } from '@/shared/lib/persist/secureVault';
import { bitchatLog } from '@/shared/lib/logger';
import { getBitchatProfileScope } from '@/features/bitchat/lib/profileScope';
import { useNearPaySessionStore } from '@/shared/stores/runtime/nearPayStore';
import { CocoManager } from '@/shared/lib/cashu/manager';
import {
  sendDirectMessageToRelays,
  PreparedDirectMessageSchema,
} from '@/shared/lib/nostr/sendDirectMessage';
import { requireOfflineTokenDleq } from '@/shared/lib/cashu/offlineReceiveDleq';
import { setTransactionAnnotation } from '@/shared/stores/profile/transactionAnnotationStore';
import { readProfileRecord } from '@/shared/lib/nostr/useEntityCache';
import { useWalletLifecycleStore } from '@/shared/stores/global/walletLifecycleStore';
import { isPayableNearbyPeer } from './nearbyCapability';

export const NEARBY_PAYMENT_PREFIX = 'sovran:payment:1:';
const JOURNAL_KEY = 'nearby-payment-journal';
const wireProof = z.object({
  id: z.string().min(1).max(128),
  secret: z.string().min(1).max(4096),
  C: z.string().regex(/^[0-9a-fA-F]{66}$/),
  amount: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  witness: z.string().max(4096).optional(),
  dleq: z.object({ e: z.string(), s: z.string(), r: z.string() }).optional(),
});
const wirePayload = z.object({
  id: z.string().min(1).max(256),
  mint: z.string().url().max(2048),
  unit: z.literal('sat'),
  proofs: z.array(wireProof).min(1).max(256),
});
const deliverySchema = z.object({
  peerID: z.string(),
  pubkey: z.string(),
  creq: z.string(),
  sessionID: z.string(),
  payload: z.string().optional(),
  nostrEnvelope: PreparedDirectMessageSchema.optional(),
  bleAccepted: z.boolean().default(false),
  nostrAccepted: z.boolean().default(false),
  nextAttemptAt: z.number().default(0),
});
const journalSchema = z.object({
  version: z.literal(1),
  outbound: z.record(z.string(), deliverySchema),
  inbound: z.record(
    z.string(),
    z.object({
      payload: z.string(),
      senderPubkey: z.string().optional(),
      rejected: z.boolean().default(false),
    })
  ),
});
type Journal = z.infer<typeof journalSchema>;
type Delivery = z.infer<typeof deliverySchema>;
const services = new WeakMap<Manager, NearbyPayments>();

/** A profile-bound delivery journal. Coco remains the owner of funds and settlement. */
class NearbyPayments {
  private readonly storage;
  private writes: Promise<void> = Promise.resolve();
  private receiving: Promise<void> | null = null;
  private delivering: Promise<void> | null = null;
  private lastRecoveryAt = 0;
  constructor(
    private readonly manager: Manager,
    private readonly owner: string
  ) {
    this.storage = createSecureVault(owner, JOURNAL_KEY);
  }
  private isCurrent() {
    return (
      getBitchatProfileScope() === this.owner &&
      CocoManager.isInitialized() &&
      CocoManager.getInstance() === this.manager
    );
  }
  private async read(): Promise<Journal> {
    const raw = await this.storage.read();
    // A corrupt journal is an error, never permission to erase live delivery intent.
    return raw ? journalSchema.parse(JSON.parse(raw)) : { version: 1, outbound: {}, inbound: {} };
  }
  private update(change: (journal: Journal) => void): Promise<void> {
    const task = this.writes
      .catch(() => undefined)
      .then(async () => {
        const journal = await this.read();
        change(journal);
        await this.storage.write(JSON.stringify(journal));
      });
    this.writes = task;
    return task;
  }
  bind(operationId: string, delivery: Delivery) {
    if (!this.isCurrent()) return Promise.reject(new Error('Wallet profile changed'));
    return this.update((journal) => {
      journal.outbound[operationId] = delivery;
    });
  }
  async ingest(payload: string, recipientPubkey: string, senderPubkey?: string): Promise<void> {
    if (!this.isCurrent() || payload.length > 60_000) return;
    const parsed = wirePayload.parse(JSON.parse(payload));
    const token = getEncodedToken({
      mint: parsed.mint,
      unit: parsed.unit,
      proofs: parsed.proofs.map((proof) => ({ ...proof, amount: Amount.from(proof.amount) })),
    });
    if (classifyMeshToken(token, `02${recipientPubkey}`).classification !== 'locked-to-me')
      throw new Error('Nearby payment is not locked to this wallet');
    const requests = await this.manager.paymentRequests.incoming.list();
    if (
      !requests.some(
        (request) =>
          request.requestId === parsed.id &&
          request.mints?.some((mint) => normalizeMintUrl(mint) === normalizeMintUrl(parsed.mint))
      )
    )
      throw new Error('Unknown nearby payment request or mint');
    if (!(await this.manager.mint.isTrustedMint(parsed.mint)))
      throw new Error('Nearby payment mint is not trusted');
    // Reject fabricated proofs before they can consume the durable inbox. This
    // is local admission, not settlement; no wallet receive is executed here.
    await requireOfflineTokenDleq(this.manager, token, parsed.mint);
    if (!this.isCurrent()) return;
    const id = bytesToHex(sha256(utf8ToBytes(payload)));
    await this.update((journal) => {
      if (journal.inbound[id]) return;
      if (Object.keys(journal.inbound).length >= 100) throw new Error('Nearby inbox is full');
      journal.inbound[id] = { payload, senderPubkey, rejected: false };
    });
  }
  drain(
    privateKey: Uint8Array,
    identity: BitchatBLEIdentityMaterial,
    nickname: string
  ): Promise<void> {
    // A stalled mint may hold receive recovery, but must not hold delivery of
    // already-created payments. Each direction owns its own single-flight guard.
    const receiving = (this.receiving ??= this.receive(identity).finally(() => {
      this.receiving = null;
    }));
    const delivering = (this.delivering ??= this.deliver(privateKey, nickname).finally(() => {
      this.delivering = null;
    }));
    return Promise.all([receiving, delivering]).then(() => undefined);
  }
  private async receive(identity: BitchatBLEIdentityMaterial): Promise<void> {
    // The failing caller receives its error; a later pass must still reconcile
    // the last durable generation after storage becomes available again.
    await this.writes.catch(() => undefined);
    if (!this.isCurrent()) return;
    const journal = await this.read();
    const restore = useWalletLifecycleStore.getState().restoreStatus;
    if (restore === 'complete' || restore === 'not-needed') {
      if (Object.keys(journal.inbound).length > 0 && Date.now() - this.lastRecoveryAt > 30_000) {
        this.lastRecoveryAt = Date.now();
        await this.manager.recoverPendingPaymentRequestReceiveAttempts();
      }
      for (const [id, incoming] of Object.entries(journal.inbound)) {
        if (!this.isCurrent()) return;
        if (incoming.rejected) continue;
        try {
          // Offline radio input must pass the same local DLEQ and trust gates
          // as legacy tokens before Coco may contact a mint.
          const raw: unknown = JSON.parse(incoming.payload);
          const parsed = wirePayload.parse(raw);
          if (!(await this.manager.mint.isTrustedMint(parsed.mint)) || !this.isCurrent()) continue;
          // Coco parses the integer-safe NUT-18 payload. DLEQ is verified on its
          // token representation before ingestion, not a second wallet.receive.
          const token = getEncodedToken({
            mint: parsed.mint,
            unit: parsed.unit,
            proofs: parsed.proofs.map((proof) => ({ ...proof, amount: Amount.from(proof.amount) })),
          });
          const classification = classifyMeshToken(token, `02${identity.nostrPubkey}`);
          if (classification.classification !== 'locked-to-me')
            throw new Error('Nearby payment is not locked to this wallet');
          await requireOfflineTokenDleq(this.manager, token, parsed.mint);
          if (!this.isCurrent()) return;
          const result = await this.manager.paymentRequests.incoming.ingestPayload(
            incoming.payload,
            {
              transport: 'inband',
              transportMessageId: `ble:${id}`,
              senderPubkey: incoming.senderPubkey,
            }
          );
          if (!this.isCurrent()) return;
          if (result.attempt.state === 'finalized') {
            const receiveId = result.attempt.receiveOperationId;
            if (!receiveId) throw new Error('Finalized nearby payment has no receive operation');
            const senderPubkey = result.attempt.senderPubkey ?? incoming.senderPubkey;
            const avatarUrl = senderPubkey ? readProfileRecord(senderPubkey)?.picture : undefined;
            // A Nostr claim may have won the race. Preserve the actual winning
            // transport, while linking identity and lock to the same receive.
            setTransactionAnnotation(`id:${operationHistoryId('receive', receiveId)}`, {
              lock: { type: 'p2pk', direction: 'incoming' },
              ...(result.attempt.transport === 'inband' &&
              result.attempt.transportMessageId?.startsWith('ble:')
                ? { scan: { method: 'ble' } }
                : {}),
              ...(senderPubkey
                ? {
                    counterparty: {
                      pubkey: senderPubkey,
                      direction: 'sender',
                      ...(avatarUrl ? { avatarUrl } : {}),
                    },
                  }
                : {}),
            });
            await this.update((state) => {
              delete state.inbound[id];
            });
          } else if (result.attempt.state === 'rejected') {
            // Coco drops rejected payloads. Retain our encrypted recovery copy;
            // terminal rejection must not become an automatic second receive.
            await this.update((state) => {
              if (state.inbound[id]) state.inbound[id].rejected = true;
            });
            bitchatLog.warn('bitchat.payment.rejected', { attemptId: result.attempt.id });
          }
        } catch {
          // Includes a concurrent Nostr claim. The persisted payload stays for
          // the next drain; Coco's request+payload dedupe owns the receive.
        }
      }
    }
  }
  private async deliver(privateKey: Uint8Array, nickname: string): Promise<void> {
    await this.writes.catch(() => undefined);
    if (!this.isCurrent()) return;
    const journal = await this.read();
    for (const [operationId, delivery] of Object.entries(journal.outbound)) {
      if (!this.isCurrent()) return;
      try {
        const operation = await this.manager.ops.send.get(operationId);
        if (!operation || operation.state === 'finalized' || operation.state === 'rolled_back') {
          await this.update((state) => {
            delete state.outbound[operationId];
          });
          continue;
        }
        if (
          operation.state !== 'pending' ||
          !operation.token ||
          delivery.nextAttemptAt > Date.now()
        )
          continue;
        const request = decodePaymentRequest(delivery.creq);
        const token = operation.token;
        const payload =
          delivery.payload ??
          JSON.stringify({
            id: request.id,
            mint:
              request.mints?.find(
                (mint) => normalizeMintUrl(mint) === normalizeMintUrl(token.mint)
              ) ?? token.mint,
            unit: token.unit ?? 'sat',
            ...(token.memo ? { memo: token.memo } : {}),
            proofs: token.proofs.map((proof) => ({ ...proof, amount: proof.amount.toNumber() })),
          });
        // Exact bytes persisted once and replayed on both transports and recovery.
        await this.update((state) => {
          const value = state.outbound[operationId];
          if (value) {
            value.payload = payload;
            value.nextAttemptAt = Date.now() + 30_000;
          }
        });
        if (!this.isCurrent()) return;
        const nostr = request.transport?.find(
          (transport) => transport.type === PaymentRequestTransportType.NOSTR
        );
        let envelope = delivery.nostrEnvelope;
        if (nostr && !delivery.nostrAccepted && !envelope) {
          try {
            envelope = await sendDirectMessageToRelays.prepare({
              senderPrivateKey: privateKey,
              nprofile: nostr.target,
              message: payload,
            });
            const preparedEnvelope = envelope;
            await this.update((state) => {
              const value = state.outbound[operationId];
              if (value) value.nostrEnvelope = preparedEnvelope;
            });
          } catch {
            envelope = undefined;
          }
        }
        if (!this.isCurrent()) return;
        const results = await Promise.allSettled([
          sendWithBluetoothAck(
            delivery.peerID,
            NEARBY_PAYMENT_PREFIX + payload,
            nickname,
            `pay-${operationId}-${Date.now()}`
          ),
          delivery.nostrAccepted
            ? Promise.resolve()
            : envelope
              ? sendDirectMessageToRelays.publish(envelope)
              : Promise.reject(new Error('No Nostr transport')),
        ]);
        await this.update((state) => {
          const value = state.outbound[operationId];
          if (value) {
            value.bleAccepted ||= results[0].status === 'fulfilled';
            value.nostrAccepted ||= results[1].status === 'fulfilled';
          }
        });
        // ACK / relay acceptance is delivery progress, never payment settlement.
        if (
          this.isCurrent() &&
          results.some((result) => result.status === 'fulfilled') &&
          useNearPaySessionStore.getState().active?.id === delivery.sessionID
        )
          useNearPaySessionStore.getState().complete();
      } catch (error) {
        // One corrupt/missing operation must not starve independent deliveries.
        bitchatLog.warn('bitchat.payment.delivery_deferred', {
          error: error instanceof Error ? error.name : 'unknown',
        });
      }
    }
  }
}

function sendWithBluetoothAck(
  peerID: string,
  content: string,
  nickname: string,
  messageID: string
): Promise<void> {
  return new Promise((resolve, reject) => {
    const finish = (error?: Error) => {
      clearTimeout(timer);
      sub.remove();
      if (error) reject(error);
      else resolve();
    };
    const sub = addBLEDeliveryStatusListener((event) => {
      if (event.messageID !== messageID) return;
      if (event.status === 'delivered' || event.status === 'read') finish();
      else if (event.status === 'failed') finish(new Error('Bluetooth delivery failed'));
    });
    const timer = setTimeout(
      () => finish(new Error('Bluetooth acknowledgement timed out')),
      12_000
    );
    void sendBLEPrivateMessage(peerID, content, nickname, messageID).catch((error) =>
      finish(error instanceof Error ? error : new Error('Bluetooth delivery failed'))
    );
  });
}

export function nearbyPayments(manager: Manager): NearbyPayments {
  let service = services.get(manager);
  if (!service) {
    const owner = getBitchatProfileScope();
    if (!owner) throw new Error('Wallet profile unavailable');
    service = new NearbyPayments(manager, owner);
    services.set(manager, service);
  }
  return service;
}
export const captureNearbyDelivery: NonNullable<DefaultOperationsConfig['captureSendDelivery']> = ({
  manager,
  mintUrl,
  lockPubkey,
}) => {
  const active = useNearPaySessionStore.getState().active;
  if (!active) return;
  const recipient = active.recipient;
  const livePeer = useBLEPeerDirectory
    .getState()
    .peers.find((peer) => peer.peerID === recipient.peerID);
  if (
    !livePeer ||
    !isPayableNearbyPeer(livePeer) ||
    livePeer.creq !== recipient.creq ||
    livePeer.nostrPubkeyHex !== recipient.nostrPubkeyHex ||
    !recipient.creq ||
    !recipient.nostrPubkeyHex ||
    lockPubkey !== `02${recipient.nostrPubkeyHex}`
  )
    throw new Error('Nearby recipient must be verified and locked');
  const request = decodePaymentRequest(recipient.creq);
  if (
    !request.id ||
    !request.mints?.some((mint) => normalizeMintUrl(mint) === normalizeMintUrl(mintUrl))
  )
    throw new Error('Nearby mint no longer accepted');
  const service = nearbyPayments(manager);
  const delivery: Delivery = {
    peerID: recipient.peerID,
    pubkey: recipient.nostrPubkeyHex,
    creq: recipient.creq,
    sessionID: active.id,
    bleAccepted: false,
    nostrAccepted: false,
    nextAttemptAt: 0,
  };
  return (operationId) => service.bind(operationId, delivery);
};
