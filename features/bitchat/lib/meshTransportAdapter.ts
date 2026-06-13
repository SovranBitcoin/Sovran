import {
  NUT_PAYLOAD_TYPE,
  addNutPayloadListener,
  decodePayment,
  decodeSolicit,
  decodeStatus,
  encodePayment,
  encodeRequest,
  encodeStatus,
  getBLEPeers,
  nutSendPayload,
  nutSolicit,
  solicitIdHex,
  startBLEPrivateChat,
} from 'bitchat-module';
import type {
  MeshInboundEvent,
  MeshPaymentStatus,
  MeshRejectReason,
  MeshTransportAdapter,
} from '@sovranbitcoin/colada';

import { paymentLog } from '@/shared/lib/logger';

/**
 * Colada's `MeshTransportAdapter` over the bitchat BLE bridge. The adapter
 * owns the byte boundary: colada speaks decoded semantic events
 * (solicit / payment / status), the bridge speaks vendor Noise payloads
 * (0xA0–0xA3). All policy — send planning, request issuance, validation,
 * redeem orchestration — lives in colada.
 *
 * `broadcastBearerToken` is injected because the public-broadcast path needs
 * the profile identity + nickname, which live with the caller.
 */
export function createBitchatMeshTransportAdapter(deps: {
  broadcastBearerToken: (encodedToken: string) => Promise<void>;
}): MeshTransportAdapter {
  return {
    getPeerCapabilities(peerId) {
      const peer = getBLEPeers().find((p) => p.peerID === peerId);
      if (!peer) {
        paymentLog.warn('near_pay.mesh.adapter.peer_unknown', { peerID: peerId });
        return null;
      }
      paymentLog.info('near_pay.mesh.adapter.capabilities', {
        peerID: peerId,
        supportsNutRequests: peer.supportsNutRequests,
        autoRedeem: peer.autoRedeem,
        hasDirectLink: peer.hasDirectLink,
        isConnected: peer.isConnected,
      });
      return {
        supportsNutRequests: peer.supportsNutRequests,
        autoRedeem: peer.autoRedeem,
      };
    },

    async solicitPaymentRequest(peerId, opts) {
      const startedAt = performance.now();
      paymentLog.info('near_pay.mesh.adapter.solicit_start', {
        peerID: peerId,
        senderOffline: opts.senderOffline,
      });
      try {
        // Establish the Noise session before the first vendor payload —
        // Android's raw send has no pending-handshake queue, and a dropped
        // solicit would otherwise eat one of the two attempts.
        await startBLEPrivateChat(peerId);
        paymentLog.debug('near_pay.mesh.adapter.session_ready', {
          peerID: peerId,
          duration_ms: Math.round(performance.now() - startedAt),
        });
        const creq = await nutSolicit(peerId, { senderOffline: opts.senderOffline });
        paymentLog.info('near_pay.mesh.adapter.solicit_ok', {
          peerID: peerId,
          creqLength: creq.length,
          duration_ms: Math.round(performance.now() - startedAt),
        });
        return creq;
      } catch (err) {
        paymentLog.warn('near_pay.mesh.adapter.solicit_failed', {
          peerID: peerId,
          error: err instanceof Error ? err.message : String(err),
          duration_ms: Math.round(performance.now() - startedAt),
        });
        throw err;
      }
    },

    async respondToSolicit(peerId, solicitId, creq) {
      const solicitIdBytes = hexToBytes(solicitId);
      if (!solicitIdBytes) throw new Error('Invalid solicit id');
      paymentLog.info('near_pay.mesh.adapter.respond_to_solicit', {
        peerID: peerId,
        solicitId,
        creqLength: creq.length,
      });
      await nutSendPayload(peerId, encodeRequest({ solicitId: solicitIdBytes, creq }));
    },

    async deliverPayment(peerId, payloadJson) {
      const startedAt = performance.now();
      paymentLog.info('near_pay.mesh.adapter.deliver_payment_start', {
        peerID: peerId,
        payloadBytes: payloadJson.length,
      });
      try {
        await startBLEPrivateChat(peerId);
        await nutSendPayload(peerId, encodePayment(payloadJson));
        paymentLog.info('near_pay.mesh.adapter.deliver_payment_ok', {
          peerID: peerId,
          duration_ms: Math.round(performance.now() - startedAt),
        });
      } catch (err) {
        paymentLog.warn('near_pay.mesh.adapter.deliver_payment_failed', {
          peerID: peerId,
          error: err instanceof Error ? err.message : String(err),
          duration_ms: Math.round(performance.now() - startedAt),
        });
        throw err;
      }
    },

    async sendPaymentStatus(peerId, paymentId, status, reason) {
      paymentLog.info('near_pay.mesh.adapter.send_status', {
        peerID: peerId,
        paymentId,
        status,
        reason,
      });
      await nutSendPayload(
        peerId,
        encodeStatus({
          status,
          reason: reason && reason !== 'unknown' ? reason : 'none',
          paymentId,
        })
      );
    },

    broadcastBearerToken: deps.broadcastBearerToken,

    onInbound(listener) {
      const subscription = addNutPayloadListener((event) => {
        const decoded = decodeInbound(event.peerID, event.payload);
        if (!decoded) {
          // 0xA1 responses are consumed by nutSolicit's correlation inside
          // the bridge wrapper — expected here, not a drop.
          if (event.payload[0] !== NUT_PAYLOAD_TYPE.request) {
            paymentLog.warn('near_pay.mesh.adapter.inbound_dropped', {
              peerID: event.peerID,
              type: event.payload[0],
              bytes: event.payload.length,
            });
          }
          return;
        }
        paymentLog.info('near_pay.mesh.adapter.inbound', {
          peerID: event.peerID,
          kind: decoded.kind,
          ...(decoded.kind === 'solicit' ? { senderOffline: decoded.senderOffline } : {}),
          ...(decoded.kind === 'status'
            ? { status: decoded.status, paymentId: decoded.paymentId }
            : {}),
          ...(decoded.kind === 'payment' ? { payloadBytes: decoded.payloadJson.length } : {}),
        });
        listener(decoded);
      });
      return () => subscription.remove();
    },
  };
}

function decodeInbound(peerId: string, payload: Uint8Array): MeshInboundEvent | null {
  switch (payload[0]) {
    case NUT_PAYLOAD_TYPE.solicit: {
      const solicit = decodeSolicit(payload);
      if (!solicit) return null;
      return {
        kind: 'solicit',
        peerId,
        solicitId: solicitIdHex(solicit.solicitId),
        senderOffline: solicit.senderOffline,
      };
    }
    case NUT_PAYLOAD_TYPE.payment: {
      const payloadJson = decodePayment(payload);
      if (payloadJson === null) return null;
      return { kind: 'payment', peerId, payloadJson };
    }
    case NUT_PAYLOAD_TYPE.status: {
      const status = decodeStatus(payload);
      if (!status) return null;
      return {
        kind: 'status',
        peerId,
        status: status.status as MeshPaymentStatus,
        reason: status.reason === 'none' ? 'none' : (status.reason as MeshRejectReason),
        paymentId: status.paymentId,
      };
    }
    // 0xA1 responses are consumed by nutSolicit's correlation inside the
    // bridge wrapper; anything else in the range is a future payload type.
    case NUT_PAYLOAD_TYPE.request:
      return null;
    default:
      paymentLog.debug('near_pay.mesh.unknown_payload_type', { type: payload[0] });
      return null;
  }
}

function hexToBytes(hex: string): Uint8Array | null {
  if (!/^[0-9a-f]+$/i.test(hex) || hex.length % 2 !== 0) return null;
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}
