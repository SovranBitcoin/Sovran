import React from 'react';
import { getPublicKey, nip19 } from 'nostr-tools';
import {
  defaultDetectors,
  type AnnotatedOption,
  type PaymentMachine,
  type PaymentOptionKind,
  type StepDataMap,
} from 'coco-payment-ux';

import { AmountFormatter } from '@/shared/ui/composed/AmountFormatter';
import { Avatar } from '@/shared/ui/primitives/Avatar';
import { HStack } from '@/shared/ui/primitives/View/HStack';
import Icon from 'assets/icons';
import { getEcashTokenAmount } from '@/shared/lib/cashu/utils';
import { resolveIdentityName } from '@/shared/lib/identity';
import { pubkeyToAccountNumber } from '@/shared/lib/nostr/keyDerivation';
import { useProfileStore } from '@/shared/stores/global/profileStore';

import type { ProfileSwitcherAction } from '../actionSheetTypes';
import {
  actionMenuPopup,
  type ActionMenuButton,
  type ActionMenuSection,
} from './actionMenu';

// ---------------------------------------------------------------------------
// Profile switcher — dispatched through `actionMenuPopup` so each profile +
// the Generate / Import affordances render as `Menu.Item`s on the canonical
// heroui-native `Menu presentation="bottom-sheet"` surface (same look as
// "as Lightning" / "as Ecash" / "as Onchain" / "as Text" / "as Emoji").
// Profiles are split into Imported / Derived tabs (`sections`); tapping a
// tab scrolls the body. `footerButtons` keeps Generate / Import sticky at
// the bottom; tapping Import chains a second `actionMenuPopup` with `inputs`
// for the nsec form.
// ---------------------------------------------------------------------------

export type ProfileSwitcherPopupPayload = {
  onRequestAction: (action: ProfileSwitcherAction) => void;
};

export function profileSwitcherPopup(payload: ProfileSwitcherPopupPayload): void {
  const state = useProfileStore.getState();
  const profiles = state.profiles;
  const activeIndex = state.activeAccountIndex;

  const buildProfileButton = (profile: (typeof profiles)[number]): ActionMenuButton => {
    const isActive = profile.accountIndex === activeIndex;
    const displayName = resolveIdentityName({
      pubkey: profile.pubkey,
      overrideName: profile.cachedDisplayName,
    });
    return {
      testID: `profile-row-${profile.accountIndex}`,
      text: displayName,
      disabled: isActive,
      iconNode: (
        <Avatar
          state={profile.cachedPicture ? 'image' : 'fallback'}
          seed={profile.pubkey}
          picture={profile.cachedPicture}
          name={displayName}
          size={36}
        />
      ),
      suffix: (
        <HStack align="center" spacing={6}>
          {profile.cachedBalanceSats != null ? (
            <AmountFormatter
              amount={profile.cachedBalanceSats}
              unit="sat"
              size={13}
              weight="medium"
            />
          ) : null}
          {isActive ? <Icon name="mdi:check-circle" size={18} /> : null}
        </HStack>
      ),
      onPress: () => {
        payload.onRequestAction({ type: 'switch', accountIndex: profile.accountIndex });
      },
    };
  };

  const importedButtons = profiles.filter((p) => p.source === 'imported').map(buildProfileButton);
  const derivedButtons = profiles.filter((p) => p.source !== 'imported').map(buildProfileButton);

  // Only render tabs that have profiles — when a user has only derived
  // accounts (or only imported), a single-tab bar would be useless chrome.
  const sections = [
    importedButtons.length > 0 && {
      id: 'imported',
      anchor: {
        icon: <Icon name="mdi:key-variant" size={14} />,
        label: 'Imported',
        testID: 'profile-tab-imported',
      },
      buttons: importedButtons,
    },
    derivedButtons.length > 0 && {
      id: 'derived',
      anchor: {
        icon: <Icon name="mdi:tree" size={14} />,
        label: 'Derived',
        testID: 'profile-tab-derived',
      },
      buttons: derivedButtons,
    },
  ].filter(Boolean) as ActionMenuSection[];

  actionMenuPopup({
    title: 'Select profile',
    sections,
    footerButtons: [
      {
        testID: 'profile-create',
        text: 'Generate new account',
        icon: 'la:user-plus',
        onPress: () => {
          payload.onRequestAction({ type: 'create' });
        },
      },
      {
        testID: 'profile-import',
        text: 'Import Nostr',
        icon: 'mdi:key-variant',
        // Open the nsec input as a *separate* menu — the host
        // auto-dismisses this one (no `keepOpen`); we wait out the
        // close animation, then dispatch the second `actionMenuPopup`.
        // The delay is sized to gorhom's default sheet close (~200ms)
        // plus a small buffer so the open isn't cancelled by the
        // still-running close.
        onPress: () => {
          setTimeout(() => openProfileImportMenu(payload), 300);
        },
      },
    ],
  });
}

