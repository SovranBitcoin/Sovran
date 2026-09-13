import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { SettingsScreen } from '@/features/settings/screens/SettingsScreen';
import { Text, UntranslatedText } from '@/shared/ui/primitives/Text';
import { ListGroup } from 'heroui-native';
import { Section } from '@/shared/ui/composed/Section';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let mockDisplayName = '';
let mockKeys: { pubkey: string; npub: string } | undefined;
let mockDevMode = false;
let mockPendingCount = 0;
let mockPolicy = 'RELAXED';

jest.mock('@/shared/hooks/useProfileDisplay', () => ({
  useProfileDisplay: () => ({ displayName: mockDisplayName }),
}));
jest.mock('@/shared/providers/NostrKeysProvider', () => ({
  useNostrKeysContext: () => ({ keys: mockKeys }),
}));
jest.mock('@/shared/stores/global/settingsStore', () => ({
  useSettingsStore: (select: (state: object) => unknown) => select({ experimental: mockDevMode }),
}));
jest.mock('@/features/feed/stores/notificationPolicyStore', () => ({
  useNotificationPolicyStore: (select: (state: object) => unknown) =>
    select({ policy: mockPolicy }),
}));
jest.mock('@/features/nostrSigner', () => ({
  useNip46RequestsStore: (select: (state: object) => unknown) =>
    select({ pending: Array.from({ length: mockPendingCount }) }),
}));
jest.mock('@/shared/hooks/useGuardedRouter', () => ({ guardedRouter: { navigate: jest.fn() } }));
jest.mock('@/shared/lib/url', () => ({ openExternalUrl: jest.fn() }));
jest.mock('@/shared/lib/cashu/manager', () => ({ CocoManager: { exportDatabase: jest.fn() } }));
jest.mock('@/shared/lib/popup', () => ({ paramPopup: jest.fn() }));
jest.mock('@/shared/lib/logger', () => ({
  useLifecycleLogger: jest.fn(),
  log: { info: jest.fn(), error: jest.fn() },
  walletLog: { info: jest.fn() },
  storeLog: { info: jest.fn(), warn: jest.fn(), debug: jest.fn() },
  redactError: (error: unknown) => error,
}));
jest.mock('@/shared/lib/contentShiftLog', () => ({
  useShiftLogger: () => ({ report: jest.fn() }),
  useVisualLayoutLogger: () => ({}),
  VISUAL_LOGGING_ENABLED: false,
}));
jest.mock('@/shared/lib/color', () => ({ withAlpha: (color: string) => color }));
jest.mock('@/shared/hooks/useThemeColor', () => ({ useThemeColor: () => 'rgb(128, 128, 128)' }));
jest.mock('@react-native-masked-view/masked-view', () => ({ __esModule: true, default: 'View' }));
jest.mock('expo-linear-gradient', () => ({ LinearGradient: 'View' }));
jest.mock('@/shared/ui/primitives/Avatar', () => ({ Avatar: () => null }));
jest.mock('@/shared/ui/primitives/Pressable', () => ({ Pressable: 'Pressable' }));
jest.mock('@/shared/ui/primitives/View/View', () => ({ View: 'View' }));
jest.mock('@/shared/ui/primitives/View/VStack', () => ({ VStack: 'View' }));
// Inspect the first CONTENT commit, after Screen's one permitted mount gate.
// Any second deferred gate must still be closed in this test.
jest.mock('@/shared/ui/composed/Screen', () => ({
  Screen: ({ children }: { children: React.ReactNode }) => children,
}));
jest.mock('@/shared/hooks/useDeferredMount', () => ({ useDeferredMount: () => false }));
jest.mock('heroui-native', () => {
  const React = jest.requireActual('react');
  const host = (name: string) =>
    function MockHost(props: object) {
      return React.createElement(name, props);
    };
  return {
    ListGroup: Object.assign(host('ListGroup'), {
      Item: host('Item'),
      ItemPrefix: host('Prefix'),
      ItemContent: host('Content'),
      ItemTitle: host('Title'),
      ItemDescription: host('Description'),
      ItemSuffix: host('Suffix'),
    }),
    PressableFeedback: Object.assign(host('Pressable'), {
      Scale: host('Scale'),
      Ripple: () => null,
    }),
    Separator: () => null,
    Switch: host('Switch'),
  };
});

let tree: TestRenderer.ReactTestRenderer;
function render() {
  act(() => {
    tree = TestRenderer.create(<SettingsScreen />);
  });
}
function control(testID: string) {
  return tree.root.find((node) => typeof node.type === 'string' && node.props.testID === testID);
}
function profileText() {
  return control('settings-profile-row').findAllByType(Text);
}
beforeEach(() => {
  mockDisplayName = '';
  mockKeys = undefined;
  mockDevMode = false;
  mockPendingCount = 0;
  mockPolicy = 'RELAXED';
});
afterEach(() => act(() => tree?.unmount()));

it.each([false, true])(
  'mounts lower sections in the first content commit (developer: %s)',
  (dev) => {
    mockDevMode = dev;
    render();
    expect(tree.root.findAllByType(Section).map((section) => section.props.title)).toEqual([
      'Account',
      'Preferences',
      'App Information',
      'Security',
      'Privacy',
      'Legal',
      ...(dev ? ['Developer'] : []),
      'Danger Zone',
    ]);
    expect(control('settings-version-row')).toBeTruthy();
  }
);

it('reserves two single-line profile placeholders and replaces them with resolved content', () => {
  render();
  expect(profileText()).toHaveLength(2);
  for (const line of profileText()) {
    expect(line.props.loading).toBe(true);
    expect(line.props.placeholder.length).toBeGreaterThan(0);
    expect(line.props.numberOfLines).toBe(1);
    expect(line.props.accessible).toBe(false);
    // Exercise the real Text primitive: its hidden sizing text is nonempty.
    expect(line.findByType(UntranslatedText).props.children).toBe(line.props.placeholder);
  }
  const metrics = profileText().map(({ props }) => [
    props.size,
    props.className,
    props.numberOfLines,
  ]);
  mockKeys = { pubkey: 'public-profile', npub: 'npub1publicprofileplaceholder' };
  mockDisplayName = 'Example Profile';
  act(() => tree.update(<SettingsScreen />));
  expect(
    profileText().map(({ props }) => [props.size, props.className, props.numberOfLines])
  ).toEqual(metrics);
  expect(profileText().every((line) => line.props.loading === false)).toBe(true);
  expect(profileText()[0].props.children).toBe('Example Profile');
  expect(profileText()[1].props.children).toBeTruthy();
});

it('keeps live descriptions mounted and single-line as stores settle and requests clear', () => {
  render();
  const descriptions = () =>
    ['settings-remote-login-row', 'settings-notifications-row'].map((id) =>
      control(id).findByType(ListGroup.ItemDescription)
    );
  const initial = descriptions();
  for (const [count, policy] of [
    [1, 'MODERATE'],
    [12, 'STRICT'],
    [0, 'FOLLOWS'],
  ] as const) {
    mockPendingCount = count;
    mockPolicy = policy;
    act(() => tree.update(<SettingsScreen />));
    descriptions().forEach((line, index) => {
      expect(line).toBe(initial[index]);
      expect(line.props.numberOfLines).toBe(1);
      expect(line.props.children).toBeTruthy();
    });
  }
  expect(descriptions()[0].props.children).toBe('Sign in to Nostr apps with this device');
  expect(descriptions()[1].props.children).toBe('Follows');
});
