import { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import type { Token } from '@cashu/cashu-ts';
import { useManager } from 'coco-cashu-react';

export type SendProofState = 'pending' | 'spent' | 'unknown';

/**
 * Hook to track the proof state of a send transaction.
 *
 * When a send is created, the proofs are marked as 'inflight'.
 * When the recipient claims the tokens, the proofs become 'spent'.
 *
 * This hook listens to the `proofs:state-changed` event from coco
 * to track when proofs transition to 'spent', indicating the send is complete.
 *
 * The ProofStateWatcherService in coco automatically watches inflight proofs
 * and emits events when they're spent by the recipient.
 */
export function useSendProofState(token: Token | null) {
  const manager = useManager();
  const [state, setState] = useState<SendProofState>('pending');
  const [isChecking, setIsChecking] = useState(false);
  const mountedRef = useRef(true);

  // Memoize secrets to avoid unnecessary re-renders
  const secrets = useMemo(() => token?.proofs.map((p) => p.secret) ?? [], [token]);
  const secretSet = useMemo(() => new Set(secrets), [secrets]);
  const mintUrl = token?.mint;

  // Check if our proofs are in the changed secrets
  const hasOurProofs = useCallback(
    (changedSecrets: string[]) => {
      return changedSecrets.some((s) => secretSet.has(s));
    },
    [secretSet]
  );

  // Listen for proof state changes - this is the primary update mechanism
  useEffect(() => {
    if (!token || secrets.length === 0 || !mintUrl) {
      return;
    }

    const handleProofStateChange = ({
      mintUrl: eventMintUrl,
      secrets: changedSecrets,
      state: newState,
    }: {
      mintUrl: string;
      secrets: string[];
      state: string;
    }) => {
      // Check if this event is for our mint
      if (eventMintUrl !== mintUrl) return;

      // Check if any of the changed secrets belong to our token
      if (!hasOurProofs(changedSecrets)) return;

      console.log('[useSendProofState] Proof state changed:', { newState, changedSecrets });

      // Update state based on the new proof state
      if (newState === 'spent' && mountedRef.current) {
        setState('spent');
      }
    };

    const unsubscribe = manager.on('proofs:state-changed', handleProofStateChange);

    return () => {
      unsubscribe();
    };
  }, [token, secrets, mintUrl, hasOurProofs, manager]);

  // Cleanup on unmount
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // Manual refresh - tries to receive the token to check if it's already spent
  // If receiving fails with "already spent" error, the proofs are spent
  const refresh = useCallback(async () => {
    if (!token || secrets.length === 0) {
      setState('unknown');
      return;
    }

    setIsChecking(true);
    try {
      // Try to receive the token - if it fails, proofs are likely spent
      // This is a workaround since we can't directly query proof state
      // Note: This will actually claim the token if it's not spent!
      // So we only use this for the check, not in production
      // For production, we rely on the proofs:state-changed event

      // For now, just keep current state - the event listener will update it
      // The ProofStateWatcherService is responsible for checking with the mint
    } catch (err) {
      console.error('[useSendProofState] Failed to check proof state:', err);
    } finally {
      if (mountedRef.current) {
        setIsChecking(false);
      }
    }
  }, [token, secrets]);

  return {
    state,
    isSpent: state === 'spent',
    isPending: state === 'pending',
    isChecking,
    refresh,
  };
}

