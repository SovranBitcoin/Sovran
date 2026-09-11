import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { AppState } from 'react-native';
import { SettingsProfileRecoveryScreen } from '@/features/settings/screens/SettingsProfileRecoveryScreen';
import { ProfileDetailsScreen } from '@/features/settings/components/ProfileDetailsScreen';
import {
  readRecoveryInformation,
  type RecoveryInformation,
} from '@/features/settings/lib/readRecoveryInformation';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
jest.mock('@/features/settings/components/ProfileDetailsScreen', () => ({
  ProfileDetailsScreen: 'Details',
}));
jest.mock('@/shared/ui/primitives/Text', () => ({ Text: 'Text' }));
jest.mock('@/shared/ui/primitives/View/VStack', () => ({ VStack: 'View' }));
jest.mock('@/shared/stores/global/profileStore', () => ({
  useProfileStore: (select: (state: unknown) => unknown) =>
    select({
      profiles: [
        {
          pubkey: 'a'.repeat(64),
          accountIndex: 1,
          source: 'imported',
          cachedDisplayName: 'Imported profile',
        },
      ],
    }),
}));
jest.mock('@/features/settings/lib/readRecoveryInformation', () => ({
  readRecoveryInformation: jest.fn(),
}));
jest.mock('nostr-tools/nip19', () => ({ npubEncode: () => 'test-public-placeholder' }));
jest.mock('heroui-native', () => {
  const React = require('react');
  return {
    Button: Object.assign(
      (props: Record<string, unknown>) => React.createElement('Button', props),
      { Label: 'Label' }
    ),
  };
});
function button(screen: TestRenderer.ReactTestRenderer, label: string) {
  return screen.root
    .findAll((node) => String(node.type) === 'Button')
    .find((node) =>
      node
        .findAll((child) => String(child.type) === 'Label')
        .some((child) => child.children.includes(label))
    )!;
}
const information: RecoveryInformation = {
  mnemonic: 'test-root-placeholder',
  nsec: null,
  cashuMnemonic: null,
};

test('reuses Settings fields and discards pending reads after backgrounding', async () => {
  const listener = jest.spyOn(AppState, 'addEventListener').mockReturnValue({ remove: jest.fn() });
  let resolveRead!: (value: RecoveryInformation) => void;
  jest.mocked(readRecoveryInformation).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        resolveRead = resolve;
      })
  );
  let screen!: TestRenderer.ReactTestRenderer;
  void act(() => {
    screen = TestRenderer.create(
      React.createElement(SettingsProfileRecoveryScreen, { onBack: () => {} })
    );
  });
  const details = () => screen.root.findByType(ProfileDetailsScreen).props;
  const onState = listener.mock.calls[0][1];
  expect(details().mnemonic).toBeNull();
  void act(() => onState('background'));
  await act(async () => {
    resolveRead(information);
  });
  expect(details().mnemonic).toBeNull();
  void act(() => onState('active'));
  expect(details().mnemonic).toBeNull();
  jest.mocked(readRecoveryInformation).mockResolvedValueOnce(information);
  await act(async () => button(screen, 'Reload recovery information').props.onPress());
  expect(details().mnemonic).toBe('test-root-placeholder');
  void act(() => listener.mock.calls.at(-1)![1]('inactive'));
  expect(details().mnemonic).toBeNull();
  void act(() => screen.unmount());
});
test('selecting an imported profile ignores a late result for the previous selection', async () => {
  let resolveRoot!: (value: RecoveryInformation) => void;
  jest.mocked(readRecoveryInformation).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        resolveRoot = resolve;
      })
  );
  jest.mocked(readRecoveryInformation).mockResolvedValueOnce({
    ...information,
    nsec: 'test-imported-placeholder',
    cashuMnemonic: 'test-cashu-placeholder',
  });
  let screen!: TestRenderer.ReactTestRenderer;
  void act(() => {
    screen = TestRenderer.create(
      React.createElement(SettingsProfileRecoveryScreen, { onBack: () => {} })
    );
  });
  await act(async () => button(screen, 'Imported profile').props.onPress());
  const details = () => screen.root.findByType(ProfileDetailsScreen).props;
  expect(details().nostrKeys?.nsec).toBe('test-imported-placeholder');
  await act(async () => resolveRoot(information));
  expect(details().nostrKeys?.nsec).toBe('test-imported-placeholder');
  expect(details().rootOnly).toBe(false);
  void act(() => screen.unmount());
});
