import { defineStore as create } from '@/shared/lib/persist/defineStore';

/**
 * Whether this session's default-mint setup has finished (added the curated
 * mints and picked one, or given up). Until it has, a wallet with no selected
 * mint is still being set up, so the header pill holds its skeleton instead of
 * saying "Add a mint" a moment before the default mint appears.
 *
 * Runtime only, never persisted: every Coco start runs the setup again.
 */
interface DefaultMintSetupStore {
  settled: boolean;
  markSettled: () => void;
}

export const useDefaultMintSetupStore = create<DefaultMintSetupStore>({
  name: 'useDefaultMintSetupStore',
  scope: 'session',
})((set, get) => ({
  settled: false,
  markSettled: () => {
    if (!get().settled) set({ settled: true });
  },
}));
