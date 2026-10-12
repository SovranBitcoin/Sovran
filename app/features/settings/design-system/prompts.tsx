/**
 * @fileoverview Design System · Prompts: what the page lists.
 *
 * Every prompt (`CTA_DEFINITIONS`), every screen that stops the app at launch,
 * the first-launch screens and the confirmations before something is deleted,
 * each on fixed sample data.
 *
 * Nothing here reads or writes app state. The screens are the app's own,
 * drawn from props, and every handler either does nothing or closes the
 * preview: no restart, restore, account switch, deletion or mint request can
 * start from this page.
 */

import type { Mint } from '@cashu/coco-core';
import { useState, type ReactElement } from 'react';

import OnboardingScreen from '@/features/onboarding/components/OnboardingScreen';
import { TermsAndConditionsScreen } from '@/features/onboarding/screens/TermsAndConditionsScreen';
import { DeleteScreenView } from '@/features/settings/screens/DeleteScreen';
import { SettingsRecoveryScreen } from '@/features/settings/screens/SettingsRecoveryScreen';
import { AccountMismatchView } from '@/shared/blocks/AccountMismatchScreen';
import { KeyRecoveryView, confirmStartFresh } from '@/shared/blocks/KeyRecoveryScreen';
import { StartupFailedScreen } from '@/shared/blocks/StartupFailedScreen';
import { CTA_DEFINITIONS } from '@/shared/lib/cta/definitions';
import { describeLegacyClaim } from '@/shared/lib/cta/oldEcashPrompt';
import type { CtaBodyView, CtaDefinition, CtaId } from '@/shared/lib/cta/types';
import type { AccountIntegrityResult } from '@/shared/lib/nostr/derivationIntegrity';
import { showMnemonicRecovery, showNsecRecovery } from '@/shared/lib/profile/keyRecovery';
import type { ProfileEntry } from '@/shared/stores/global/profileStore';

const NOTHING = () => {};

// ── Sample data ─────────────────────────────────────────────────

/** Well-formed public keys that belong to nobody. */
const SAMPLE_PUBKEY = '5c0de1e7ab1e5c0de1e7ab1e5c0de1e7ab1e5c0de1e7ab1e5c0de1e7ab1e0001';
const SAMPLE_IMPORTED_PUBKEY = '5c0de1e7ab1e5c0de1e7ab1e5c0de1e7ab1e5c0de1e7ab1e5c0de1e7ab1e0002';

const SAMPLE_MINT_URL = 'https://mint.minibits.cash/Bitcoin';

const SAVINGS: ProfileEntry = {
  accountIndex: 1,
  pubkey: SAMPLE_PUBKEY,
  addedAt: 0,
  source: 'derived',
  cachedDisplayName: 'Savings',
};
const OLD_PHONE: ProfileEntry = {
  accountIndex: 1_203_948_571,
  pubkey: SAMPLE_IMPORTED_PUBKEY,
  addedAt: 0,
  source: 'imported',
  cachedDisplayName: 'Old phone',
};
/** Three accounts: the first is sound, the other two are the ones that fail. */
const SAMPLE_PROFILES: readonly ProfileEntry[] = [
  { accountIndex: 0, pubkey: SAMPLE_PUBKEY, addedAt: 0, cachedDisplayName: 'Satoshi' },
  SAVINGS,
  OLD_PHONE,
];

const DERIVED_MISMATCH: AccountIntegrityResult = {
  accountIndex: SAVINGS.accountIndex,
  source: 'derived',
  pubkeyPrefix: '5c0de1e7',
  ok: false,
  complete: true,
  checks: [],
  mismatches: [
    {
      invariant: 'row.derived-pubkey',
      status: 'fail',
      expected: 'pub:1a2b3c4d',
      stored: 'pub:5c0de1e7',
    },
  ],
  diagnosticCode: 'AM1-D1-RD+CR-1a2b3c4d-5c0de1e7',
};
const IMPORTED_MISMATCH: AccountIntegrityResult = {
  accountIndex: OLD_PHONE.accountIndex,
  source: 'imported',
  pubkeyPrefix: '5c0de1e7',
  ok: false,
  complete: true,
  checks: [],
  mismatches: [
    {
      invariant: 'row.imported-key',
      status: 'fail',
      expected: 'pub:9f8e7d6c',
      stored: 'pub:5c0de1e7',
    },
  ],
  diagnosticCode: 'AM1-I1203948571-RK-9f8e7d6c-5c0de1e7',
};

