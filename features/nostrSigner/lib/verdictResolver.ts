/**
 * @fileoverview Verdict resolution — the post-prompt arm of the engine
 *
 * Maps a user decision (approve once / session / always / deny / always-deny /
 * block) onto grant writes, session state, wire responses, and activity rows.
 * Extracted from the engine so the policy-dense grant-minting logic has one
 * home; the engine passes a narrow seam (context handover, transport respond,
 * activity logging, approved execution) and keeps pipeline/lifecycle concerns.
 *
 * Semantics preserved exactly (pinned by nip46Engine.test.ts):
 * - The connection snapshot is taken BEFORE block flips the store, so the
 *   prompted request still gets its final "Not authorized" while everything
 *   the app queued after it flushes silently.
 * - 'always' on a peer≠self decrypt mints a peer-scoped persistent grant
 *   (the blanket decrypt key is critical and unrepresentable as 'always');
 *   non-decrypt 'always' grants the request's whole bundle.
 * - 'approve_session' mirrors those shapes in runtime-only session state;
 *   self-decrypt falls back to approve-once (store guard is the backstop).
 * - Block revokes all session state so a later unblock starts clean.
 */

import { errAsync, ResultAsync } from 'neverthrow';

import type { Nip46ActivitySummaryV2 } from '@/features/nostrSigner/data/nip46ActivityStore';
import { useNip46ConnectionsStore } from '@/features/nostrSigner/data/nip46ConnectionsStore';
import { useNip46RequestsStore } from '@/features/nostrSigner/data/nip46RequestsStore';
import type {
  Nip46Encryption,
  Nip46TransportError,
} from '@/features/nostrSigner/lib/nip46Transport';
import {
  NIP46_ERRORS,
  type ActivityVerdict,
  type DecryptMethod,
  type GrantKey,
  type Nip46Method,
  type RpcRequest,
  type RpcResponse,
} from '@/features/nostrSigner/lib/nip46Types';
import { bundleForGrantKey } from '@/features/nostrSigner/lib/permissionBundles';
import { nostrLog, redactError } from '@/shared/lib/logger';

/**
 * 'approve_session' grants for the SESSION (until engine stop/app restart):
 * peer≠self decrypts get a peer-scoped session grant; everything else gets a
 * session allow over the request's whole bundle — wallet sign kinds included
 * (runtime-only, so the persisted critical ceiling is untouched).
 */
export type Nip46DecisionAction =
  | 'approve_once'
  | 'approve_session'
  | 'always'
  | 'deny_once'
  | 'always_deny'
  | 'block';

export interface Nip46RequestDecision {
  action: Nip46DecisionAction;
}

/** Everything needed to execute/respond when the user (or sweep) resolves an ask. */
export interface PendingRequestContext {
  request: RpcRequest;
  clientPubkey: string;
  kind?: number;
  grantKey: GrantKey | null;
  isSelfDecrypt: boolean;
  encryption: Nip46Encryption;
  /** Pre-truncated content snippet — present only for normal-class sign_event. */
  summary?: string;
  /** Structured summary computed at request time, for the activity row. */
  summaryV2?: Nip46ActivitySummaryV2;
}

type VerdictResolveError = { type: 'unknown-request' };

/** The engine surface the resolver drives — narrow on purpose. */
export interface VerdictResolverSeam {
  /** Returns AND forgets the pipeline context for a pending request id. */
  takeContext(requestId: string): PendingRequestContext | undefined;
  /** Drops a sibling request's context (block flushes the app's whole queue). */
  deleteContext(requestId: string): void;
  /** Stops the expiry sweep when the pending queue just emptied. */
  stopSweepIfIdle(): void;
  respond(
    toPubkey: string,
    response: RpcResponse,
    encryption: Nip46Encryption
  ): ResultAsync<void, Nip46TransportError>;
  logActivity(input: {
    clientPubkey: string;
    method: Nip46Method;
    kind?: number;
    verdict: ActivityVerdict;
    summary?: string;
    summaryV2?: Nip46ActivitySummaryV2;
  }): void;
  /** Runs the approved request through the engine's executor + responder. */
  executeApproved(context: PendingRequestContext, encryption: Nip46Encryption): Promise<void>;
}

const connections = () => useNip46ConnectionsStore.getState();
const requests = () => useNip46RequestsStore.getState();

