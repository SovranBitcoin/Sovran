import type { ButtonHandlerButton } from '@/shared/ui/composed/ButtonHandler';

/** Payload types for custom action sheets (profile-switcher, emoji-picker, button-handler) */
export type ActionSheetPayloads = {
  'profile-switcher': {
    onSwitchProfile: (accountIndex: number) => void;
    onAddProfile: () => void;
    onImportProfile?: (npubNumber: number) => void;
  };
  'emoji-picker': { token: string };
  'button-handler': { buttons: ButtonHandlerButton[] };
};
