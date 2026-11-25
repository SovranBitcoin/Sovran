import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { SettingsScreen } from '@/features/settings/screens/SettingsScreen';
import { Text, UntranslatedText } from '@/shared/ui/primitives/Text';
import { Section } from '@/shared/ui/composed/Section';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
// These isolated screen tests omit the app's SafeAreaProvider.
// This suite covers every settings row, so it runs as the `full` edition.
jest.mock('@/shared/config/features', () => ({
  ...jest.requireActual('@/shared/config/features'),
  hasFeature: () => true,
}));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 24, bottom: 34, left: 0, right: 0 }),
}));
let mockDisplayName = '';
let mockKeys: { pubkey: string; npub: string } | undefined;
let mockDevMode = false;
let mockInProcessProfileSwitch = false;
const mockSetInProcessProfileSwitch = jest.fn();
let mockPolicy = 'RELAXED';

jest.mock('@/shared/hooks/useProfileDisplay', () => ({
  useProfileDisplay: () => ({ displayName: mockDisplayName }),
}));
jest.mock('@/shared/providers/NostrKeysProvider', () => ({
  useNostrKeysContext: () => ({ keys: mockKeys }),
}));
jest.mock('@/shared/stores/global/settingsStore', () => ({
  useSettingsStore: (select: (state: object) => unknown) =>
    select({
      experimental: mockDevMode,
      inProcessProfileSwitch: mockInProcessProfileSwitch,
      setInProcessProfileSwitch: mockSetInProcessProfileSwitch,
    }),
}));
jest.mock('@/shared/stores/profile/notificationPolicyStore', () => ({
  useNotificationPolicyStore: (select: (state: object) => unknown) =>
    select({ policy: mockPolicy }),
}));
jest.mock('@/shared/hooks/useGuardedRouter', () => ({ guardedRouter: { navigate: jest.fn() } }));
jest.mock('@/shared/lib/url', () => ({
  openExternalUrl: jest.fn(),
  urlHostLabel: jest.requireActual('@/shared/lib/url').urlHostLabel,
}));
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
jest.mock('@/shared/lib/color', () => ({
  ...jest.requireActual('@/shared/lib/color'),
  withAlpha: (color: string) => color,
}));
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
  mockInProcessProfileSwitch = false;
  mockSetInProcessProfileSwitch.mockClear();
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

it('exposes profile switching as a checked switch and toggles in both directions', () => {
  mockDevMode = true;
  render();
  const toggle = () => control('settings-in-process-profile-switch-toggle');
  expect(toggle().props.accessible).toBe(true);
  expect(toggle().props.accessibilityRole).toBe('switch');
  expect(toggle().props.accessibilityLabel).toBe('Switch profiles without restart');
  expect(toggle().props.accessibilityState).toEqual({ checked: false });
  act(() => {
    toggle().props.onPress();
  });
  expect(mockSetInProcessProfileSwitch).toHaveBeenLastCalledWith(true);

  mockInProcessProfileSwitch = true;
  act(() => tree.update(<SettingsScreen />));
  expect(toggle().props.accessibilityState).toEqual({ checked: true });
  act(() => {
    toggle().props.onPress();
  });
  expect(mockSetInProcessProfileSwitch).toHaveBeenLastCalledWith(false);
});

it('no longer lists Moderation or Uploaded media', () => {
  mockDevMode = true;
  render();
  const ids = tree.root
    .findAll((node) => typeof node.type === 'string' && typeof node.props.testID === 'string')
    .map((node) => node.props.testID as string);
  expect(ids).not.toContain('settings-moderation-row');
  expect(ids).not.toContain('settings-media-row');
  expect(JSON.stringify(tree.toJSON())).not.toContain('Uploaded media');
});

it('keeps Swap routing, under Developer only', () => {
  const routingSection = () =>
    tree.root
      .findAllByType(Section)
      .find(
        (section) =>
          section.findAll((node) => node.props.testID === 'settings-routing-row').length > 0
      )?.props.title;

  render();
  expect(routingSection()).toBeUndefined();
  act(() => tree.unmount());

  mockDevMode = true;
  render();
  expect(routingSection()).toBe('Developer');
});
