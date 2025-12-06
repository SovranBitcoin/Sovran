import { SET_SELECTED_MINT } from './actionTypes';

// Only keep actions that are still needed for migration
export type CashuAction = ReturnType<typeof setSelectedMint>;

export const setSelectedMint = ({ profileId, mintUrl }: { profileId: number; mintUrl: string }) =>
  ({
    type: SET_SELECTED_MINT,
    payload: { profileId, mintUrl },
  }) as const;
