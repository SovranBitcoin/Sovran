/**
 * @jest-environment node
 *
 * Characterization of the P2PK keyring screen's key imports: what reaches the
 * wallet keyring for a valid, invalid or failing "Import Private Key", how the
 * import sheet is closed, the single-flight guard on the header button, and
 * "Use Current Nostr Key". The wallet keyring, the action-menu host, the toast
 * popups, the router header and the UI kit are replaced.
 */

import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import * as nip19 from 'nostr-tools/nip19';
import { getPublicKey } from 'nostr-tools/pure';
import { hexToBytes } from '@noble/hashes/utils.js';

import { SettingsKeyringScreen } from '@/features/settings/screens/SettingsKeyringScreen';
import { actionMenuPopup, staticPopup } from '@/shared/lib/popup';

type MenuConfig = {
  primaryAction: {
    onPress: (
      values: { key: string },
      helpers: { setError: (message: string) => void; close: () => void }
    ) => Promise<void>;
  };
  onDismiss: () => void;
};

const mockKeyring = {
  getAllKeyPairs: jest.fn(),
  addKeyPair: jest.fn(),
  generateKeyPair: jest.fn(),
};
const mockNostrPrivateKey = hexToBytes('22'.repeat(32));

const mockManager = { keyring: mockKeyring };

// One manager object, as the provider gives: the screen reloads keys when it changes.
jest.mock('@cashu/coco-react', () => ({ useManager: () => mockManager }));
jest.mock('@/shared/providers/NostrKeysProvider', () => ({
  useNostrKeysContext: () => ({ keys: { privateKey: mockNostrPrivateKey }, isReady: true }),
}));
jest.mock('@/shared/lib/popup', () => ({
  actionMenuPopup: jest.fn(),
  staticPopup: jest.fn(),
  copyPopup: jest.fn(),
}));
// The header is rendered in place so its buttons can be pressed.
jest.mock('expo-router', () => ({
  Stack: {
    Screen: ({ options }: { options: { headerRight?: () => React.ReactNode } }) =>
      options.headerRight?.() ?? null,
  },
}));
jest.mock('expo-router/react-navigation', () => ({
  useNavigationState: (select: (state: { index: number }) => unknown) => select({ index: 1 }),
}));
jest.mock('@/navigation/headerItems', () => ({
  withGlassHeaderItems: (options: unknown) => options,
}));
jest.mock('@/shared/hooks/useGuardedRouter', () => ({
  guardedRouter: { back: jest.fn(), navigate: jest.fn() },
}));
jest.mock('@/shared/ui/composed/ScreenHeaderAction', () => {
  const ReactActual = jest.requireActual<typeof import('react')>('react');
  return {
    ScreenHeaderAction: (props: Record<string, unknown>) =>
      ReactActual.createElement('HeaderAction', props),
  };
});
jest.mock('heroui-native', () => {
  const ReactActual = jest.requireActual<typeof import('react')>('react');
  const host =
    (name: string) =>
    ({ children, ...props }: { children?: React.ReactNode }) =>
      ReactActual.createElement(name, props, children);
  return {
    Button: Object.assign(host('Button'), { Label: host('ButtonLabel') }),
    ListGroup: Object.assign(host('ListGroup'), {
      Item: host('ListItem'),
      ItemContent: host('ListItemContent'),
      ItemTitle: host('ListItemTitle'),
      ItemDescription: host('ListItemDescription'),
      ItemSuffix: host('ListItemSuffix'),
    }),
    PressableFeedback: Object.assign(host('PressableFeedback'), { Highlight: host('Highlight') }),
    Separator: host('Separator'),
    Switch: host('Switch'),
  };
});
jest.mock('@/shared/ui/composed/Screen', () => ({
  Screen: ({ children }: { children?: React.ReactNode }) => children,
}));
jest.mock('@/shared/ui/composed/Section', () => ({
  Section: ({ children }: { children?: React.ReactNode }) => children,
}));
jest.mock('@/shared/ui/composed/UnderlineTabs', () => ({ UnderlineTabs: () => null }));
jest.mock('@/shared/blocks/status', () => ({ LoadingIndicator: () => null }));
jest.mock('@/shared/lib/e2e/E2EAccessibilityProbe', () => ({ E2EAccessibilityProbe: () => null }));
jest.mock('react-native-qrcode-svg', () => ({ __esModule: true, default: () => null }));
jest.mock('assets/icons', () => ({ __esModule: true, default: () => null }));
jest.mock('@/shared/hooks/useThemeColor', () => {
  const { INVARIANT_BLACK } = jest.requireActual<typeof import('@/shared/lib/brandColors')>(
    '@/shared/lib/brandColors'
  );
  return {
    useThemeColor: (tokens: string | string[]) =>
      Array.isArray(tokens) ? tokens.map(() => INVARIANT_BLACK) : INVARIANT_BLACK,
  };
});
jest.mock('@/shared/stores/global/settingsStore', () => ({
  useSettingsStore: (select: (state: Record<string, unknown>) => unknown) =>
    select({ regenerateP2PKOnReceive: true, setRegenerateP2PKOnReceive: () => undefined }),
}));

const mockedMenu = jest.mocked(actionMenuPopup);
const mockedStaticPopup = jest.mocked(staticPopup);

const SECRET_HEX = '11'.repeat(32);
const SECRET_NSEC = nip19.nsecEncode(hexToBytes(SECRET_HEX));
const CURRENT_P2PK = `02${getPublicKey(mockNostrPrivateKey)}`;

