import { useEffect, useState } from 'react';
import { guardedRouter as router } from '@/shared/hooks/useGuardedRouter';
import { bytesToHex } from '@noble/hashes/utils.js';
import type { UnreadInvite } from '@internet-privacy/marmot-ts';
import { useWhitenoise } from '../WhitenoiseContext';
import { WhitenoiseDmIndex } from '../storage/dmIndex';
import { useSingleFlight } from '@/shared/hooks/useSingleFlight';
import { wnLog } from '@/shared/lib/logger';

export type WhitenoiseRequest = {
  /** Rumor ID — stable across the lifetime of the unread entry. */
  id: string;
  /** Inviter's hex pubkey. */
  fromPubkey: string;
  /** Rumor created_at (Unix seconds). */
  createdAt: number;
  /** The unread rumor — kept intact for accept(). */
  rumor: UnreadInvite;
};

type UseWhitenoiseRequestsState = {
  requests: WhitenoiseRequest[];
  isReady: boolean;
  busyId: string | null;
  error: string | null;
  accept: (request: WhitenoiseRequest) => Promise<void>;
  decline: (request: WhitenoiseRequest) => Promise<void>;
};

/**
 * Surfaces marmot-ts's "unread invites" queue as a request list. The
 * InviteReader (mounted in WhitenoiseProvider via useWhitenoiseInbox) does
 * the ingest/decrypt; this hook just reads from it and exposes the user
 * actions.
 */
export function useWhitenoiseRequests(): UseWhitenoiseRequestsState {
  const { client, inviteReader, accountIndex } = useWhitenoise();
  const [requests, setRequests] = useState<WhitenoiseRequest[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!inviteReader) return;
    let cancelled = false;

    const refresh = () => refreshRequestsImpl(inviteReader, () => cancelled, setRequests);

    void refresh();

    const onNew = () => void refresh();
    const onRead = () => void refresh();
    inviteReader.on('newInvite', onNew);
    inviteReader.on('inviteRead', onRead);
    return () => {
      cancelled = true;
      inviteReader.off('newInvite', onNew);
      inviteReader.off('inviteRead', onRead);
    };
  }, [inviteReader]);

  // `busyId` is React state and lands too late to block a rapid second tap.
  // The single-flight guard drops the duplicate before it reaches
  // `joinGroupFromWelcome` (which would consume a second key package and
  // leave the inviteReader in an inconsistent state). The guard lives on
  // useSingleFlight's ref, so it holds regardless of callback identity.
  const accept = useSingleFlight((request: WhitenoiseRequest) =>
    acceptRequestImpl(client, inviteReader, accountIndex, request, { setBusyId, setError })
  );
  const decline = useSingleFlight((request: WhitenoiseRequest) =>
    declineRequestImpl(inviteReader, request, { setBusyId, setError })
  );

  return {
    requests,
    isReady: !!inviteReader,
    busyId,
    error,
    accept,
    decline,
  };
}

function toRequest(rumor: UnreadInvite): WhitenoiseRequest {
  return {
    id: rumor.id,
    fromPubkey: rumor.pubkey,
    createdAt: rumor.created_at,
    rumor,
  };
}

// Bodies live at module scope: they need nothing from render scope beyond the
// setters, and keeping them out of the hook keeps its compiled output lean.
type WhitenoiseClient = ReturnType<typeof useWhitenoise>['client'];
type WhitenoiseInviteReader = ReturnType<typeof useWhitenoise>['inviteReader'];
type WhitenoiseAccountIndex = ReturnType<typeof useWhitenoise>['accountIndex'];

async function refreshRequestsImpl(
  inviteReader: NonNullable<WhitenoiseInviteReader>,
  isCancelled: () => boolean,
  setRequests: (value: WhitenoiseRequest[]) => void
): Promise<void> {
  try {
    const unread = await inviteReader.getUnread();
    if (isCancelled()) return;
    const mapped = unread.map(toRequest);
    mapped.sort((a, b) => b.createdAt - a.createdAt);
    setRequests(mapped);
  } catch (err) {
    wnLog.warn('whitenoise.requests.refresh_failed', {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

async function acceptRequestImpl(
  client: WhitenoiseClient,
  inviteReader: WhitenoiseInviteReader,
  accountIndex: WhitenoiseAccountIndex,
  request: WhitenoiseRequest,
  io: { setBusyId: (value: string | null) => void; setError: (value: string | null) => void }
): Promise<void> {
  if (!client || !inviteReader) {
    io.setError('White Noise client not ready');
    return;
  }
  io.setBusyId(request.id);
  io.setError(null);
  try {
    const { group } = await client.joinGroupFromWelcome({
      welcomeRumor: request.rumor as Parameters<
        typeof client.joinGroupFromWelcome
      >[0]['welcomeRumor'],
    });
    const index = new WhitenoiseDmIndex(accountIndex);
    await index.set(request.fromPubkey, bytesToHex(group.id));
    await inviteReader.markAsRead(request.id);
    wnLog.info('whitenoise.requests.accepted', {
      inviteId: request.id.slice(0, 8),
      groupId: bytesToHex(group.id),
      from: request.fromPubkey.slice(0, 16),
    });
    // Open the new chat so the user lands directly in the conversation
    // instead of staring at an empty Requests pill.
    router.push({
      pathname: '/(user-flow)/whitenoiseDM' as never,
      params: { pubkey: request.fromPubkey },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    io.setError(message);
    wnLog.error('whitenoise.requests.accept_failed', { error: message });
  } finally {
    io.setBusyId(null);
  }
}

async function declineRequestImpl(
  inviteReader: WhitenoiseInviteReader,
  request: WhitenoiseRequest,
  io: { setBusyId: (value: string | null) => void; setError: (value: string | null) => void }
): Promise<void> {
  if (!inviteReader) return;
  io.setBusyId(request.id);
  io.setError(null);
  try {
    await inviteReader.markAsRead(request.id);
    wnLog.info('whitenoise.requests.declined', {
      inviteId: request.id.slice(0, 8),
      from: request.fromPubkey.slice(0, 16),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    io.setError(message);
    wnLog.error('whitenoise.requests.decline_failed', { error: message });
  } finally {
    io.setBusyId(null);
  }
}
