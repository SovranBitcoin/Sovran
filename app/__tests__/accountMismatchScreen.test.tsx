import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import * as Clipboard from 'expo-clipboard';
import { accountMismatchCopy } from 'copy/onboarding';

import { AccountMismatchScreen } from '@/shared/blocks/AccountMismatchScreen';
import {
  dismissIntegrityFailure,
  getIntegrityFailures,
  reportIntegrityFailure,
} from '@/shared/lib/nostr/accountIntegrity';
import type { AccountIntegrityResult } from '@/shared/lib/nostr/derivationIntegrity';
import { openMnemonicRecovery } from '@/shared/lib/profile/keyRecovery';
import { switchToExistingProfile } from '@/shared/lib/profile/profileSessionOrchestrator';
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

jest.mock('@/shared/stores/global/profileStore', () => ({
  useProfileStore: Object.assign(
    (select: (state: object) => unknown) =>
      select({
        activeAccountIndex: 1,
        profiles: [
          { accountIndex: 0, pubkey: 'a'.repeat(64), cachedDisplayName: 'Savings' },
          { accountIndex: 1, pubkey: 'b'.repeat(64) },
        ],
      }),
    { getState: () => ({ profiles: [] }) }
  ),
}));
jest.mock('@/shared/lib/profile/profileSessionOrchestrator', () => ({
  switchToExistingProfile: jest.fn(async () => true),
}));
jest.mock('@/shared/lib/profile/keyRecovery', () => ({ openMnemonicRecovery: jest.fn() }));
jest.mock('@/shared/lib/nostr/secureStorage', () => ({}));
jest.mock('@/shared/lib/nostr/keyDerivation', () => ({}));
jest.mock('@/shared/lib/legal/legalDocuments', () => ({
  legalDocuments: { operator: { email: 'help@example.test' } },
}));
jest.mock('@/features/settings/screens/SettingsProfileRecoveryScreen', () => ({
  SettingsProfileRecoveryScreen: () =>
    jest.requireActual('react').createElement('recovery-information'),
}));
jest.mock('expo-clipboard', () => ({ setStringAsync: jest.fn(async () => true) }));
jest.mock('@/shared/blocks/popup/ActionMenuHost', () => ({ ActionMenuHost: () => null }));
jest.mock('@/shared/ui/composed/Screen', () => ({
  Screen: ({ children }: React.PropsWithChildren) => <>{children}</>,
}));
jest.mock('@/shared/ui/primitives/View/VStack', () => ({
  VStack: ({ children, testID }: React.PropsWithChildren<{ testID?: string }>) => (
    <section data-testid={testID}>{children}</section>
  ),
}));
jest.mock('@/shared/ui/primitives/Text', () => ({
  Text: ({ children }: React.PropsWithChildren) => <text>{children}</text>,
}));
jest.mock('@/shared/ui/primitives/Button', () => ({
  Button: (props: { text: string; testID: string; accessibilityLabel?: string }) =>
    jest.requireActual('react').createElement('button', props),
}));
jest.mock('@/shared/lib/logger', () => ({ log: { error: jest.fn(), warn: jest.fn() } }));

/**
 * The critical screen: what it tells the person, what it lets them do, and
 * the one thing it never offers, which is a way on into the mismatched wallet.
 */
const failure: AccountIntegrityResult = {
  accountIndex: 1,
  source: 'derived',
  pubkeyPrefix: 'bbbbbbbb',
  ok: false,
  complete: true,
  checks: [],
  mismatches: [
    {
      invariant: 'row.derived-pubkey',
      status: 'fail',
      expected: 'pub:11112222',
      stored: 'pub:bbbbbbbb',
    },
  ],
  diagnosticCode: 'AM1-D1-RD-11112222-bbbbbbbb',
};

let tree: TestRenderer.ReactTestRenderer;
async function show(stopped: boolean, shown = failure) {
  await act(async () => {
    tree = TestRenderer.create(<AccountMismatchScreen failure={shown} stopped={stopped} />);
  });
}
const text = () =>
  tree.root
    .findAll((node) => (node.type as unknown) === 'text')
    .map((node) => node.children.join(''))
    .join('\n');