/** Only what the restore screen draws: the address and the mint's name. */
function sampleMint(mintUrl: string, name: string): Mint {
  const fields = { mintUrl, mintInfo: { name } };
  return fields as Mint;
}
const RESTORE_PREVIEW = {
  mints: [
    sampleMint(SAMPLE_MINT_URL, 'Minibits'),
    sampleMint('https://mint.coinos.io', 'Coinos'),
    sampleMint('https://mint.example', 'Example mint'),
  ],
};

// ── Prompts ─────────────────────────────────────────────────────

interface CtaSample {
  /** Unique among one prompt's samples; part of the row's testID. */
  id: string;
  /** What this sample shows, for the row's second line. */
  label: string;
  body: CtaBodyView;
}

const NO_CLAIM: CtaBodyView = { balanceTotalSat: 0, oldEcash: null };

/**
 * The data each prompt is shown on. Keyed by `CtaId`, so a prompt added to
 * `CTA_DEFINITIONS` does not compile until it has a sample here, and
 * `designSystemPrompts.test.tsx` fails if one is left empty.
 */
export const CTA_SAMPLES: Record<CtaId, readonly CtaSample[]> = {
  'update-required': [
    { id: 'available', label: 'A newer version is in the store', body: NO_CLAIM },
  ],
  'backup-recovery-phrase': [
    {
      id: 'funded',
      label: 'A wallet holding 21,000 sats',
      body: { balanceTotalSat: 21_000, oldEcash: null },
    },
    { id: 'empty', label: 'An empty wallet, a week after it was made', body: NO_CLAIM },
  ],
  'claim-old-ecash': [
    {
      id: 'sats',
      label: 'A named mint holding 2,100 sats',
      body: {
        balanceTotalSat: 0,
        oldEcash: describeLegacyClaim(
          { mintUrl: SAMPLE_MINT_URL, amount: 2_100, unit: 'sat' },
          'Minibits'
        ),
      },
    },
    {
      id: 'fiat',
      label: 'A mint with no name holding $12.50',
      body: {
        balanceTotalSat: 0,
        oldEcash: describeLegacyClaim(
          { mintUrl: 'https://mint.example', amount: 1_250, unit: 'usd' },
          undefined
        ),
      },
    },
    {
      id: 'unknown-unit',
      label: 'An amount in a unit the old app never recorded',
      body: {
        balanceTotalSat: 0,
        oldEcash: describeLegacyClaim(
          { mintUrl: SAMPLE_MINT_URL, amount: 2_100, unit: null },
          'Minibits'
        ),
      },
    },
  ],
};

// ── Menus ───────────────────────────────────────────────────────

const openPhraseSample = () => showMnemonicRecovery(async () => true);
const openKeySample = () =>
  showNsecRecovery(SAMPLE_IMPORTED_PUBKEY, { save: async () => true, restart: () => true });
const openStartFreshSample = () => confirmStartFresh(NOTHING);

// ── Screens that keep a little state of their own ───────────────

function MismatchSample({
  failure,
  stopped,
  close,
}: {
  failure: AccountIntegrityResult;
  stopped: boolean;
  close: () => void;
}) {
  // Stands in for the clipboard, which this page leaves alone.
  const [copied, setCopied] = useState(false);
  return (
    <AccountMismatchView
      failure={failure}
      stopped={stopped}
      profiles={SAMPLE_PROFILES}
      copied={copied}
      switchFailed={false}
      onViewRecovery={NOTHING}
      onCopyCode={() => setCopied(true)}
      onSwitch={NOTHING}
      onEnterPhrase={openPhraseSample}
      onDismiss={close}
    />
  );
}

