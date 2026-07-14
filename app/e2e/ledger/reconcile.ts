/**
 * Sweep-then-reconcile convenience over the mandatory coordinator interface.
 * This module has no effect adapter seam of its own: every value-moving call
 * remains inside FundingCoordinator.
 */
import { FundingCoordinator, type FundingLeg } from './coordinator';

export async function reconcileLiability(
  coordinator: FundingCoordinator,
  leg: FundingLeg<'funded'> | FundingLeg<'quarantined'>
): Promise<FundingLeg<'reconciled'>> {
  const swept = await coordinator.sweep(leg);
  return coordinator.reconcile(swept);
}
