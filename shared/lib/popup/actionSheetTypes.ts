import type {
  ButtonHandlerActionButton,
  ButtonHandlerButton,
} from '@/shared/ui/composed/ButtonHandler';

type EmojiPickerPayload = { token: string };
type OfflineSendSuggestionsPayload = {
  requestedAmount: number;
  roundDownAmount: number | null;
  roundDownLabel?: string;
  roundUpAmount: number | null;
  roundUpLabel?: string;
  unit: string;
  onSelectAmount: (amount: number) => void | Promise<void>;
};

export type ProfileSwitcherAction =
  | {
      type: 'switch';
      accountIndex: number;
    }
  | {
      type: 'create';
    }
  | {
      type: 'import';
      nsec: string;
      pubkeyHex: string;
      accountIndex: number;
    };

/**
 * Addressable custom sheet IDs. Nested pages that only exist inside a sheet flow
 * (for example profile-switcher's import route) should stay internal to that sheet.
 */
type OfflineSendPayload = {
  requestedAmount: number;
  roundDownAmount: number | null;
  roundUpAmount: number | null;
  unit: string;
  /** When set, the sheet displays amounts in fiat instead of sats */
  fiat?: {
    symbol: string;
    requestedMinorUnit: number;
    roundDownMinorUnit: number | null;
    roundUpMinorUnit: number | null;
  };
  onRoundDown: (amount: number) => void | Promise<void>;
  onRoundUp: (amount: number) => void | Promise<void>;
  onCancel: () => void;
};

type MintSelectMint = {
  mintUrl: string;
  name: string;
  iconUrl?: string | null;
  balance: number;
};

type MintSelectPayload = {
  requiredAmount: number;
  unit: string;
  mints: MintSelectMint[];
  onSelectMint: (mintUrl: string) => void;
  onCancel: () => void;
};

type BaseActionSheetPayloads = {
  'profile-switcher': {
    onRequestAction: (action: ProfileSwitcherAction) => void;
  };
  'emoji-picker': EmojiPickerPayload;
  'offline-send-suggestions': OfflineSendSuggestionsPayload;
  'offline-send': OfflineSendPayload;
  'mint-select': MintSelectPayload;
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
> & {
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