// ── The list ────────────────────────────────────────────────────

interface PromptEntryBase {
  /** Stable: the row's testID and the preview route's `id` param. */
  id: string;
  title: string;
  detail: string;
}

export interface CtaPromptEntry extends PromptEntryBase {
  kind: 'cta';
  cta: CtaDefinition;
  sample: CtaSample;
}

export interface ScreenPromptEntry extends PromptEntryBase {
  kind: 'screen';
  /** The navigation title the screen sits under in the app; absent when it has none. */
  header?: string;
  /** `close` leaves the preview, for the actions that leave the screen in the app. */
  render: (close: () => void) => ReactElement;
}

interface MenuPromptEntry extends PromptEntryBase {
  kind: 'menu';
  open: () => void;
}

export type PromptEntry = CtaPromptEntry | ScreenPromptEntry | MenuPromptEntry;

interface PromptGroup {
  id: string;
  title: string;
  entries: readonly PromptEntry[];
}

const CTA_ENTRIES: readonly CtaPromptEntry[] = CTA_DEFINITIONS.flatMap((cta) =>
  CTA_SAMPLES[cta.id].map((sample) => ({
    kind: 'cta' as const,
    id: `cta-${cta.id}-${sample.id}`,
    title: cta.content.title,
    detail: sample.label,
    cta,
    sample,
  }))
);

const STARTUP_ENTRIES: readonly ScreenPromptEntry[] = [
  {
    kind: 'screen',
    id: 'startup-storage-failed',
    title: "The update couldn't finish",
    detail: 'Saved data could not be updated at launch',
    render: () => <StartupFailedScreen step="storage" onRetry={NOTHING} />,
  },
  {
    kind: 'screen',
    id: 'startup-wallet-failed',
    title: "Your wallet couldn't be opened",
    detail: 'The wallet database did not open',
    render: () => <StartupFailedScreen step="wallet" onRetry={NOTHING} />,
  },
  {
    kind: 'screen',
    id: 'keys-locked',
    title: "Stored keys can't be unlocked",
    detail: 'The device keeps its secure storage locked',
    render: () => (
      <KeyRecoveryView
        locked
        imported={false}
        retryFailed
        resetFailed={false}
        onRetry={NOTHING}
        onRecover={openPhraseSample}
        onStartFresh={openStartFreshSample}
      />
    ),
  },
  {
    kind: 'screen',
    id: 'keys-missing-derived',
    title: 'Your saved account needs its key',
    detail: 'An account made from the recovery phrase',
    render: () => (
      <KeyRecoveryView
        locked={false}
        imported={false}
        retryFailed={false}
        resetFailed={false}
        onRetry={NOTHING}
        onRecover={openPhraseSample}
        onStartFresh={NOTHING}
      />
    ),
  },
  {
    kind: 'screen',
    id: 'keys-missing-imported',
    title: 'Your saved account needs its key',
    detail: 'An account with an imported Nostr key',
    render: () => (
      <KeyRecoveryView
        locked={false}
        imported
        retryFailed={false}
        resetFailed={false}
        onRetry={NOTHING}
        onRecover={openKeySample}
        onStartFresh={NOTHING}
      />
    ),
  },
  {
    kind: 'screen',
    id: 'account-mismatch-stopped-derived',
    title: 'Account does not match the recovery phrase',
    detail: 'The open account, stopped: switch or enter its phrase',
    render: (close) => <MismatchSample failure={DERIVED_MISMATCH} stopped close={close} />,
  },
  {
    kind: 'screen',
    id: 'account-mismatch-stopped-imported',
    title: 'Account does not match its imported key',
    detail: 'The open account, stopped: switch only',
    render: (close) => <MismatchSample failure={IMPORTED_MISMATCH} stopped close={close} />,
  },
  {
    kind: 'screen',
    id: 'account-mismatch-other-account',
    title: 'Another account does not match',
    detail: 'Over the running app, and can be closed',
    render: (close) => <MismatchSample failure={DERIVED_MISMATCH} stopped={false} close={close} />,
  },
  {
    kind: 'screen',
    id: 'restore-welcome-back',
    title: 'Welcome back',
    detail: 'A recovery phrase is on the device and its ecash is not',
    render: () => <SettingsRecoveryScreen gateMode preview={RESTORE_PREVIEW} />,
  },
];