function openProfileImportMenu(payload: ProfileSwitcherPopupPayload): void {
  actionMenuPopup({
    title: 'Import Nostr',
    inputs: [
      {
        id: 'nsec',
        placeholder: 'nsec1...',
        secureTextEntry: true,
        autoCapitalize: 'none',
        autoCorrect: false,
        description: 'Paste your Nostr private key (nsec) to import an existing account.',
      },
    ],
    primaryAction: {
      text: 'Import',
      loadingText: 'Importing...',
      icon: 'mdi:key-variant',
      testID: 'profile-import-submit',
      isDisabled: (v) => !v.nsec.trim(),
      onPress: (values, { setError, close }) => {
        const trimmed = values.nsec.trim();
        if (!trimmed) {
          setError('Please enter an nsec.');
          return;
        }
        let privateKeyBytes: Uint8Array;
        try {
          const decoded = nip19.decode(trimmed);
          if (decoded.type !== 'nsec') {
            setError('Invalid format. Must be an nsec (nsec1...).');
            return;
          }
          privateKeyBytes = decoded.data;
        } catch {
          setError('Invalid nsec format.');
          return;
        }
        let pubkeyHex: string;
        try {
          pubkeyHex = getPublicKey(privateKeyBytes);
        } catch {
          setError('Failed to derive public key from nsec.');
          return;
        }
        if (useProfileStore.getState().hasPubkey(pubkeyHex)) {
          setError('This identity already exists as a profile.');
          return;
        }
        payload.onRequestAction({
          type: 'import',
          nsec: trimmed,
          pubkeyHex,
          accountIndex: pubkeyToAccountNumber(pubkeyHex),
        });
        close();
      },
    },
  });
}

// ---------------------------------------------------------------------------
// Pick-one-of-N menus — dispatched through actionMenuPopup so they share the
// canonical `Menu presentation="bottom-sheet"` surface with "Select option",
// Copy-as-Text/Emoji, and Next-as-Ecash/Lightning.
//
// Signatures match the old payload shapes so call sites in
// features/send/lib/sovranPaymentConfig.ts don't change.
// ---------------------------------------------------------------------------

const CASHU_KINDS: readonly PaymentOptionKind[] = ['paymentRequest', 'ecashToken'];
const LIGHTNING_KINDS: readonly PaymentOptionKind[] = [
  'lightningInvoice',
  'lightningAddress',
  'lnurlp',
];

function getMethodLabel(kind: PaymentOptionKind): string {
  if (CASHU_KINDS.includes(kind)) return 'Cashu';
  if (LIGHTNING_KINDS.includes(kind)) return 'Lightning';
  return kind;
}

function getMethodIcon(kind: PaymentOptionKind): string {
  if (CASHU_KINDS.includes(kind)) return 'majesticons:coins';
  if (LIGHTNING_KINDS.includes(kind)) return 'mdi:lightning-bolt';
  return 'ph:contactless-payment-fill';
}

