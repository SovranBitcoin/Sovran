/**
 * @jest-environment node
 *
 * The P2PK keyring screen's contrast: the active key's Copy and Show QR sit on
 * a `bg-default` pill inside a `bg-surface-secondary` card, so their icons and
 * labels use the foreground (as the "Add" pill does), never `muted`. The empty
 * state's key icon uses `muted`, not the `default` background token. Each
 * theme token resolves to its own colour so the test can tell them apart.
 */

import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';

import { SettingsKeyringScreen } from '@/features/settings/screens/SettingsKeyringScreen';
import { withAlpha } from '@/shared/lib/color';
import {
  BITCOIN_ACCENT,
  BLUETOOTH_ACCENT,
  CONNECTED_ACCENT,
  INVARIANT_BLACK,
} from '@/shared/lib/brandColors';

// Any distinct hex colours will do: `withAlpha` needs hex, and these are the
// ones the lint rule allows by name.
const TOKENS: Record<string, string> = {
  foreground: BLUETOOTH_ACCENT,
  muted: CONNECTED_ACCENT,
  default: BITCOIN_ACCENT,
};
const tokenColor = (token: string) => TOKENS[token] ?? INVARIANT_BLACK;

const mockKeyring = {
  getAllKeyPairs: jest.fn(),
  addKeyPair: jest.fn(),
  generateKeyPair: jest.fn(),
};
const mockManager = { keyring: mockKeyring };

jest.mock('@cashu/coco-react', () => ({ useManager: () => mockManager }));
jest.mock('@/shared/providers/NostrKeysProvider', () => ({
  useNostrKeysContext: () => ({ keys: null, isReady: false }),
}));
jest.mock('@/shared/lib/popup', () => ({
  actionMenuPopup: jest.fn(),
  staticPopup: jest.fn(),
  copyPopup: jest.fn(),
}));
jest.mock('expo-router', () => ({ Stack: { Screen: () => null } }));
jest.mock('expo-router/react-navigation', () => ({
  useNavigationState: (select: (state: { index: number }) => unknown) => select({ index: 1 }),
}));
jest.mock('@/navigation/headerItems', () => ({
  withGlassHeaderItems: (options: unknown) => options,
}));
jest.mock('@/shared/hooks/useGuardedRouter', () => ({
  guardedRouter: { back: jest.fn(), navigate: jest.fn() },
}));
jest.mock('@/shared/ui/composed/ScreenHeaderAction', () => ({ ScreenHeaderAction: () => null }));
jest.mock('@/shared/ui/composed/Screen', () => ({
  Screen: ({ children }: { children?: React.ReactNode }) => children,
}));
jest.mock('@/shared/ui/composed/Section', () => ({
  Section: ({ children }: { children?: React.ReactNode }) => children,
}));
jest.mock('@/shared/ui/composed/UnderlineTabs', () => ({ UnderlineTabs: () => null }));
jest.mock('@/shared/blocks/status', () => ({ LoadingIndicator: () => null }));
jest.mock('@/shared/lib/e2e/E2EAccessibilityProbe', () => ({ E2EAccessibilityProbe: () => null }));
jest.mock('assets/icons', () => {
  const ReactActual = jest.requireActual<typeof import('react')>('react');
  return {
    __esModule: true,
    default: (props: { name: string; color?: string }) => ReactActual.createElement('Icon', props),
  };
});
jest.mock('@/shared/hooks/useThemeColor', () => ({
  useThemeColor: (tokens: string | string[]) =>
    Array.isArray(tokens) ? tokens.map(tokenColor) : tokenColor(tokens),
}));
jest.mock('@/shared/stores/global/settingsStore', () => ({
  useSettingsStore: (select: (state: Record<string, unknown>) => unknown) =>
    select({ regenerateP2PKOnReceive: true, setRegenerateP2PKOnReceive: () => undefined }),
}));

const P2PK = `02${'ab'.repeat(32)}`;

async function mount(keys: unknown[]): Promise<TestRenderer.ReactTestRenderer> {
  mockKeyring.getAllKeyPairs.mockResolvedValue(keys);
  let renderer!: TestRenderer.ReactTestRenderer;
  await act(async () => {
    renderer = TestRenderer.create(<SettingsKeyringScreen />);
  });
  return renderer;
}

function iconInside(renderer: TestRenderer.ReactTestRenderer, testID: string, name: string) {
  const button = renderer.root.find((n) => n.props.testID === testID && n.props.onPress);
  return button.find((n) => (n.type as unknown) === 'Icon' && n.props.name === name);
}

function labelInside(renderer: TestRenderer.ReactTestRenderer, testID: string, text: string) {
  const button = renderer.root.find((n) => n.props.testID === testID && n.props.onPress);
  return button.find((n) => typeof n.type === 'function' && n.props.children === text);
}

beforeEach(() => jest.clearAllMocks());

describe('keyring contrast', () => {
  it('paints Copy and Show QR in the foreground, never muted', async () => {
    const renderer = await mount([{ publicKeyHex: P2PK, derivationIndex: 0 }]);

    expect(iconInside(renderer, 'keyring-active-copy', 'lets-icons:copy').props.color).toBe(
      TOKENS.foreground
    );
    expect(iconInside(renderer, 'keyring-active-show-qr', 'stash:qr-code').props.color).toBe(
      TOKENS.foreground
    );
    for (const [id, text] of [
      ['keyring-active-copy', 'Copy'],
      ['keyring-active-show-qr', 'Show QR'],
    ] as const) {
      const label = labelInside(renderer, id, text);
      expect(label.props.className).toContain('text-foreground');
      expect(label.props.style).toBeUndefined();
    }
  });

  it('draws the empty state key in high-contrast foreground alpha, not the default background colour', async () => {
    const renderer = await mount([]);
    const icon = renderer.root.find(
      (n) => (n.type as unknown) === 'Icon' && n.props.name === 'mdi:key-variant'
    );
    expect(icon.props.color).toBe(withAlpha(TOKENS.foreground, 0.65));
    expect(icon.props.color).not.toBe(TOKENS.default);
  });
});
