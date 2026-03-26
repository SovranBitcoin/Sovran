import type { AnnotatedOption, PaymentMachine, ParsedPaymentInput, StepDataMap } from 'coco-payment-ux';
import type {
  ButtonHandlerActionButton,
  ButtonHandlerButton,
} from '@/shared/ui/composed/ButtonHandler';

type EmojiPickerPayload = { token: string };

/** Directly uses StepDataMap['chooseOption'] + machine reference. */
type PaymentOptionsPayload = StepDataMap['chooseOption'] & {
  machine: PaymentMachine;
  onDismiss?: () => void;
};

/** Directly uses StepDataMap['chooseProofs'] + machine reference. */
type ProofSelectorPayload = StepDataMap['chooseProofs'] & {
  machine: PaymentMachine;
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
type PaymentFallbackPayload = {
  parsed: ParsedPaymentInput;
  options: AnnotatedOption[];
  unit: string;
  failedOptionValues: string[];
  lastFailedMessage?: string;
  machine: PaymentMachine;
  onDismiss?: () => void;
};

type BaseActionSheetPayloads = {
  'profile-switcher': {
    onRequestAction: (action: ProfileSwitcherAction) => void;
  };
  'emoji-picker': EmojiPickerPayload;
  'proof-selector': ProofSelectorPayload;
  'payment-options': PaymentOptionsPayload;
  'payment-fallback': PaymentFallbackPayload;
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
