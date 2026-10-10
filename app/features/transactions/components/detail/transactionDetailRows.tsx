import type { AmountValue } from '@/shared/lib/cashu/amount';
import { formatAmount } from '@/shared/lib/currency';
import { CopyableValue } from '@/shared/ui/composed/CopyableValue';
import { MiddleEllipsisValue } from '@/shared/ui/composed/MiddleEllipsisValue';
import type { DetailsSheetItem } from '@/shared/ui/composed/DetailsSheet';
import * as nip19 from 'nostr-tools/nip19';
import { describeSendLock } from 'wallet';

import { spendingConditionDetailItems } from '@/features/send/components/SpendingConditionsCard';
import { transactionIdentitySnapshot } from '@/features/transactions/lib/transactionIdentity';

/**
 * The trailing `DetailsSection` rows every transaction-detail screen builds
 * after `transactionLeadDetailItems` — Amount, State, Quote ID, Mint. Each
 * screen was rebuilding these literals by hand, so the title, display and
 * copy affordance drifted independently across seven screens.
 *
 * Builders that gate on an optional value return `null` for the falsy case —
 * `DetailsSection` drops falsy items — so they inline directly into an item
 * list. Ordering (and the screen-specific rows interleaved between these)
 * stays with each screen.
 */

export function amountDetailItem({ amount, unit }: { amount: AmountValue; unit: string }) {
  return { title: 'Amount', value: formatAmount({ amount, unit }) };
}

export function stateDetailItem(state: string) {
  return { title: 'State', value: state };
}

/**
 * Copyable Quote ID row (Lightning mint/melt screens). The onchain screens
 * deliberately render a plain (non-copyable) Quote ID instead — don't fold them in
 * here without a product decision to make those copyable too.
 */
export function quoteIdDetailItem(quoteId: string | undefined) {
  return quoteId
    ? {
        title: 'Quote ID',
        value: <CopyableValue value={quoteId} copyTarget="quoteId" />,
      }
    : null;
}

export function mintDetailItem(mintUrl: string | null | undefined) {
  return mintUrl
    ? { title: 'Mint', value: <MiddleEllipsisValue value={mintUrl} />, group: 'Mint' as const }
    : null;
}

type Row = DetailsSheetItem;
type Loose = Record<string, unknown>;

const str = (value: unknown): string | null => {
  if (typeof value === 'string') return value.trim() ? value : null;
  if (typeof value === 'number') return String(value);
  return null;
};

const when = (value: unknown): string | null => {
  const datetime = (value as { datetime?: unknown } | null)?.datetime;
  if (typeof datetime === 'string') return datetime;
  const ms = Number(value);
  return Number.isFinite(ms) && ms > 0 ? new Date(ms).toISOString() : null;
};

const rowsOf = (group: Row['group'], pairs: [string, string | null][]): Row[] =>
  pairs.flatMap(([title, value]) => (value === null ? [] : [{ title, value, group }]));

/**
 * Who the payment was with. The key is shown in both of the forms people are
 * asked for (`npub…` and hex), because which one a tool wants is never the
 * one to hand. This used to be a bare npub floating above the QR code.
 */
function peopleDetailItems(entry: Loose): Row[] {
  const identity = transactionIdentitySnapshot(entry as never);
  if (!identity) return [];
  return rowsOf('People', [
    ['Name', str(identity.name)],
    ['Address', str(identity.nip05)],
    ['npub', nip19.npubEncode(identity.pubkey)],
    ['Public key', identity.pubkey],
  ]);
}

interface TokenProof {
  amount?: unknown;
  id?: unknown;
  secret?: unknown;
  dleq?: unknown;
  witness?: unknown;
}

/** The proofs a token carries, in either token layout cashu-ts has produced. */
function tokenProofs(token: unknown): TokenProof[] {
  if (!token || typeof token !== 'object') return [];
  const record = token as { proofs?: unknown; token?: unknown };
  if (Array.isArray(record.proofs)) return record.proofs as TokenProof[];
  if (Array.isArray(record.token)) {
    return (record.token as { proofs?: unknown }[]).flatMap((part) =>
      Array.isArray(part.proofs) ? (part.proofs as TokenProof[]) : []
    );
  }
  return [];
}

/**
 * What the token itself says: how it is cut, which keysets signed it, whether
 * it can be checked offline. Read from the token the entry carries, so it is
 * there for a send from `pending` on and for a finished receive.
 */
function tokenDetailItems(entry: Loose): Row[] {
  const token = entry.token as { mint?: unknown; unit?: unknown; memo?: unknown } | undefined;
  const proofs = tokenProofs(token);
  if (proofs.length === 0) return [];
  const amounts = proofs
    .map((proof) => Number(proof.amount))
    .filter((amount) => Number.isFinite(amount))
    .sort((a, b) => b - a);
  const keysets = [...new Set(proofs.map((proof) => str(proof.id)).filter((id) => id !== null))];
  const withDleq = proofs.filter((proof) => proof.dleq != null).length;
  const witnessed = proofs.filter((proof) => proof.witness != null).length;
  return rowsOf('Token', [
    ['Proofs', String(proofs.length)],
    ['Denominations', amounts.length > 0 ? amounts.join(', ') : null],
    ['Keysets', keysets.length > 0 ? keysets.join(', ') : null],
    // NUT-12: with a DLEQ proof the mint's signature can be checked without
    // asking the mint; without one it cannot.
    [
      'Offline check (DLEQ)',
      withDleq === proofs.length
        ? 'Included'
        : withDleq === 0
          ? 'Not included'
          : `${withDleq} of ${proofs.length}`,
    ],
    ['Signed parts', witnessed > 0 ? `${witnessed} of ${proofs.length}` : null],
    ['Token mint', str(token?.mint)],
    ['Token unit', str(token?.unit)],
    ['Memo', str(token?.memo)],
  ]);
}

/**
 * Everything an entry can say about itself beyond what its screen puts in its
 * own words: who it was with, what the token is and can do, the mint, the
 * identifiers, and the raw facts a bug report needs. Appended last to every
 * detail list, so a payment can be read out in full from the Details page.
 * `DetailsSection` drops a row whose title an earlier row already used, so a
 * screen that shows one of these in its own words keeps its own.
 */
export function entryDetailItems(entry: object | null | undefined): Row[] {
  if (!entry) return [];
  const record = entry as Loose;
  const metadata = (record.metadata ?? {}) as Loose;
  return [
    ...peopleDetailItems(record),
    // What the ecash can and cannot do: read from its own proofs while it
    // still has them, from what was recorded at send time once it does not.
    ...(record.type === 'send' || record.type === 'receive'
      ? (spendingConditionDetailItems(
          describeSendLock(record as never, { now: Date.now() })
        ).filter(Boolean) as Row[])
      : []),
    ...tokenDetailItems(record),
    ...rowsOf('Mint', [
      ['Mint', str(record.mintUrl)],
      ['Unit', str(record.unit)],
    ]),
    ...rowsOf('References', [
      ['ID', str(record.id)],
      ['Operation ID', str(record.operationId) ?? str(metadata.operationId)],
      ['Quote ID', str(record.quoteId)],
    ]),
    ...rowsOf('Debug', [
      ['Type', str(record.type)],
      ['Raw state', str(record.state)],
      ['Remote state', str(record.remoteState)],
      ['Created', when(record.createdAt)],
      ['Updated', when(record.updatedAt)],
      ['Error', str(record.error) ?? str(metadata.errorMessage)],
    ]),
  ];
}
