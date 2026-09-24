/**
 * Everything the amount screen needs to offer a lock: who we would lock to,
 * whether we may, and which of our own keys could take it back.
 *
 * Both lookups are best-effort and neither blocks the send. A recipient who
 * has published no kind:10019 still gets an offer (with a warning), and a
 * wallet with no keyring key still gets the permanent lock.
 */

import { useManager } from '@cashu/coco-react';
import { resolvePrimaryReceiveP2PKPublicKey } from '@sovranbitcoin/coco-cashu-plugin-p2pk-import';
import { useEffect, useMemo, useState } from 'react';

import { deriveSendLockGate, type SendLockGate } from '@/features/send/lib/sendLockGate';
import type { MintNuts } from '@/shared/lib/cashu/mintNuts';
import { paymentLog } from '@/shared/lib/logger';
import type { NutzapProfile } from '@/shared/lib/nostr/nip61NutzapProfile';
import { resolveNutzapProfile } from '@/shared/lib/nostr/nutzapProfileDiscovery';
import { CASHU_P2PK_PUBKEY_RE, type CashuP2pkPubkey } from '@/shared/lib/protocolIds';

interface SendLockTarget {
  gate: SendLockGate;
  /** Our own P2PK key, the one a reclaim would have to sign with. */
  refundKey: CashuP2pkPubkey | null;
  /** True while the kind:10019 lookup is still out. */
  loading: boolean;
}

export function useSendLockTarget(params: {
  recipientPubkey?: string;
  selectedMintUrl?: string;
  selectedMintNuts?: MintNuts;
}): SendLockTarget {
  const { recipientPubkey, selectedMintUrl, selectedMintNuts } = params;
  const manager = useManager();
  const [resolved, setResolved] = useState<{
    recipient: string;
    profile: NutzapProfile | null;
  } | null>(null);
  const [refund, setRefund] = useState<{
    owner: typeof manager;
    key: CashuP2pkPubkey | null;
  } | null>(null);
  const profile = resolved && resolved.recipient === recipientPubkey ? resolved.profile : null;
  const loading = !!recipientPubkey && resolved?.recipient !== recipientPubkey;
  const refundKey = refund && refund.owner === manager ? refund.key : null;

  useEffect(() => {
    if (!recipientPubkey) return;
    let cancelled = false;
    void resolveNutzapProfile(recipientPubkey)
      .then((value) => {
        if (cancelled) return;
        setResolved({ recipient: recipientPubkey, profile: value });
      })
      .catch(() => {
        if (!cancelled) setResolved({ recipient: recipientPubkey, profile: null });
      });
    return () => {
      cancelled = true;
    };
  }, [recipientPubkey]);

  useEffect(() => {
    if (!manager) return;
    let cancelled = false;
    void resolvePrimaryReceiveP2PKPublicKey(manager)
      .then((key) => {
        if (cancelled) return;
        // Guard the shape here rather than at use: a reclaim signed with
        // something that is not a compressed key fails at the mint, long after
        // the user was promised they could take the money back.
        setRefund({
          owner: manager,
          key:
            key && CASHU_P2PK_PUBKEY_RE.test(key) ? (key.toLowerCase() as CashuP2pkPubkey) : null,
        });
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        paymentLog.warn('send.lock.refundKeyUnavailable', {
          error: error instanceof Error ? error.message : String(error),
        });
        setRefund({ owner: manager, key: null });
      });
    return () => {
      cancelled = true;
    };
  }, [manager]);

  const gate = useMemo(
    () =>
      deriveSendLockGate({
        ...(recipientPubkey ? { recipientPubkey } : {}),
        nutzapProfile: profile,
        nutzapLoading: loading,
        ...(selectedMintUrl ? { selectedMintUrl } : {}),
        ...(selectedMintNuts ? { selectedMintNuts } : {}),
      }),
    [recipientPubkey, profile, loading, selectedMintUrl, selectedMintNuts]
  );

  return { gate, refundKey, loading };
}
