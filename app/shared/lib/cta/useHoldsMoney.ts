import { useBalanceContext } from '@cashu/coco-react';
import { amountToNumber } from 'wallet/amount';

type TotalsByUnit = ReturnType<typeof useBalanceContext>['balances']['totalByUnit'];

/**
 * Whether the wallet holds anything, in any unit. Amounts in different units
 * cannot be added up, and the reminders that ask only need to know that there
 * is something to lose, so one non-zero total in one unit is enough.
 */
export function holdsMoneyInAnyUnit(totalByUnit: TotalsByUnit): boolean {
  return Object.values(totalByUnit).some((balance) => amountToNumber(balance.total) > 0);
}

export function useHoldsMoney(): boolean {
  const { balances } = useBalanceContext();
  return holdsMoneyInAnyUnit(balances.totalByUnit);
}
