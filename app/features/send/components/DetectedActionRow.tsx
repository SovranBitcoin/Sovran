/**
 * The "detected destination" row shown above Recent on the Send screen. colada's
 * `describeDestination` decides what to display (kind, amount, label, icon,
 * action); this renders it and routes the tap to the existing seams — no app-side
 * parsing or new routing.
 *
 * Protocol kinds (invoice / ecash / payment request / lnurlp / onchain / mint)
 * render an icon-circle row whose colada-resolved label already carries the
 * amount, and tap → `onExecute` (the same canonical `machine.scan` the Paste
 * button and input submit use). Person kinds (npub / lightning address) resolve
 * the Nostr identity (name + pfp) and tap → `onStartContactSend`, mirroring
 * selecting a contact.
 */
import { useEffect, useMemo, useState } from 'react';
import { fetchNip05Pubkey, type DestinationDescriptor, type DestinationIcon } from 'wallet';
import * as nip19 from 'nostr-tools/nip19';

import { useNostrProfileMetadata } from '@/shared/hooks/useNostrProfileMetadata';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { resolveIdentityName } from '@/shared/lib/identity';
import { paymentLog, redactError } from '@/shared/lib/logger';
import { ListRow } from '@/shared/ui/composed/ListRow';

const ROW_ICON = 52;

/**
 * semantic colada icon token → app glyph (all in the Monicon registry).
 * `person` (avatar path) and `unknown` (no row) never actually render.
 */
const ICON: Record<DestinationIcon, string> = {
  lightning: 'mdi:lightning-bolt',
  ecash: 'mdi:cash-multiple',
  paymentRequest: 'mdi:receipt-text-outline',
  onchain: 'mdi:bitcoin',
  person: 'mdi:account-multiple',
  mint: 'mdi:store',
  unknown: 'mdi:help-circle',
};

/** Middle-truncate long identifiers (npub/address) so head + tail survive. */
function truncateMiddle(value: string, head = 10, tail = 6): string {
  if (value.length <= head + tail + 1) return value;
  return `${value.slice(0, head)}…${value.slice(-tail)}`;
}

interface ContactSendTarget {
  pubkey: string;
  displayName: string | null;
  picture: string | null;
  nip05: string | null;
  lud16: string | null;
}

interface DetectedActionRowProps {
  descriptor: DestinationDescriptor;
  /** Route protocol kinds through `machine.scan(raw)` (same as input submit). */
  onExecute: () => void;
  /** Route a resolved payable identity through the existing contact-send seam. */
  onStartContactSend: (target: ContactSendTarget) => void;
}

export function DetectedActionRow({
  descriptor,
  onExecute,
  onStartContactSend,
}: DetectedActionRowProps) {
  const iconColor = useThemeColor('foreground');
  const ref = descriptor.recipient?.ref;
  const isPerson = descriptor.kind === 'person';

  // npub → hex (synchronous). A pubkey-ref (creq P2PK lock) is carried but not
  // hydrated in v1.
  const npubHex = useMemo(() => {
    if (ref?.type !== 'npub') return undefined;
    try {
      const decoded = nip19.decode(ref.value);
      return decoded.type === 'npub' ? (decoded.data as string) : undefined;
    } catch {
      return undefined;
    }
  }, [ref?.type, ref?.value]);

  // lightning address → hex via NIP-05 (async, cancellable; mirrors AmountFlowScreen).
  const [lnaddrHex, setLnaddrHex] = useState<string | null>(null);
  const [nip05Resolving, setNip05Resolving] = useState(false);
  useEffect(() => {
    if (ref?.type !== 'lightningAddress') {
      setLnaddrHex(null);
      setNip05Resolving(false);
      return;
    }
    const controller = new AbortController();
    let cancelled = false;
    setLnaddrHex(null);
    setNip05Resolving(true);
    void (async () => {
      try {
        const pk = await fetchNip05Pubkey(ref.value, { signal: controller.signal });
        if (!cancelled) setLnaddrHex(pk ?? null);
      } catch (e) {
        if (!cancelled) paymentLog.debug('send.detected.nip05.failed', { error: redactError(e) });
      } finally {
        if (!cancelled) setNip05Resolving(false);
      }
    })();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [ref?.type, ref?.value]);

  const personPubkey = npubHex ?? lnaddrHex ?? undefined;
  // Always called (tolerates undefined → no-op for non-person kinds) so hooks
  // stay unconditional.
  const { metadata, isLoading } = useNostrProfileMetadata(personPubkey);

  const resolvedName = metadata
    ? resolveIdentityName({ pubkey: personPubkey ?? '', nostrProfile: metadata })
    : null;

  if (isPerson) {
    const personLoading = !metadata && (nip05Resolving || isLoading);
    const fallback = ref ? truncateMiddle(ref.value) : '';
    const title = `${descriptor.label} ${resolvedName ?? fallback}`.trim();
    // Once the name resolves, surface the pasted identity on the secondary line
    // (mirrors the contact rows). While unresolved the title already shows it.
    const subtitle = resolvedName && ref ? truncateMiddle(ref.value) : undefined;
    return (
      <ListRow
        avatar={{
          picture: metadata?.picture,
          seed: personPubkey ?? ref?.value,
          name: resolvedName ?? undefined,
          size: ROW_ICON,
        }}
        title={title}
        subtitle={subtitle}
        loading={personLoading}
        accessibilityLabel={title}
        testID={`send-detected-${descriptor.kind}`}
        onPress={() => {
          if (personPubkey) {
            paymentLog.info('send.detected.contact', { kind: descriptor.kind });
            onStartContactSend({
              pubkey: personPubkey,
              displayName: resolvedName,
              picture: metadata?.picture ?? null,
              nip05: metadata?.nip05 ?? null,
              lud16: metadata?.lud16 ?? (ref?.type === 'lightningAddress' ? ref.value : null),
            });
          } else {
            // Identity not resolved yet — fall back to the generic route.
            onExecute();
          }
        }}
      />
    );
  }

  return (
    <ListRow
      iconCircle={{ icon: ICON[descriptor.icon], color: iconColor, size: ROW_ICON }}
      title={descriptor.label}
      subtitle={truncateMiddle(descriptor.raw)}
      accessibilityLabel={descriptor.label}
      testID={`send-detected-${descriptor.kind}`}
      onPress={onExecute}
    />
  );
}