let renderer: TestRenderer.ReactTestRenderer;

async function mount(): Promise<void> {
  await act(async () => {
    renderer = TestRenderer.create(<SettingsKeyringScreen />);
  });
}

function press(testID: string): void {
  const node = renderer.root.find((n) => n.props.testID === testID && n.props.onPress);
  (node.props.onPress as () => void)();
}

function lastMenu(): MenuConfig {
  return mockedMenu.mock.calls.at(-1)![0] as unknown as MenuConfig;
}

async function openImportAndSubmit(key: string) {
  await act(async () => press('keyring-import-trigger'));
  const helpers = { setError: jest.fn(), close: jest.fn() };
  await act(async () => lastMenu().primaryAction.onPress({ key }, helpers));
  return helpers;
}

beforeEach(() => {
  for (const level of ['debug', 'info', 'warn', 'error', 'log'] as const) {
    jest.spyOn(console, level).mockImplementation(() => undefined);
  }
  jest.clearAllMocks();
  mockKeyring.getAllKeyPairs.mockResolvedValue([]);
  mockKeyring.addKeyPair.mockImplementation(async () => ({ publicKeyHex: `02${'ab'.repeat(32)}` }));
});

afterEach(() => {
  act(() => renderer?.unmount());
  jest.restoreAllMocks();
});

describe('keyring import', () => {
  it('adds a valid hex key once, confirms, reloads the list and closes the sheet', async () => {
    await mount();
    expect(mockKeyring.getAllKeyPairs).toHaveBeenCalledTimes(1);

    const helpers = await openImportAndSubmit(`  ${SECRET_HEX}  `);

    expect(mockKeyring.addKeyPair).toHaveBeenCalledTimes(1);
    expect(mockedStaticPopup).toHaveBeenCalledWith('key-imported');
    expect(mockKeyring.getAllKeyPairs).toHaveBeenCalledTimes(2);
    expect(helpers.setError).not.toHaveBeenCalled();
    expect(helpers.close).toHaveBeenCalledTimes(1);
  });

  it('adds the same secret for an nsec as for its hex form', async () => {
    await mount();
    await openImportAndSubmit(SECRET_HEX);
    await openImportAndSubmit(SECRET_NSEC);

    expect(mockKeyring.addKeyPair).toHaveBeenCalledTimes(2);
    expect(mockKeyring.addKeyPair.mock.calls[1][0]).toEqual(
      mockKeyring.addKeyPair.mock.calls[0][0]
    );
  });

  it('writes nothing for an invalid key, sets an error, and closes the sheet anyway', async () => {
    await mount();

    const helpers = await openImportAndSubmit('not a key');

    expect(mockKeyring.addKeyPair).not.toHaveBeenCalled();
    expect(helpers.setError).toHaveBeenCalledWith('Enter nsec or 64-character hex key.');
    // QUIRK: the `finally` closes the sheet right after the error is set, so the person never
    // sees why nothing was imported (settings-onboarding-routes D4). A fix that keeps the sheet
    // open on invalid input should change this assertion on purpose.
    expect(helpers.close).toHaveBeenCalledTimes(1);
    expect(mockedStaticPopup).not.toHaveBeenCalled();
  });

  it('shows the failure popup and closes the sheet when the keyring refuses the key', async () => {
    await mount();
    mockKeyring.addKeyPair.mockRejectedValueOnce(new Error('secure store unavailable'));

    const helpers = await openImportAndSubmit(SECRET_HEX);

    expect(mockedStaticPopup).toHaveBeenCalledWith('key-import-failed');
    expect(helpers.close).toHaveBeenCalledTimes(1);
  });

  it('opens one import sheet for a double tap and another once the first is dismissed', async () => {
    await mount();

    await act(async () => {
      press('keyring-import-trigger');
      press('keyring-import-trigger');
    });
    expect(mockedMenu).toHaveBeenCalledTimes(1);

    await act(async () => lastMenu().onDismiss());
    await act(async () => press('keyring-import-trigger'));
    expect(mockedMenu).toHaveBeenCalledTimes(2);
  });

  it('opens a new import sheet after a submit, without a dismiss', async () => {
    await mount();
    await openImportAndSubmit(SECRET_HEX);

    await act(async () => press('keyring-import-trigger'));

    expect(mockedMenu).toHaveBeenCalledTimes(2);
  });

  it('adds the current Nostr key when the keyring does not hold it', async () => {
    await mount();

    await act(async () => press('keyring-import-current-nsec'));

    expect(mockKeyring.addKeyPair).toHaveBeenCalledTimes(1);
    expect(mockKeyring.addKeyPair).toHaveBeenCalledWith(mockNostrPrivateKey);
    expect(mockedStaticPopup).toHaveBeenCalledWith('key-imported', {
      text: 'Your active Nostr key can now receive P2PK-locked ecash.',
    });
  });

  it('writes nothing when the current Nostr key is already in the keyring', async () => {
    mockKeyring.getAllKeyPairs.mockResolvedValue([{ publicKeyHex: CURRENT_P2PK }]);
    await mount();

    await act(async () => press('keyring-import-current-nsec'));

    expect(mockKeyring.addKeyPair).not.toHaveBeenCalled();
    expect(mockedStaticPopup).toHaveBeenCalledWith('key-imported', {
      text: 'Your active Nostr key is already available for P2PK-locked ecash.',
    });
  });
});