const FIRST_LAUNCH_ENTRIES: readonly ScreenPromptEntry[] = [
  {
    kind: 'screen',
    id: 'legal-first',
    title: 'Terms, then Privacy',
    detail: 'Nothing accepted yet: 1 of 2, then 2 of 2',
    render: (close) => (
      <TermsAndConditionsScreen onClose={close} updated={false} onViewRecovery={NOTHING} />
    ),
  },
  {
    kind: 'screen',
    id: 'legal-updated',
    title: 'Updated documents',
    detail: 'Earlier documents were accepted and have changed',
    render: (close) => (
      <TermsAndConditionsScreen onClose={close} updated onViewRecovery={NOTHING} />
    ),
  },
  {
    kind: 'screen',
    id: 'legal-settings-error',
    title: 'Could not load your settings',
    detail: 'The saved agreement could not be read',
    render: (close) => (
      <TermsAndConditionsScreen
        onClose={close}
        settingsError
        onRetry={NOTHING}
        updated={false}
        onViewRecovery={NOTHING}
      />
    ),
  },
  {
    kind: 'screen',
    id: 'onboarding-carousel',
    title: 'Onboarding',
    detail: 'The four slides, then Welcome and Get Started',
    render: (close) => <OnboardingScreen onComplete={close} onRecoveryPhrase={openPhraseSample} />,
  },
];

const KEY_FORM_ENTRIES: readonly MenuPromptEntry[] = [
  {
    kind: 'menu',
    id: 'enter-recovery-phrase',
    title: 'Enter recovery phrase',
    detail: 'From onboarding, a locked device or a mismatched account',
    open: openPhraseSample,
  },
  {
    kind: 'menu',
    id: 'reimport-nostr-key',
    title: 'Re-import Nostr key',
    detail: 'For an imported account whose key is missing',
    open: openKeySample,
  },
];

const DELETION_ENTRIES: readonly PromptEntry[] = [
  {
    kind: 'screen',
    id: 'delete-account',
    title: 'Delete Account',
    detail: 'Settings: erase every account and key on the device',
    header: 'Delete account',
    render: (close) => <DeleteScreenView onDelete={NOTHING} onCancel={close} />,
  },
  {
    kind: 'menu',
    id: 'start-fresh',
    title: 'Start fresh?',
    detail: 'Two confirmations, from the locked-keys screen',
    open: openStartFreshSample,
  },
];

export const PROMPT_GROUPS: readonly PromptGroup[] = [
  { id: 'prompts', title: 'Prompts', entries: CTA_ENTRIES },
  { id: 'startup', title: 'Stopped at launch', entries: STARTUP_ENTRIES },
  { id: 'first-launch', title: 'First launch', entries: FIRST_LAUNCH_ENTRIES },
  { id: 'key-forms', title: 'Key forms', entries: KEY_FORM_ENTRIES },
  { id: 'deleting', title: 'Deleting', entries: DELETION_ENTRIES },
];

export const PROMPT_ENTRIES: readonly PromptEntry[] = PROMPT_GROUPS.flatMap(
  (group) => group.entries
);

export function findPromptEntry(id: string): PromptEntry | undefined {
  return PROMPT_ENTRIES.find((entry) => entry.id === id);
}
