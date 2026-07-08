/**
 * Detects a read-only transaction *history* view vs a live payment flow.
 *
 * The same detail screens (Onchain/Lightning receive, Lightning send, …) are
 * reused by both the `(receive-flow)`/`(send-flow)` state-machine flows and
 * history viewing. A row tapped from `<Transactions>`/`<Transaction>` opens its
 * detail via `navigateToTransactionDetail` (shared/lib/nav/transactionDetailRoutes),
 * which tags the route with `historyView='1'`. In that case the mint is fixed —
 * the transaction already happened — so screens render the non-clickable
 * "Receiving/Sent with" `HistoryEntryRefresh` instead of a clickable `MintSelector`.
 *
 * Reading a route param (rather than a context) is deliberate: the tap can
 * resolve into the receive/send-flow route group (e.g. from the home screen),
 * so a route-group-scoped provider would miss it — the tag has to travel with
 * the navigation.
 */

import { useLocalSearchParams } from 'expo-router';

export function useIsTransactionHistoryView(): boolean {
  const { historyView } = useLocalSearchParams<{ historyView?: string }>();
  return historyView === '1';
}
