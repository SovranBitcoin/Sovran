/**
 * @jest-environment node
 */

import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';

import { SettingsRecoveryScreen } from '@/features/settings/screens/SettingsRecoveryScreen';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const MINT_URL = 'https://mint.sovran.money';
// Real NUT-02 v1 ids — the screen now skips keysets whose id is not 16 or 66
// hex chars, because the native CDK creator rejects those outright.
const KEYSET_A = '00988fbe749ca4d1';
const KEYSET_B = '00107937db0cc865';
const mockMints = [{ mintUrl: MINT_URL, mintInfo: { name: 'Sovran Mint' } }];
const mockLoadMints = jest.fn(async () => undefined);
const mockAddMint = jest.fn(async () => ({
  mint: { mintUrl: MINT_URL },
  keysets: [
    { id: KEYSET_A, unit: 'sat' },
    { id: KEYSET_B, unit: 'sat' },
  ],
}));
const mockRestoreKeyset = jest.fn(async () => undefined);
const mockBalancesByMint = jest.fn(async () => ({ [MINT_URL]: { total: 0 } }));
const mockListPending = jest.fn(async () => []);
const mockSetRestoreStatus = jest.fn();

jest.mock('@/features/mint', () => ({
  useMintManagement: () => ({ mints: mockMints, loadMints: mockLoadMints }),
}));

jest.mock('@/shared/lib/cashu/manager', () => ({
  CocoManager: {
    getInstance: () => ({
      wallet: { balances: { byMint: mockBalancesByMint } },
      mint: { addMint: mockAddMint, untrustMint: jest.fn(async () => undefined) },
      ops: { mint: { listPending: mockListPending } },
    }),
  },
}));

jest.mock('@/shared/lib/cashu/managerInternals', () => ({
  // Keep the pure predicates real so the test exercises the actual NUT-02
  // validation and error classification rather than a stub of them.
  ...jest.requireActual<typeof import('@/shared/lib/cashu/managerInternals')>(
    '@/shared/lib/cashu/managerInternals'
  ),
  deleteMintOperation: jest.fn(async () => undefined),
  restoreKeysetForMint: (...args: unknown[]) => mockRestoreKeyset(...(args as [])),
  probeMintForHistory: jest.fn(async () => false),
}));

jest.mock('@/shared/stores/global/walletLifecycleStore', () => ({
  useWalletLifecycleStore: (selector: (s: unknown) => unknown) =>
    selector({ setRestoreStatus: mockSetRestoreStatus }),
}));