const button = (testID: string) => tree.root.findAll((node) => node.props.testID === testID)[0];
async function press(testID: string) {
  await act(async () => {
    await button(testID).props.onPress();
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  dismissIntegrityFailure(failure.accountIndex);
  jest.mocked(switchToExistingProfile).mockResolvedValue(true);
});
afterEach(async () => {
  if (tree) await act(async () => tree.unmount());
});

it('says which account, that nothing was changed, and what is at risk', async () => {
  await show(true);
  const shown = text();
  expect(shown).toContain(accountMismatchCopy.title);
  expect(shown).toContain(accountMismatchCopy.foundDerived.replace('{profile}', 'Profile 1'));
  expect(shown).toContain(accountMismatchCopy.unchanged);
  expect(shown).toContain(accountMismatchCopy.risk);
  expect(shown).toContain('help@example.test');
  expect(shown).toContain('AM1-D1-RD-11112222-bbbbbbbb');
});

it('words an imported account by its stored key, not by the phrase', async () => {
  await show(true, { ...failure, source: 'imported' });
  expect(text()).toContain(accountMismatchCopy.foundImported.replace('{profile}', 'Profile 1'));
  // Its identity never came from a phrase, so there is no phrase to enter.
  expect(button('account-mismatch-enter-phrase')).toBeUndefined();
});

it('gives every control a stable id and a spoken label', async () => {
  await show(true);
  for (const testID of [
    'account-mismatch-view-recovery',
    'account-mismatch-copy-code',
    'account-mismatch-switch-0',
    'account-mismatch-enter-phrase',
  ]) {
    expect(button(testID).props.accessibilityLabel).toEqual(expect.any(String));
  }
  expect(
    tree.root.findAll((node) => node.props['data-testid'] === 'account-mismatch-screen')
  ).toHaveLength(1);
});

it('copies the diagnostic code, which holds no key', async () => {
  await show(true);
  await press('account-mismatch-copy-code');
  expect(Clipboard.setStringAsync).toHaveBeenCalledWith('AM1-D1-RD-11112222-bbbbbbbb');
});

it('opens the existing recovery information page', async () => {
  await show(true);
  await press('account-mismatch-view-recovery');
  expect(
    tree.root.findAll((node) => (node.type as unknown) === 'recovery-information')
  ).toHaveLength(1);
});

it('offers the other accounts by name, and switches through the checked path', async () => {
  await show(true);
  expect(button('account-mismatch-switch-0').props.text).toBe(
    accountMismatchCopy.switchTo.replace('{profile}', 'Savings')
  );
  // Never a button for the mismatched account itself.
  expect(button('account-mismatch-switch-1')).toBeUndefined();

  await press('account-mismatch-switch-0');

  expect(switchToExistingProfile).toHaveBeenCalledWith({
    accountIndex: 0,
    fromStoppedAccount: true,
  });
});

it('says so when the other account could not be opened either', async () => {
  jest.mocked(switchToExistingProfile).mockResolvedValue(false);
  await show(true);
  await press('account-mismatch-switch-0');
  expect(text()).toContain(accountMismatchCopy.switchFailed);
});

it('lets a person enter the phrase the account was made with', async () => {
  await show(true);
  await press('account-mismatch-enter-phrase');
  expect(openMnemonicRecovery).toHaveBeenCalled();
});

it('can be closed only when the mismatched account is not the one running', async () => {
  await show(true);
  expect(button('account-mismatch-dismiss')).toBeUndefined();
  await act(async () => tree.unmount());

  reportIntegrityFailure(failure);
  await show(false);
  // Covering a sound account: no switching and no phrase entry from here.
  expect(button('account-mismatch-switch-0')).toBeUndefined();
  expect(button('account-mismatch-enter-phrase')).toBeUndefined();

  await press('account-mismatch-dismiss');

  expect(getIntegrityFailures()).toEqual([]);
});
