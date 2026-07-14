/**
 * @jest-environment node
 */

import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';

import { SettingsRecoveryScreen } from '@/features/settings/screens/SettingsRecoveryScreen';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const MINT_URL = 'https://mint.sovran.money';
const mockMints = [{ mintUrl: MINT_URL, mintInfo: { name: 'Sovran Mint' } }];
const mockLoadMints = jest.fn(async () => undefined);
const mockRestore = jest.fn(async () => undefined);
const mockBalancesByMint = jest.fn(async () => ({ [MINT_URL]: { total: 0 } }));
const mockListPending = jest.fn(async () => []);

jest.mock('@/features/mint', () => ({
  useMintManagement: () => ({ mints: mockMints, loadMints: mockLoadMints }),
}));

jest.mock('@/shared/lib/cashu/manager', () => ({
  CocoManager: {
    getInstance: () => ({
      wallet: { restore: mockRestore, balances: { byMint: mockBalancesByMint } },
      mint: { untrustMint: jest.fn(async () => undefined) },
      ops: { mint: { listPending: mockListPending } },
    }),
  },
}));

jest.mock('@/shared/lib/cashu/managerInternals', () => ({
  deleteMintOperation: jest.fn(async () => undefined),
}));

jest.mock('@cashu/coco-react', () => ({
  useBalanceContext: () => ({ balances: { byMint: { [MINT_URL]: { total: 0 } } } }),
}));

jest.mock('@sovranbitcoin/schemas', () => ({
  MintListResponse: {},
  parseWith: jest.fn(() => jest.fn()),
}));

jest.mock('@/shared/lib/apiClient', () => ({ fetchJson: jest.fn() }));
jest.mock('@/shared/lib/logger', () => ({
  cashuLog: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
  useLifecycleLogger: jest.fn(),
}));
jest.mock('@/shared/hooks/useThemeColor', () => ({
  useThemeColor: (tokens: string | readonly string[]) =>
    typeof tokens === 'string' ? 'white' : tokens.map(() => 'white'),
}));
jest.mock('@/shared/hooks/useGuardedRouter', () => ({ guardedRouter: { back: jest.fn() } }));
jest.mock('@/navigation/headerItems', () => ({ clearGlassHeaderLeftItems: jest.fn(() => ({})) }));
jest.mock('expo-router', () => ({
  useNavigation: () => ({ setOptions: jest.fn(), addListener: jest.fn(() => jest.fn()) }),
}));
jest.mock('@/shared/lib/popup', () => ({ staticPopup: jest.fn(), paramPopup: jest.fn() }));
jest.mock('hex-color-opacity', () => ({
  __esModule: true,
  default: (color: string) => color,
}));

jest.mock('@/shared/ui/composed/SlideToConfirm', () => {
  const ReactActual = jest.requireActual<typeof import('react')>('react');
  return {
    SlideToConfirm: ({ onConfirm }: { onConfirm: () => Promise<void> }) =>
      ReactActual.createElement('MockSlideToConfirm', {
        testID: 'start-recovery',
        onConfirm,
      }),
  };
});
jest.mock('@/shared/ui/composed/Screen', () => ({
  Screen: ({ children }: React.PropsWithChildren) => children,
}));
jest.mock('@/shared/ui/primitives/Text', () => {
  const ReactActual = jest.requireActual<typeof import('react')>('react');
  return {
    Text: ({ children }: React.PropsWithChildren) =>
      ReactActual.createElement('MockText', null, children),
  };
});
jest.mock('@/shared/ui/primitives/View/VStack', () => {
  const ReactActual = jest.requireActual<typeof import('react')>('react');
  return {
    VStack: ({ children }: React.PropsWithChildren) =>
      ReactActual.createElement('MockVStack', null, children),
  };
});
jest.mock('@/shared/ui/primitives/View/HStack', () => {
  const ReactActual = jest.requireActual<typeof import('react')>('react');
  return {
    HStack: ({ children }: React.PropsWithChildren) =>
      ReactActual.createElement('MockHStack', null, children),
  };
});
jest.mock('@/shared/ui/primitives/View/View', () => {
  const ReactActual = jest.requireActual<typeof import('react')>('react');
  return {
    View: ({ children }: React.PropsWithChildren) =>
      ReactActual.createElement('MockView', null, children),
  };
});
jest.mock('@/shared/ui/composed/MintIcon', () => ({ MintIcon: () => null }));
jest.mock('@/shared/blocks/status', () => ({ LoadingIndicator: () => null }));
jest.mock('assets/icons', () => ({ __esModule: true, default: () => null }));

jest.mock('heroui-native', () => {
  const ReactActual = jest.requireActual<typeof import('react')>('react');
  const Button = Object.assign(
    ({ children, onPress }: React.PropsWithChildren<{ onPress?: () => void }>) =>
      ReactActual.createElement('MockButton', { onPress }, children),
    {
      Label: ({ children }: React.PropsWithChildren) =>
        ReactActual.createElement('MockButtonLabel', null, children),
    }
  );
  const Card = Object.assign(
    ({ children }: React.PropsWithChildren) =>
      ReactActual.createElement('MockCard', null, children),
    {
      Body: ({ children }: React.PropsWithChildren) =>
        ReactActual.createElement('MockCardBody', null, children),
    }
  );
  return { Button, Card, Switch: () => null };
});

describe('SettingsRecoveryScreen gate confirmation', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('keeps Recovery Complete visible until the user presses Continue', async () => {
    const onComplete = jest.fn();
    let renderer: TestRenderer.ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(<SettingsRecoveryScreen gateMode onComplete={onComplete} />);
    });

    await act(async () => {
      await renderer!.root.findByProps({ testID: 'start-recovery' }).props.onConfirm();
    });

    expect(mockRestore).toHaveBeenCalledWith(MINT_URL);
    expect(
      renderer!.root
        .findAll((node) => node.type === ('MockText' as unknown))
        .some((node) => node.props.children === 'Recovery Complete')
    ).toBe(true);
    expect(onComplete).not.toHaveBeenCalled();

    act(() => {
      renderer!.root.find((node) => node.type === ('MockButton' as unknown)).props.onPress();
    });
    expect(onComplete).toHaveBeenCalledTimes(1);
  });
});
