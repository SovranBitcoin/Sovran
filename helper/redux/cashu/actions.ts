import {
  SET_SELECTED_MINT,
  SET_ALLOCATION,
  UPDATE_CURRENCY_ALLOCATION,
  RESET_ALLOCATION,
} from './actionTypes';

// Only keep actions that are still needed for migration
export type CashuAction =
  | ReturnType<typeof setSelectedMint>
  | ReturnType<typeof setAllocation>
  | ReturnType<typeof updateCurrencyAllocation>
  | ReturnType<typeof resetAllocation>;

export const setSelectedMint = ({ profileId, mintUrl }: { profileId: number; mintUrl: string }) =>
  ({
    type: SET_SELECTED_MINT,
    payload: { profileId, mintUrl },
  }) as const;

export const setAllocation = (allocation: Record<string, Record<string, number>>) =>
  ({
    type: SET_ALLOCATION,
    payload: { allocation },
  }) as const;

export const updateCurrencyAllocation = (currency: string, allocation: Record<string, number>) =>
  ({
    type: UPDATE_CURRENCY_ALLOCATION,
    payload: { currency, allocation },
  }) as const;

export const resetAllocation = () =>
  ({
    type: RESET_ALLOCATION,
  }) as const;

// DEPRECATED: These actions are no longer used with Coco migration
// All other actions have been removed as they are now handled by Coco