// Reanimated's useFrameCallback has no UI thread under @jest-environment node.
jest.mock('@/shared/ui/composed/ElapsedSeconds', () => ({ ElapsedSeconds: () => null }));

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
jest.mock('@/shared/lib/color', () => ({
  ...jest.requireActual('@/shared/lib/color'),
  withAlpha: (color: string) => color,
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
jest.mock('@/shared/blocks/status', () => ({
  LoadingIndicator: () => null,
  // Real mapper — the rows render through the same checkpoint vocabulary the
  // payment timeline uses, and stubbing it would hide a bad status mapping.
  mapCheckpointStatusToIndicator: jest.requireActual<
    typeof import('@/shared/blocks/status/mapCheckpointStatus')
  >('@/shared/blocks/status/mapCheckpointStatus').mapCheckpointStatusToIndicator,
}));
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
    // clearAllMocks does not drop implementations, so a persistent
    // mockRejectedValue in one test would silently leak into the next.
    mockRestoreKeyset.mockReset();
    mockRestoreKeyset.mockResolvedValue(undefined);
    mockAddMint.mockReset();
    mockAddMint.mockResolvedValue({
      mint: { mintUrl: MINT_URL },
      keysets: [
        { id: KEYSET_A, unit: 'sat' },
        { id: KEYSET_B, unit: 'sat' },
      ],
    });
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

    // Every keyset the mint advertises is restored individually — that is what
    // makes per-keyset progress and per-keyset failure reporting possible.
    expect(mockAddMint).toHaveBeenCalledWith(MINT_URL, { trusted: true });
    expect(mockRestoreKeyset).toHaveBeenCalledTimes(2);
    expect(mockRestoreKeyset).toHaveBeenCalledWith(
      expect.anything(),
      MINT_URL,
      KEYSET_A,
      'sat',
      expect.objectContaining({ ready: expect.any(Number), spent: expect.any(Number) })
    );
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

  it('never writes restoreStatus itself — only the gate owns that flag', async () => {
    // Writing 'in-progress' here once pinned users to the recovery gate on
    // every launch: AppGate blocks on that value and a Settings-initiated run
    // has nothing that clears it afterwards.
    let renderer: TestRenderer.ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(<SettingsRecoveryScreen gateMode onComplete={jest.fn()} />);
    });
    await act(async () => {
      await renderer!.root.findByProps({ testID: 'start-recovery' }).props.onConfirm();
    });

    expect(mockSetRestoreStatus).not.toHaveBeenCalled();
  });

  it('reports a mint as failed when one of its keysets fails', async () => {
    mockRestoreKeyset.mockRejectedValueOnce(new Error('mint offline'));

    let renderer: TestRenderer.ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(<SettingsRecoveryScreen gateMode onComplete={jest.fn()} />);
    });
    await act(async () => {
      await renderer!.root.findByProps({ testID: 'start-recovery' }).props.onConfirm();
    });

    // A failed known mint must NOT report as a clean recovery. This used to be
    // written as `success: true` unconditionally, which made the whole error
    // state unreachable.
    const texts = renderer!.root
      .findAll((node) => node.type === ('MockText' as unknown))
      .map((node) => node.props.children);
    expect(texts).not.toContain('Recovery Complete');
    expect(texts).toContain('Recovery Failed');
  });

  it('treats already-present proofs as recovered, so a second run is not a failure', async () => {
    // Exactly what coco throws when every restored proof is already stored.
    mockRestoreKeyset.mockRejectedValue(
      new Error('Proof with secret already exists: 038a8dbbaa1708e0')
    );

    let renderer: TestRenderer.ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(<SettingsRecoveryScreen gateMode onComplete={jest.fn()} />);
    });
    await act(async () => {
      await renderer!.root.findByProps({ testID: 'start-recovery' }).props.onConfirm();
    });

    const texts = renderer!.root
      .findAll((node) => node.type === ('MockText' as unknown))
      .map((node) => node.props.children);
    expect(texts).toContain('Recovery Complete');
    expect(texts).not.toContain('Recovery Failed');
  });

  it('skips keysets whose id is not a NUT-02 id instead of failing the mint', async () => {
    // The shape mint.minibits.cash actually serves alongside real ones.
    const mixedKeysets = {
      mint: { mintUrl: MINT_URL },
      keysets: [
        { id: KEYSET_A, unit: 'sat' },
        { id: '9mlfd5vCzgGl', unit: 'sat' },
      ],
    };
    mockAddMint.mockResolvedValueOnce(mixedKeysets);

    let renderer: TestRenderer.ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(<SettingsRecoveryScreen gateMode onComplete={jest.fn()} />);
    });
    await act(async () => {
      await renderer!.root.findByProps({ testID: 'start-recovery' }).props.onConfirm();
    });

    // Only the valid keyset is attempted, and the mint still succeeds.
    expect(mockRestoreKeyset).toHaveBeenCalledTimes(1);
    expect(mockRestoreKeyset).toHaveBeenCalledWith(
      expect.anything(),
      MINT_URL,
      KEYSET_A,
      'sat',
      expect.objectContaining({ ready: expect.any(Number), spent: expect.any(Number) })
    );
    const texts = renderer!.root
      .findAll((node) => node.type === ('MockText' as unknown))
      .map((node) => node.props.children);
    expect(texts).toContain('Recovery Complete');
  });

  it('refuses to start a second recovery while one is already running', async () => {
    // Hold the first run open so the second swipe lands mid-flight.
    let releaseFirst: () => void = () => {};
    mockRestoreKeyset.mockImplementationOnce(
      () => new Promise<undefined>((resolve) => (releaseFirst = () => resolve(undefined)))
    );

    let renderer: TestRenderer.ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(<SettingsRecoveryScreen gateMode onComplete={jest.fn()} />);
    });

    const start = renderer!.root.findByProps({ testID: 'start-recovery' }).props
      .onConfirm as () => Promise<void>;
    let first: Promise<void>;
    await act(async () => {
      first = start();
      await Promise.resolve();
    });

    mockAddMint.mockClear();
    // A second swipe — this is what happened on-device when the screen
    // remounted, and it ran a whole second recovery concurrently.
    await act(async () => {
      await start();
    });
    expect(mockAddMint).not.toHaveBeenCalled();

    await act(async () => {
      releaseFirst();
      await first!;
    });
  });
});