export function resolveVerdict(
  seam: VerdictResolverSeam,
  requestId: string,
  decision: Nip46RequestDecision
): ResultAsync<void, VerdictResolveError> {
  const context = seam.takeContext(requestId);
  if (!context) return errAsync({ type: 'unknown-request' });
  requests().remove(requestId);
  seam.stopSweepIfIdle();

  const { clientPubkey, request } = context;
  const connection = connections().apps[clientPubkey] ?? null;
  const encryption = connection?.encryption ?? context.encryption;

  const finish = (work: Promise<void>): ResultAsync<void, VerdictResolveError> =>
    ResultAsync.fromPromise(work, (error): VerdictResolveError => {
      nostrLog.error('nostr.signer.engine_resolve_failed', { error: redactError(error) });
      return { type: 'unknown-request' };
    });

  const denyOnce = (): Promise<void> => {
    // Respond only while the snapshot taken at resolve time is an active
    // pairing: a vanished record is unpaired and a since-blocked one is the
    // silent tier. The 'block' action relies on the snapshot semantics —
    // `connection` was read BEFORE blockApp() flipped the store, so the
    // prompted request still gets its documented final "Not authorized"
    // while everything the app sends afterwards is silent.
    if (connection !== null && connection.status === 'active') {
      void seam.respond(
        clientPubkey,
        { id: request.id, error: NIP46_ERRORS.notAuthorized },
        encryption
      );
    }
    seam.logActivity({
      clientPubkey,
      method: request.method,
      ...(context.kind !== undefined && { kind: context.kind }),
      verdict: 'denied_once',
      ...(context.summaryV2 !== undefined && { summaryV2: context.summaryV2 }),
    });
    connections().touchUsage(clientPubkey, { denied: true });
    return Promise.resolve();
  };

  switch (decision.action) {
    case 'deny_once':
      return finish(denyOnce());

    case 'always_deny': {
      if (context.grantKey !== null) {
        const written = connections().setGrant(clientPubkey, context.grantKey, 'deny');
        if (written.isErr()) {
          nostrLog.warn('nostr.signer.engine_grant_write_failed', { cause: written.error });
        }
      }
      return finish(denyOnce());
    }

    case 'block': {
      connections().blockApp(clientPubkey);
      // Session state must not survive a later unblock.
      requests().revokeSessionGrant(clientPubkey);
      requests().revokeSessionAllows(clientPubkey);
      // The prompted request gets a final answer; everything else the app
      // queued is flushed silently (blocked tier = activity rows only).
      for (const other of requests().pending.filter((p) => p.clientPubkey === clientPubkey)) {
        seam.deleteContext(other.id);
        requests().remove(other.id);
        seam.logActivity({
          clientPubkey,
          method: other.method,
          ...(other.kind !== undefined && { kind: other.kind }),
          verdict: 'auto_denied_blocked',
        });
      }
      seam.stopSweepIfIdle();
      return finish(denyOnce());
    }

    case 'approve_once':
    case 'approve_session':
    case 'always': {
      // A connection that vanished or got blocked mid-prompt must not sign.
      if (connection === null) {
        // Disconnected mid-prompt: the pubkey is unpaired now, so no wire
        // response (the client times out, exactly as if the signer left).
        nostrLog.debug('nostr.signer.engine_resolve_disconnected_drop');
        return finish(Promise.resolve());
      }
      if (connection.status === 'blocked') {
        // Blocked tier: silent activity row, no response.
        seam.logActivity({
          clientPubkey,
          method: request.method,
          ...(context.kind !== undefined && { kind: context.kind }),
          verdict: 'auto_denied_blocked',
        });
        return finish(Promise.resolve());
      }
      if (decision.action === 'always') {
        const isDecrypt = request.method === 'nip04_decrypt' || request.method === 'nip44_decrypt';
        if (isDecrypt && !context.isSelfDecrypt) {
          // Peer-scoped persistent grant (the blanket decrypt grant key is
          // critical and unrepresentable as 'always').
          const peerPubkey = request.params[0]?.toLowerCase();
          if (peerPubkey !== undefined) {
            const written = connections().setPeerDecryptGrant(
              clientPubkey,
              peerPubkey,
              request.method as DecryptMethod,
              { peerIsSelf: false }
            );
            if (written.isErr()) {
              nostrLog.warn('nostr.signer.engine_peer_grant_rejected', { cause: written.error });
            }
          }
        } else if (!isDecrypt && context.grantKey !== null) {
          // Always grants the whole human concept — every key in the
          // request's bundle ("send private messages" covers encrypt AND
          // DM-sign). Bundles exclude critical keys by construction, and
          // each setGrant independently re-enforces the ceiling anyway.
          const grantKeys = bundleForGrantKey(context.grantKey)?.grantKeys ?? [context.grantKey];
          for (const grantKey of grantKeys) {
            const written = connections().setGrant(clientPubkey, grantKey, 'always');
            if (written.isErr()) {
              nostrLog.warn('nostr.signer.engine_grant_write_failed', {
                grantKey,
                cause: written.error,
              });
            }
          }
        }
      }
      if (decision.action === 'approve_session') {
        const isDecrypt = request.method === 'nip04_decrypt' || request.method === 'nip44_decrypt';
        if (isDecrypt && context.isSelfDecrypt) {
          // Unreachable from the sheet (self-decrypt offers Approve only);
          // the store's peerIsSelf guard is the hard backstop. Fall through
          // to approve-once semantics.
          nostrLog.warn('nostr.signer.engine_session_self_decrypt_fallback');
        } else if (isDecrypt) {
          // Peer-scoped session: covers this conversation until the engine
          // stops. The decrypt peer is params[0] (classification-time read).
          const peerPubkey = request.params[0]?.toLowerCase();
          if (peerPubkey !== undefined) {
            const granted = requests().grantSession(
              clientPubkey,
              request.method as DecryptMethod,
              peerPubkey,
              { peerIsSelf: false }
            );
            if (granted.isErr()) {
              nostrLog.warn('nostr.signer.engine_session_grant_rejected', {
                cause: granted.error,
              });
            }
          }
        } else if (context.grantKey !== null) {
          // Session mirrors Always's bundle semantics; wallet keys are
          // unbundled singletons and ARE session-allowable (runtime-only).
          const grantKeys = bundleForGrantKey(context.grantKey)?.grantKeys ?? [context.grantKey];
          for (const grantKey of grantKeys) {
            const granted = requests().grantSessionAllow(clientPubkey, grantKey);
            if (granted.isErr()) {
              nostrLog.warn('nostr.signer.engine_session_allow_rejected', {
                grantKey,
                cause: granted.error,
              });
            }
          }
        }
      }
      return finish(seam.executeApproved(context, encryption));
    }
  }
}
