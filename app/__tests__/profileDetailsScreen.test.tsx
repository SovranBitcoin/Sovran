import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { AppState } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { ProfileDetailsScreen } from '@/features/settings/components/ProfileDetailsScreen';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
jest.mock('@/shared/ui/composed/Screen', () => ({ Screen: 'Screen' }));
jest.mock('@/shared/ui/primitives/Text', () => ({ Text: 'Text' }));
jest.mock('@/shared/ui/primitives/View/View', () => ({ View: 'View' }));
jest.mock('@/shared/ui/primitives/Avatar', () => ({ Avatar: 'Avatar' }));
jest.mock('assets/icons', () => 'Icon');
jest.mock('@/shared/hooks/useThemeColor', () => ({ useThemeColor: () => 'white' }));
jest.mock('@/shared/lib/color', () => ({ withAlpha: (value: string) => value }));
jest.mock('@/shared/lib/popup', () => ({ copyPopup: jest.fn() }));
jest.mock('@/shared/lib/logger', () => ({ log: { info: jest.fn(), debug: jest.fn() } }));
jest.mock('@/shared/lib/nostr/keyDerivation', () => ({ pubkeyToAccountNumber: jest.fn() }));
jest.mock('expo-clipboard', () => ({ setStringAsync: jest.fn().mockResolvedValue(undefined) }));
jest.mock('heroui-native', () => {
  const React = require('react');
  const host = (name: string) =>
    function MockHost(props: Record<string, unknown>) {
      return React.createElement(name, props);
    };
  return {
    Button: Object.assign(host('Button'), { Label: 'Label' }),
    Card: Object.assign(host('Card'), { Body: 'Body', Title: 'Title', Description: 'Description' }),
    Input: 'Input',
    Label: 'Label',
    Description: 'Description',
    TextField: 'TextField',
  };
});

test('shared Settings recovery fields mask before reveal, hide on background, and preserve explicit copy', async () => {
  const listener = jest.spyOn(AppState, 'addEventListener').mockReturnValue({ remove: jest.fn() });
  let screen!: TestRenderer.ReactTestRenderer;
  void act(() => {
    screen = TestRenderer.create(
      React.createElement(ProfileDetailsScreen, {
        mnemonic: 'test-root-placeholder',
        nostrKeys: null,
        cashuMnemonic: null,
        username: 'Root recovery phrase',
        rootOnly: true,
      })
    );
  });
  const input = () => screen.root.findAll((node) => String(node.type) === 'Input')[0];
  const reveal = () =>
    screen.root.findAll(
      (node) => String(node.type) === 'Button' && node.props.testID === 'profile-reveal-mnemonic'
    )[0];
  expect(input().props.value).not.toBe('test-root-placeholder');
  expect(input().props.testID).toBe('profile-secret-value-mnemonic');
  void act(() => reveal().props.onPress());
  expect(input().props.value).toBe('test-root-placeholder');
  void act(() => listener.mock.calls[0][1]('inactive'));
  expect(input().props.value).not.toBe('test-root-placeholder');
  void act(() => listener.mock.calls[0][1]('active'));
  expect(input().props.value).not.toBe('test-root-placeholder');
  const copy = screen.root
    .findAll((node) => String(node.type) === 'Button')
    .find((node) =>
      node
        .findAll((child) => String(child.type) === 'Label')
        .some((child) => child.children.includes('Copy'))
    )!;
  await act(async () => copy.props.onPress());
  expect(Clipboard.setStringAsync).toHaveBeenCalledWith('test-root-placeholder');
  void act(() => screen.unmount());
});
