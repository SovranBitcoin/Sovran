import { create } from 'zustand';

export type PendingProfileAction =
  | {
      type: 'create-derived-profile';
      requestedAt: number;
    }
  | {
      type: 'switch-profile';
      accountIndex: number;
      requestedAt: number;
    }
  | {
      type: 'activate-imported-profile';
      accountIndex: number;
      pubkeyHex: string;
      requestedAt: number;
    }
  | {
      type: 'delete-account';
      requestedAt: number;
    }
  | null;

type ProfileActionStore = {
  pendingAction: PendingProfileAction;
  requestCreateDerivedProfile: () => void;
  requestSwitchProfile: (accountIndex: number) => void;
  requestActivateImportedProfile: (accountIndex: number, pubkeyHex: string) => void;
  requestDeleteAccount: () => void;
  clearPendingAction: () => void;
};

export const useProfileActionStore = create<ProfileActionStore>((set) => ({
  pendingAction: null,
  requestCreateDerivedProfile: () =>
    set({
      pendingAction: {
        type: 'create-derived-profile',
        requestedAt: Date.now(),
      },
    }),
  requestSwitchProfile: (accountIndex) =>
    set({
      pendingAction: {
        type: 'switch-profile',
        accountIndex,
        requestedAt: Date.now(),
      },
    }),
  requestActivateImportedProfile: (accountIndex, pubkeyHex) =>
    set({
      pendingAction: {
        type: 'activate-imported-profile',
        accountIndex,
        pubkeyHex,
        requestedAt: Date.now(),
      },
    }),
  requestDeleteAccount: () =>
    set({
      pendingAction: {
        type: 'delete-account',
        requestedAt: Date.now(),
      },
    }),
  clearPendingAction: () => set({ pendingAction: null }),
}));
