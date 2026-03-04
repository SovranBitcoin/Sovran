import type {
  ButtonHandlerActionButton,
  ButtonHandlerButton,
} from '@/shared/ui/composed/ButtonHandler';

type EmojiPickerPayload = { token: string };

type BaseActionSheetPayloads = {
  'profile-switcher': {
    onSwitchProfile: (accountIndex: number) => void;
    onAddProfile: () => void;
    onImportProfile?: (npubNumber: number) => void;
  };
  'emoji-picker': EmojiPickerPayload;
};

type ButtonHandlerPushTarget = {
  [K in Exclude<keyof BaseActionSheetPayloads, 'profile-switcher'>]: {
    sheetId: K;
    payload: BaseActionSheetPayloads[K];
  };
}[Exclude<keyof BaseActionSheetPayloads, 'profile-switcher'>];

export type ActionSheetButtonHandlerActionButton = Omit<
  ButtonHandlerActionButton,
  'onPress' | 'pushSheet'
> &
  {
    onPress?: ButtonHandlerButton['onPress'];
    pushSheet?: ButtonHandlerPushTarget;
  };

/** Payload types for custom action sheets (profile-switcher, emoji-picker, button-handler) */
export type ActionSheetPayloads = BaseActionSheetPayloads & {
  'button-handler': {
    title?: string;
    description?: string;
    buttons: ActionSheetButtonHandlerActionButton[];
  };
};
