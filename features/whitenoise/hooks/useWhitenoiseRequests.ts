import { useCallback, useEffect, useState } from 'react';
import { router } from 'expo-router';
import { bytesToHex } from '@noble/hashes/utils.js';
import type { UnreadInvite } from '@internet-privacy/marmot-ts';
import { useWhitenoise } from '../WhitenoiseProvider';
import { WhitenoiseDmIndex } from '../storage/dmIndex';
import { log } from '@/shared/lib/logger';

const wnLog = log.child({ module: 'whitenoise' });

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

export type UseWhitenoiseRequestsState = {
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

    async function refresh() {
      try {
        const unread = await inviteReader!.getUnread();
        if (cancelled) return;
        const mapped = unread.map(toRequest);
        mapped.sort((a, b) => b.createdAt - a.createdAt);
        setRequests(mapped);
      } catch (err) {
        wnLog.warn('whitenoise.requests.refresh_failed', {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

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

  const accept = useCallback(
    async (request: WhitenoiseRequest) => {
      if (!client || !inviteReader) {
        setError('White Noise client not ready');
        return;
      }
      setBusyId(request.id);
      setError(null);
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
        setError(message);
        wnLog.error('whitenoise.requests.accept_failed', { error: message });
      } finally {
        setBusyId(null);
      }
    },
    [accountIndex, client, inviteReader]
  );

  const decline = useCallback(
    async (request: WhitenoiseRequest) => {
      if (!inviteReader) return;
      setBusyId(request.id);
      setError(null);
      try {
        await inviteReader.markAsRead(request.id);
        wnLog.info('whitenoise.requests.declined', {
          inviteId: request.id.slice(0, 8),
          from: request.fromPubkey.slice(0, 16),
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        setError(message);
        wnLog.error('whitenoise.requests.decline_failed', { error: message });
      } finally {
        setBusyId(null);
      }
    },
    [inviteReader]
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