function getOptionAmount(option: {
  kind: PaymentOptionKind;
  value: string;
  amount?: number | null;
}): number | undefined {
  if (option.amount != null && option.amount > 0) return option.amount;
  if (option.kind === 'paymentRequest') {
    return defaultDetectors.getPaymentRequestInfo(option.value)?.amount ?? undefined;
  }
  if (option.kind === 'ecashToken') return getEcashTokenAmount(option.value);
  return undefined;
}

function buildOptionButton(
  annotated: AnnotatedOption,
  unit: string,
  machine: PaymentMachine,
  extras?: { isFailed?: boolean; failedReason?: string }
): ActionMenuButton {
  const { option, status } = annotated;
  const amount = getOptionAmount(option);
  const hasAmount = amount != null && amount > 0;
  const disabled = status === 'disabled';

  return {
    text: getMethodLabel(option.kind),
    icon: getMethodIcon(option.kind),
    disabled,
    reason: extras?.isFailed
      ? (extras.failedReason ?? 'Failed')
      : (annotated.reason?.message ?? undefined),
    description: !disabled && !extras?.isFailed && status === 'recommended' ? 'Recommended' : undefined,
    isFailed: extras?.isFailed,
    suffix: hasAmount ? (
      <AmountFormatter amount={amount} unit={unit} size={16} weight="medium" />
    ) : undefined,
    onPress: () => {
      void machine.chooseOption(option);
    },
  };
}

export type PaymentOptionsPopupPayload = StepDataMap['chooseOption'] & {
  machine: PaymentMachine;
  onDismiss?: () => void;
};

export function paymentOptionsPopup(payload: PaymentOptionsPopupPayload): void {
  const { options, unit, machine, onDismiss } = payload;
  actionMenuPopup({
    title: 'Choose how to pay',
    onDismiss,
    buttons: options.map((annotated) => buildOptionButton(annotated, unit, machine)),
  });
}

export type PaymentFallbackPopupPayload = StepDataMap['chooseFallbackOption'] & {
  machine: PaymentMachine;
  onDismiss?: () => void;
};

export function paymentFallbackPopup(payload: PaymentFallbackPopupPayload): void {
  const { options, unit, failedOptionValues, lastFailedMessage, machine, onDismiss } = payload;
  const failedSet = new Set(failedOptionValues);

  actionMenuPopup({
    title: 'Payment failed — try another method',
    onDismiss,
    buttons: options.map((annotated) =>
      buildOptionButton(annotated, unit, machine, {
        isFailed: failedSet.has(annotated.option.value),
        failedReason: lastFailedMessage,
      })
    ),
  });
}

export type ProofSelectorPopupPayload = StepDataMap['chooseProofs'] & {
  machine: PaymentMachine;
};

export function proofSelectorPopup(payload: ProofSelectorPopupPayload): void {
  const { suggestions, unit, machine } = payload;
  const buttons: ActionMenuButton[] = [];

  if (suggestions?.roundUp != null) {
    buttons.push({
      text: 'Round up',
      icon: 'fluent:arrow-upload-16-filled',
      suffix: (
        <AmountFormatter
          amount={suggestions.roundUp.amount}
          unit={unit}
          size={16}
          weight="medium"
        />
      ),
      onPress: () => {
        void machine.chooseProofs(suggestions.roundUp!.amount);
      },
    });
  }

  if (suggestions?.roundDown != null) {
    buttons.push({
      text: 'Round down',
      icon: 'fluent:arrow-download-16-filled',
      suffix: (
        <AmountFormatter
          amount={suggestions.roundDown.amount}
          unit={unit}
          size={16}
          weight="medium"
        />
      ),
      onPress: () => {
        void machine.chooseProofs(suggestions.roundDown!.amount);
      },
    });
  }

  buttons.push({
    text: 'Change mint',
    icon: 'mdi:swap-horizontal',
    separator: true,
    onPress: () => {
      void machine.requestMintSelector();
    },
  });

  actionMenuPopup({
    title: 'Choose amount',
    buttons,
  });
}
