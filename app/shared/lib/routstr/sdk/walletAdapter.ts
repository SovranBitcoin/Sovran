import { getEncodedToken, getTokenMetadata } from '@cashu/cashu-ts';

import { CocoManager } from '@/shared/lib/cashu/manager';
import { apiLog } from '@/shared/lib/logger';
import { useMintStore } from '@/shared/stores/profile/mintStore';

import { annotatePaymentLeg } from './paymentScope';
import { spendableMintBalances } from '../payingMint';

/**
 * `@routstr/sdk`'s wallet seam, pointed at Coco.
 *
 * The SDK can run its own Cashu wallet. It must not here: a second wallet is
 * a second balance, which is the thing this whole change set exists to remove.
 * Its `WalletAdapter` is four methods, all of which Coco already answers, so
 * the SDK spends and receives from the one wallet the user actually has.
 *
 * The seam is string-shaped — tokens cross it encoded — which also contains
 * the version skew between the SDK's declared `@cashu/cashu-ts@^3` and the
 * `5.0.0-rc` this workspace hoists. No token OBJECT crosses the boundary, so
 * the two majors never have to agree on a shape.
 */

/**
 * Units for every mint the wallet holds, refreshed on each `getBalances`.
 *
 * `getMintUnits` is synchronous and Coco's balances are not, so the answer has
 * to be the last one read. The SDK always calls `getBalances` before it picks
 * a mint, so by the time this is consulted it is current. Reporting only the
 * SELECTED mint here would leave every other mint unit-less, and the SDK skips
 * a mint it cannot price — which is how a wallet with funds still fails to pay.
 */
function manager() {
  const instance = CocoManager.peekInstance();
  if (!instance) throw new Error('wallet is not ready');
  return instance;
}

export function createCocoWalletAdapter(assertOwner: () => void = () => {}) {
  let unitsByMint: Record<string, 'sat' | 'msat'> = {};
  const ownedManager = () => {
    assertOwner();
    return manager();
  };
  const assertManager = (instance: ReturnType<typeof manager>) => {
    assertOwner();
    if (CocoManager.peekInstance() !== instance) throw new Error('Wallet changed during payment');
  };
  return {
    async getBalances(): Promise<Record<string, number>> {
      const instance = ownedManager();
      const balances = await instance.wallet.balances.byMint();
      assertManager(instance);
      const entries = Object.entries(spendableMintBalances(balances));
      // Sovran is sat-denominated throughout; a msat mint would need its own
      // handling well before this adapter.
      unitsByMint = Object.fromEntries(entries.map(([mintUrl]) => [mintUrl, 'sat' as const]));
      return Object.fromEntries(entries);
    },

    getMintUnits(): Record<string, 'sat' | 'msat'> {
      assertOwner();
      const selected = useMintStore.getState().selectedMint;
      // The selected mint is always answerable, even before the first balance
      // read, because it is the one the caller asked to pay from.
      return selected ? { [selected]: 'sat', ...unitsByMint } : unitsByMint;
    },

    getActiveMintUrl(): string | null {
      assertOwner();
      return useMintStore.getState().selectedMint ?? null;
    },

    async sendToken(mintUrl: string, amount: number): Promise<string> {
      const instance = ownedManager();
      const prepared = await instance.ops.send.prepare({ mintUrl, amount, unit: 'sat' });
      assertManager(instance);
      const { operation, token } = await instance.ops.send.execute(prepared);
      // Return the token for durable recovery even if the owner changed during
      // execute. The bound SDK wrapper journals it before checking dispatch.
      try {
        assertManager(instance);
        annotatePaymentLeg('send', operation.id);
      } catch {
        // The originating owner's journal still receives the token below.
      }
      apiLog.info('routstr.sdk.sent', { amount, operationId: operation.id });
      return getEncodedToken(token);
    },

    async receiveToken(
      token: string
    ): Promise<{ success: boolean; amount: number; unit: 'sat' | 'msat'; message?: string }> {
      assertOwner();
      let amount: number;
      let unit: 'sat' | 'msat';
      try {
        // Read from the proofs, not from the receive result: the figure is what
        // makes a request's cost exact, and it must survive a retried banking.
        const metadata = getTokenMetadata(token);
        amount = metadata.amount.toNumber();
        if (metadata.unit !== 'sat' && metadata.unit !== 'msat') {
          return { success: false, amount: 0, unit: 'sat', message: 'Unsupported change unit' };
        }
        unit = metadata.unit;
      } catch {
        return { success: false, amount: 0, unit: 'sat', message: 'Invalid change token' };
      }
      // Routstr prices in millisats and change in sats, so a request costing a
      // fraction of a sat comes back as a token worth nothing. Coco rightly
      // refuses to receive one ("amount is not sufficient after fees"), and
      // reporting that as a failure makes the SDK treat a fully settled request
      // as money still in flight. Nothing to bank is a settled request.
      if (amount <= 0) {
        apiLog.debug('routstr.sdk.change_empty');
        return { success: true, amount: 0, unit };
      }
      try {
        const instance = ownedManager();
        const prepared = await instance.ops.receive.prepare({ token });
        assertManager(instance);
        const finalized = await instance.ops.receive.execute(prepared);
        assertManager(instance);
        annotatePaymentLeg('receive', finalized.id);
        apiLog.info('routstr.sdk.received', { amount });
        return { success: true, amount, unit };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        apiLog.error('routstr.sdk.receive_failed', { message, amount });
        return { success: false, amount: 0, unit: 'sat', message };
      }
    },
  };
}

/**
 * The sats a cashu token carries, read from its proofs.
 *
 * `null` when the string will not decode. Used where a token is being talked
 * ABOUT rather than moved — the recovery sweep, which has to be able to say
 * how much is stranded on a node without banking anything.
 */
export function tokenAmountSats(token: string): number | null {
  try {
    const metadata = getTokenMetadata(token);
    const amount = metadata.amount.toNumber();
    if (metadata.unit === 'msat') return amount / 1000;
    if (metadata.unit !== 'sat') return null;
    return amount;
  } catch {
    return null;
  }
}

export const cocoWalletAdapter = createCocoWalletAdapter();
