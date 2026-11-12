/**
 * @jest-environment node
 *
 * Characterization of a recovery run on SettingsRecoveryScreen from the swipe to
 * each end state, beyond what settingsRecoveryGateConfirmation.test.tsx pins:
 * the writes to the wallet (trust, untrust, stale mint operations), the popups
 * outside gate mode, the timeout path (F178), and which control is left in each
 * end state. Coco and the mint list are replaced; the recovery bookkeeping, the
 * keyset predicates and the timeout are real.
 */

import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { ok } from 'neverthrow';

import { SettingsRecoveryScreen } from '@/features/settings/screens/SettingsRecoveryScreen';
import { discoverMints } from '@/shared/lib/apiClient';
import { deleteMintOperation, probeMintForHistory } from '@/shared/lib/cashu/managerInternals';
import { paramPopup, staticPopup } from '@/shared/lib/popup';
import { cashuLog } from '@/shared/lib/logger';
import { guardedRouter } from '@/shared/hooks/useGuardedRouter';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 24, bottom: 34, left: 0, right: 0 }),
}));

const MINT_A = 'https://a.example';
const MINT_B = 'https://b.example';
const KEYSET_1 = '00988fbe749ca4d1';

const mockSliderMounts = { count: 0 };
let mockMints: { mintUrl: string; mintInfo: { name: string } }[] = [];
const mockLoadMints = jest.fn(async () => undefined);
const mockAddMint = jest.fn();
const mockUntrustMint = jest.fn(async (_url: string) => undefined);
const mockRestoreKeyset = jest.fn();
const mockBalancesByMint = jest.fn(async (_q: { mintUrls: string[] }) => ({}));
const mockListPending = jest.fn(async (): Promise<{ id: string; mintUrl: string }[]> => []);
const mockGetInstance = jest.fn(() => ({
  wallet: { balances: { byMint: mockBalancesByMint } },
  mint: { addMint: mockAddMint, untrustMint: mockUntrustMint },
  ops: { mint: { listPending: mockListPending } },
}));

jest.mock('@/features/mint', () => ({
  useMintManagement: () => ({ mints: mockMints, loadMints: mockLoadMints }),
}));
jest.mock('@/shared/lib/cashu/manager', () => ({
  CocoManager: { getInstance: () => mockGetInstance() },
}));
jest.mock('@/shared/lib/cashu/managerInternals', () => ({
  ...jest.requireActual<typeof import('@/shared/lib/cashu/managerInternals')>(
    '@/shared/lib/cashu/managerInternals'
  ),
  deleteMintOperation: jest.fn(async () => undefined),
  restoreKeysetForMint: (...args: unknown[]) => mockRestoreKeyset(...args),
  probeMintForHistory: jest.fn(async () => false),
}));
jest.mock('@/shared/stores/global/walletLifecycleStore', () => ({
  useWalletLifecycleStore: (selector: (s: unknown) => unknown) =>
    selector({ setRestoreStatus: jest.fn() }),
}));
jest.mock('@cashu/coco-react', () => ({
  useBalanceContext: () => ({ balances: { byMint: {} } }),
}));
jest.mock('@sovranbitcoin/schemas', () => ({
  MintListResponse: {},
  parseWith: jest.fn(() => jest.fn()),
}));
jest.mock('@/shared/lib/apiClient', () => ({ discoverMints: jest.fn() }));
jest.mock('@/shared/lib/logger', () => ({
  cashuLog: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
  mintUrlLogFields: jest.fn(() => ({ mintHost: 'mint.example', mintHash: 'mock-hash' })),
  redactError: (e: unknown) => e,
  useLifecycleLogger: jest.fn(),
}));
// Reanimated's useFrameCallback has no UI thread under @jest-environment node.
jest.mock('@/shared/ui/composed/ElapsedSeconds', () => ({ ElapsedSeconds: () => null }));

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
    SlideToConfirm: ({
      onConfirm,
      testID,
    }: {
      onConfirm: () => Promise<void>;
      testID?: string;
    }) => {
      // The real slider stays spent after one swipe until it is mounted again.
      ReactActual.useEffect(() => {
        mockSliderMounts.count += 1;
      }, []);
      return ReactActual.createElement('MockSlideToConfirm', { testID, onConfirm });
    },
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

jest.mock('@/shared/ui/primitives/Button', () => ({ Button: 'MockButton' }));
jest.mock('@/shared/ui/composed/Surface', () => {
  const ReactActual = jest.requireActual<typeof import('react')>('react');
  return {
    Surface: ({ children }: React.PropsWithChildren) =>
      ReactActual.createElement('MockSurface', null, children),
  };
});
jest.mock('heroui-native', () => {
  const ReactActual = jest.requireActual<typeof import('react')>('react');
  const Button = Object.assign(
    ({
      children,
      ...props
    }: React.PropsWithChildren<{
      onPress?: () => void;
      testID?: string;
      isDisabled?: boolean;
    }>) => ReactActual.createElement('MockButton', props, children),
    {
      Label: ({ children }: React.PropsWithChildren) =>
        ReactActual.createElement('MockButtonLabel', null, children),
    }
  );
  return {
    Button,
    Switch: (props: Record<string, unknown>) => ReactActual.createElement('MockSwitch', props),
  };
});

type Renderer = TestRenderer.ReactTestRenderer;

function texts(renderer: Renderer): unknown[] {
  return renderer.root
    .findAll((node) => node.type === ('MockText' as unknown))
    .map((node) => node.props.children);
}

function byTestId(renderer: Renderer, testID: string) {
  return renderer.root.findAll(
    (node) => node.props.testID === testID && typeof node.type === 'string'
  );
}

/** Each known mint advertises the given keysets; restore succeeds unless a case says otherwise. */
function mintsServe(keysets: Record<string, string[]>) {
  mockAddMint.mockImplementation(async (url: string) => ({
    mint: { mintUrl: url },
    keysets: (keysets[url] ?? [KEYSET_1]).map((id) => ({ id, unit: 'sat' })),
  }));
}

async function mount(props: React.ComponentProps<typeof SettingsRecoveryScreen> = {}) {
  let renderer: Renderer;
  await act(async () => {
    renderer = TestRenderer.create(<SettingsRecoveryScreen {...props} />);
  });
  return renderer!;
}

async function swipe(renderer: Renderer) {
  await act(async () => {
    await byTestId(renderer, 'recovery-swipe')[0]!.props.onConfirm();
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockSliderMounts.count = 0;
  mockMints = [
    { mintUrl: MINT_A, mintInfo: { name: 'Mint A' } },
    { mintUrl: MINT_B, mintInfo: { name: 'Mint B' } },
  ];
  mockAddMint.mockReset();
  mintsServe({});
  mockRestoreKeyset.mockReset();
  mockRestoreKeyset.mockResolvedValue(undefined);
  mockBalancesByMint.mockResolvedValue({});
  mockListPending.mockResolvedValue([]);
});

afterEach(() => {
  jest.useRealTimers();
});

describe('a recovery run from Settings', () => {
  it('restores each mint in turn, clears stale mint operations, refreshes and offers Close', async () => {
    mockListPending.mockResolvedValue([
      { id: 'op-1', mintUrl: MINT_A },
      { id: 'op-2', mintUrl: MINT_B },
    ]);
    const renderer = await mount();

    await swipe(renderer);

    expect(mockAddMint.mock.calls).toEqual([
      [MINT_A, { trusted: true }],
      [MINT_B, { trusted: true }],
    ]);
    expect(jest.mocked(deleteMintOperation).mock.calls.map((call) => call[1])).toEqual([
      'op-1',
      'op-2',
    ]);
    expect(mockUntrustMint).not.toHaveBeenCalled();
    expect(mockLoadMints).toHaveBeenCalledTimes(1);
    expect(paramPopup).toHaveBeenCalledWith('recovery-success', {
      mintCount: 2,
      durationSec: expect.any(String),
    });
    expect(texts(renderer)).toContain('Recovery Complete');

    const close = byTestId(renderer, 'recovery-continue')[0]!;
    expect(close.props.text).toBe('Close');
    close.props.onPress();
    expect(guardedRouter.back).toHaveBeenCalledTimes(1);
  });

  it('pops up a partial result when one known mint fails, and offers a reswipe and Close', async () => {
    mockRestoreKeyset.mockImplementation(async (_m: unknown, { mintUrl }: { mintUrl: string }) => {
      if (mintUrl === MINT_B) throw new Error('mint offline');
    });
    const renderer = await mount();

    await swipe(renderer);

    expect(paramPopup).toHaveBeenCalledWith('recovery-partial', {
      successCount: 1,
      failureCount: 1,
    });
    expect(texts(renderer)).toContain('Recovery Partial');
    expect(byTestId(renderer, 'recovery-swipe')).toHaveLength(1);
    expect(byTestId(renderer, 'recovery-close')).toHaveLength(1);
  });

  it('pops up a failure when every known mint fails', async () => {
    mockAddMint.mockRejectedValue(new Error('unreachable'));
    const renderer = await mount();

    await swipe(renderer);

    expect(staticPopup).toHaveBeenCalledWith('recovery-failed');
    expect(texts(renderer)).toContain('Recovery Failed');
  });

  it('shows the error and pops it up when the wallet cannot be opened', async () => {
    mockGetInstance.mockImplementationOnce(() => {
      throw new Error('wallet closed');
    });
    const renderer = await mount();

    await swipe(renderer);

    expect(staticPopup).toHaveBeenCalledWith('recovery-failed', { text: expect.any(String) });
    expect(texts(renderer)).toContain('Recovery Failed');
    expect(mockAddMint).not.toHaveBeenCalled();
  });

  it('pops up "No mints found" and leaves the same slider in place when there is nothing to search', async () => {
    mockMints = [];
    const renderer = await mount();
    expect(mockSliderMounts.count).toBe(1);

    await swipe(renderer);

    expect(staticPopup).toHaveBeenCalledWith('recovery-failed', {
      text: 'No mints found to recover from. Add a mint first.',
    });
    expect(texts(renderer)).toContain('Recover ecash');
    // QUIRK (F178): the slider is not mounted again, so the real one stays spent after
    // this swipe; only toggling "Search all mints" or leaving the page re-arms it.
    expect(mockSliderMounts.count).toBe(1);
    expect(mockGetInstance).not.toHaveBeenCalled();
  });
});

describe('a search across discovered mints', () => {
  it('untrusts every discovered mint that held no funds, and keeps the one that did', async () => {
    mockMints = [{ mintUrl: MINT_A, mintInfo: { name: 'Mint A' } }];
    const HIT_EMPTY = 'https://hit-empty.example';
    const HIT_FUNDED = 'https://hit-funded.example';
    const MISS = 'https://miss.example';
    jest.mocked(discoverMints).mockResolvedValue(
      ok({
        mints: [HIT_EMPTY, HIT_FUNDED, MISS].map((mintUrl) => ({
          mintUrl,
          hasAudit: true,
          state: 'OK',
          averageScore: null,
          reviewCount: 0,
        })),
      }) as never
    );
    jest.mocked(probeMintForHistory).mockImplementation(async (_m, url) => url !== MISS);
    mockBalancesByMint.mockImplementation(async ({ mintUrls }) =>
      mintUrls[0] === HIT_FUNDED ? { [HIT_FUNDED]: { total: 21 } } : {}
    );
    const renderer = await mount({ gateMode: true, onComplete: jest.fn() });
    await act(async () => {
      byTestId(renderer, 'recovery-search-all-toggle')[0]!.props.onSelectedChange(true);
    });

    await swipe(renderer);

    expect(mockAddMint.mock.calls.map((call) => call[0])).toEqual([MINT_A, HIT_EMPTY, HIT_FUNDED]);
    expect(mockUntrustMint.mock.calls.map((call) => call[0]).sort()).toEqual(
      [HIT_EMPTY, MISS].sort()
    );
    expect(texts(renderer)).toContain('Recovery Complete');
    // Gate mode keeps its own UI: no popup over the wallet that mounts next.
    expect(paramPopup).not.toHaveBeenCalled();
    expect(staticPopup).not.toHaveBeenCalled();
  });

  it('keeps trusting a discovered mint whose balance could not be read after its restore', async () => {
    mockMints = [];
    const UNREAD = 'https://unread.example';
    jest.mocked(discoverMints).mockResolvedValue(
      ok({
        mints: [
          { mintUrl: UNREAD, hasAudit: true, state: 'OK', averageScore: null, reviewCount: 0 },
        ],
      }) as never
    );
    jest.mocked(probeMintForHistory).mockResolvedValue(true);
    mockBalancesByMint.mockRejectedValue(new Error('database is locked'));
    const renderer = await mount({ gateMode: true, onComplete: jest.fn() });
    await act(async () => {
      byTestId(renderer, 'recovery-search-all-toggle')[0]!.props.onSelectedChange(true);
    });

    await swipe(renderer);

    // The restore may have saved ecash there: an unread balance is not an empty mint.
    expect(mockAddMint.mock.calls.map((call) => call[0])).toEqual([UNREAD]);
    expect(mockUntrustMint).not.toHaveBeenCalled();
  });
});

describe('stopping a run', () => {
  /** Holds the next keyset restore open until the returned release is called. */
  function holdNextKeyset() {
    let release: () => void = () => {};
    mockRestoreKeyset.mockImplementationOnce(
      () => new Promise<undefined>((resolve) => (release = () => resolve(undefined)))
    );
    return () => release();
  }

  async function startHeld(renderer: Renderer) {
    jest.useFakeTimers();
    let ended = false;
    await act(async () => {
      void byTestId(renderer, 'recovery-swipe')[0]!
        .props.onConfirm()
        .then(() => {
          ended = true;
        });
      await jest.advanceTimersByTimeAsync(0);
    });
    return () => ended;
  }

  async function stopAndFinish(renderer: Renderer, release: () => void, ended: () => boolean) {
    await act(async () => {
      byTestId(renderer, 'recovery-stop')[0]!.props.onPress();
    });
    await act(async () => {
      release();
      await jest.advanceTimersByTimeAsync(10);
    });
    expect(ended()).toBe(true);
  }

  it('between keysets, restores none of the rest and skips the later mints', async () => {
    mintsServe({ [MINT_A]: [KEYSET_1, '00107937db0cc865'] });
    mockListPending.mockResolvedValue([
      { id: 'op-a', mintUrl: MINT_A },
      { id: 'op-b', mintUrl: MINT_B },
    ]);
    const release = holdNextKeyset();
    const renderer = await mount();
    const run = await startHeld(renderer);

    await stopAndFinish(renderer, release, run);

    expect(mockRestoreKeyset).toHaveBeenCalledTimes(1);
    expect(mockAddMint.mock.calls.map((call) => call[0])).toEqual([MINT_A]);
    expect(texts(renderer)).toContain('Recovery stopped');
    // Mint A stopped before its second keyset: like mint B, it was not recovered.
    expect(texts(renderer).filter((text) => text === 'Cancelled')).toHaveLength(2);
    expect(byTestId(renderer, 'recovery-swipe')).toHaveLength(1);
    expect(paramPopup).not.toHaveBeenCalled();
    expect(staticPopup).not.toHaveBeenCalled();
    // Neither mint was restored, so a later run still has their pending operations.
    expect(deleteMintOperation).not.toHaveBeenCalled();
  });

  it('keeps trusting a discovered mint the stop cut short once funds were restored there', async () => {
    mockMints = [];
    const FOUND = 'https://found.example';
    jest.mocked(discoverMints).mockResolvedValue(
      ok({
        mints: [
          { mintUrl: FOUND, hasAudit: true, state: 'OK', averageScore: null, reviewCount: 0 },
        ],
      }) as never
    );
    jest.mocked(probeMintForHistory).mockResolvedValue(true);
    mintsServe({ [FOUND]: [KEYSET_1, '00107937db0cc865'] });
    mockBalancesByMint.mockResolvedValue({ [FOUND]: { total: 21 } });
    const release = holdNextKeyset();
    const renderer = await mount();
    await act(async () => {
      byTestId(renderer, 'recovery-search-all-toggle')[0]!.props.onSelectedChange(true);
    });
    const run = await startHeld(renderer);

    await stopAndFinish(renderer, release, run);

    expect(mockRestoreKeyset).toHaveBeenCalledTimes(1);
    expect(texts(renderer)).toContain('Recovery stopped');
    expect(mockUntrustMint).not.toHaveBeenCalled();
  });

  it('while searching discovered mints, asks no further batch and restores nothing', async () => {
    mockMints = [{ mintUrl: MINT_A, mintInfo: { name: 'Mint A' } }];
    const candidates = [1, 2, 3, 4, 5].map((n) => `https://found-${n}.example`);
    jest.mocked(discoverMints).mockResolvedValue(
      ok({
        mints: candidates.map((mintUrl) => ({
          mintUrl,
          hasAudit: true,
          state: 'OK',
          averageScore: null,
          reviewCount: 0,
        })),
      }) as never
    );
    let releaseProbe: () => void = () => {};
    jest.mocked(probeMintForHistory).mockImplementation(
      (_m, url) =>
        new Promise<boolean>((resolve) => {
          if (url === candidates[0]) releaseProbe = () => resolve(true);
          else resolve(false);
        })
    );
    const renderer = await mount();
    await act(async () => {
      byTestId(renderer, 'recovery-search-all-toggle')[0]!.props.onSelectedChange(true);
    });
    const run = await startHeld(renderer);
    expect(texts(renderer)).toContain('Checking 4 of 5 mints');

    await stopAndFinish(renderer, releaseProbe, run);

    expect(jest.mocked(probeMintForHistory).mock.calls.map((call) => call[1])).toEqual(
      candidates.slice(0, 4)
    );
    expect(mockAddMint).not.toHaveBeenCalled();
    expect(texts(renderer)).toContain('Recovery stopped');
    // Every probed mint is untrusted again, the one that held history among them:
    // it was never restored, so no funds were found there.
    expect(mockUntrustMint.mock.calls.map((call) => call[0]).sort()).toEqual(
      candidates.slice(0, 4).sort()
    );
  });
});

describe('the end of a run', () => {
  it('keeps the pending operations of a mint whose restore failed, and deletes those of the one restored', async () => {
    mockAddMint.mockImplementation(async (url: string) => {
      if (url === MINT_B) throw new Error('unreachable');
      return { mint: { mintUrl: url }, keysets: [{ id: KEYSET_1, unit: 'sat' }] };
    });
    mockListPending.mockResolvedValue([
      { id: 'op-a', mintUrl: MINT_A },
      { id: 'op-b', mintUrl: MINT_B },
    ]);
    const renderer = await mount();

    await swipe(renderer);

    expect(texts(renderer)).toContain('Recovery Partial');
    expect(jest.mocked(deleteMintOperation).mock.calls.map((call) => call[1])).toEqual(['op-a']);
  });

  it('keeps the pending operations of a mint whose keysets could not be restored', async () => {
    mintsServe({ [MINT_B]: ['legacy-keyset'] });
    mockListPending.mockResolvedValue([
      { id: 'op-a', mintUrl: MINT_A },
      { id: 'op-b', mintUrl: MINT_B },
    ]);
    const renderer = await mount();

    await swipe(renderer);

    expect(jest.mocked(deleteMintOperation).mock.calls.map((call) => call[1])).toEqual(['op-a']);
  });

  it('keeps an operation that appeared during the run, and one for a mint not in it', async () => {
    mockListPending
      .mockResolvedValueOnce([
        { id: 'op-before', mintUrl: MINT_A },
        { id: 'op-other', mintUrl: 'https://other.example' },
      ])
      .mockResolvedValue([
        { id: 'op-before', mintUrl: MINT_A },
        { id: 'op-other', mintUrl: 'https://other.example' },
        { id: 'op-during', mintUrl: MINT_A },
      ]);
    const renderer = await mount();

    await swipe(renderer);

    expect(texts(renderer)).toContain('Recovery Complete');
    expect(jest.mocked(deleteMintOperation).mock.calls.map((call) => call[1])).toEqual([
      'op-before',
    ]);
  });

  it('carries on when the pending operations cannot be listed, or one cannot be deleted', async () => {
    mockListPending.mockRejectedValueOnce(new Error('database locked'));
    const first = await mount();
    await swipe(first);
    expect(texts(first)).toContain('Recovery Complete');
    expect(deleteMintOperation).not.toHaveBeenCalled();
    expect(mockLoadMints).toHaveBeenCalledTimes(1);

    mockListPending.mockResolvedValue([
      { id: 'op-1', mintUrl: MINT_A },
      { id: 'op-2', mintUrl: MINT_A },
    ]);
    jest.mocked(deleteMintOperation).mockRejectedValueOnce(new Error('busy'));
    const second = await mount();
    await swipe(second);
    expect(jest.mocked(deleteMintOperation).mock.calls.map((call) => call[1])).toEqual([
      'op-1',
      'op-2',
    ]);
    expect(texts(second)).toContain('Recovery Complete');
  });
});

describe('a screen mounted again while a run is going', () => {
  it('starts idle, and its swipe starts nothing', async () => {
    let release: () => void = () => {};
    mockRestoreKeyset.mockImplementationOnce(
      () => new Promise<undefined>((resolve) => (release = () => resolve(undefined)))
    );
    const first = await mount();
    jest.useFakeTimers();
    let run!: Promise<void>;
    await act(async () => {
      run = byTestId(first, 'recovery-swipe')[0]!.props.onConfirm();
      await jest.advanceTimersByTimeAsync(0);
    });
    expect(mockRestoreKeyset).toHaveBeenCalledTimes(1);
    await act(async () => first.unmount());
    mockAddMint.mockClear();

    const second = await mount();
    expect(texts(second)).toContain('Recover ecash');
    await swipe(second);
    expect(mockAddMint).not.toHaveBeenCalled();
    expect(texts(second)).toContain('Recover ecash');

    await act(async () => {
      release();
      await jest.advanceTimersByTimeAsync(10);
      await run;
    });
  });
});

describe('a mint that times out while still restoring', () => {
  const KEYSET_2 = '00107937db0cc865';

  async function advance(ms: number) {
    await act(async () => {
      await jest.advanceTimersByTimeAsync(ms);
    });
    for (let i = 0; i < 5; i += 1) {
      await act(async () => {
        await jest.advanceTimersByTimeAsync(1);
      });
    }
  }

  /**
   * The first keyset of `mint` (mint A unless named) never answers until
   * `finishA`; the run times the mint out after 120 s and ends, while that
   * restore goes on behind it.
   */
  async function runPastTimeout(
    options: { stop?: boolean; gateMode?: boolean; mint?: string; searchAll?: boolean } = {}
  ): Promise<{ renderer: Renderer; finishA: () => void }> {
    jest.useFakeTimers();
    const held = options.mint ?? MINT_A;
    let finishA = () => {};
    mockRestoreKeyset.mockImplementation(
      (_m: unknown, { mintUrl, keysetId }: { mintUrl: string; keysetId: string }) =>
        mintUrl === held && keysetId === KEYSET_1
          ? new Promise<void>((resolve) => {
              finishA = resolve;
            })
          : Promise.resolve()
    );
    const renderer = await mount(options.gateMode ? { gateMode: true, onComplete: jest.fn() } : {});
    if (options.searchAll) {
      await act(async () => {
        byTestId(renderer, 'recovery-search-all-toggle')[0]!.props.onSelectedChange(true);
      });
    }
    let ended = false;
    await act(async () => {
      void byTestId(renderer, 'recovery-swipe')[0]!
        .props.onConfirm()
        .then(() => {
          ended = true;
        });
      await jest.advanceTimersByTimeAsync(0);
    });
    if (options.stop) {
      await act(async () => {
        byTestId(renderer, 'recovery-stop')[0]!.props.onPress();
      });
    }
    await advance(120_000);
    expect(ended).toBe(true);
    return { renderer, finishA: () => finishA() };
  }

  it('after Stop, restores none of its other keysets once its late keyset answers', async () => {
    mintsServe({ [MINT_A]: [KEYSET_1, KEYSET_2] });
    const { renderer, finishA } = await runPastTimeout({ stop: true });
    expect(texts(renderer)).toContain('Recovery stopped');
    expect(mockRestoreKeyset).toHaveBeenCalledTimes(1);

    finishA();
    await advance(0);

    // The stop belongs to the run that was stopped, however late its work.
    expect(mockRestoreKeyset).toHaveBeenCalledTimes(1);
  });

  it('keeps trusting a discovered mint it timed out, and records the funds its late restore found', async () => {
    mockMints = [];
    const FOUND = 'https://found.example';
    jest.mocked(discoverMints).mockResolvedValue(
      ok({
        mints: [
          { mintUrl: FOUND, hasAudit: true, state: 'OK', averageScore: null, reviewCount: 0 },
        ],
      }) as never
    );
    jest.mocked(probeMintForHistory).mockResolvedValue(true);
    const { renderer, finishA } = await runPastTimeout({ mint: FOUND, searchAll: true });
    expect(texts(renderer)).toContain('Timed out');

    // Its outcome is unknown when the run tidies up: it is left trusted.
    expect(mockUntrustMint).not.toHaveBeenCalled();

    mockBalancesByMint.mockResolvedValue({ [FOUND]: { total: 21 } });
    finishA();
    await advance(0);

    // The late restore found funds there; the row still says it timed out.
    expect(mockUntrustMint).not.toHaveBeenCalled();
    expect(texts(renderer)).toContain('Timed out');
  });

  /** A discovered mint, `EMPTY`, whose restore times out; nothing is found there. */
  async function discoveredMintTimesOut() {
    mockMints = [];
    const EMPTY = 'https://empty.example';
    jest.mocked(discoverMints).mockResolvedValue(
      ok({
        mints: [
          { mintUrl: EMPTY, hasAudit: true, state: 'OK', averageScore: null, reviewCount: 0 },
        ],
      }) as never
    );
    jest.mocked(probeMintForHistory).mockResolvedValue(true);
    const run = await runPastTimeout({ mint: EMPTY, searchAll: true });
    return { ...run, EMPTY };
  }

  it('untrusts a discovered mint it timed out once its late restore finds nothing there', async () => {
    const { renderer, finishA, EMPTY } = await discoveredMintTimesOut();
    // Left trusted while its restore may still find funds, and reported so.
    expect(mockUntrustMint).not.toHaveBeenCalled();
    expect(cashuLog.info).toHaveBeenCalledWith(
      'recovery.cleanup.timed_out_mints_left_trusted',
      expect.objectContaining({ count: 1 })
    );

    finishA();
    await advance(0);

    // What the tidy-up would have done had it known: the run that trusted it untrusts it.
    expect(mockUntrustMint.mock.calls.map((call) => call[0])).toEqual([EMPTY]);
    expect(texts(renderer)).toContain('Timed out');
  });

  it('keeps trusting a discovered mint it timed out when its late balance cannot be read', async () => {
    const { finishA } = await discoveredMintTimesOut();

    mockBalancesByMint.mockRejectedValue(new Error('database is locked'));
    finishA();
    await advance(0);

    // Its late restore may have saved ecash there: unknown is not empty.
    expect(mockUntrustMint).not.toHaveBeenCalled();
  });

  it('keeps trusting a discovered mint it timed out when another run has started since', async () => {
    const { finishA } = await discoveredMintTimesOut();
    // The mint is trusted now, so the next run restores it as one of its own.
    mockMints = [{ mintUrl: 'https://empty.example', mintInfo: { name: 'Empty' } }];
    mockRestoreKeyset.mockImplementation(() => Promise.resolve());
    const next = await mount();
    await act(async () => {
      void byTestId(next, 'recovery-swipe')[0]!.props.onConfirm();
      await jest.advanceTimersByTimeAsync(0);
    });

    finishA();
    await advance(0);

    expect(mockUntrustMint).not.toHaveBeenCalled();
  });

  it('keeps trusting a discovered mint it timed out while its late result never comes', async () => {
    await discoveredMintTimesOut();
    await advance(600_000);
    expect(mockUntrustMint).not.toHaveBeenCalled();
  });
});

describe('forced recovery at startup', () => {
  it('shows no popups and no way on when every mint was skipped', async () => {
    mintsServe({ [MINT_A]: ['legacy-keyset'], [MINT_B]: ['legacy-keyset'] });
    const onComplete = jest.fn();
    const renderer = await mount({ gateMode: true, onComplete });

    await swipe(renderer);

    expect(texts(renderer)).toContain('Recovery Complete');
    expect(paramPopup).not.toHaveBeenCalled();
    // QUIRK (F178): the complete view offers only a disabled Continue: no reswipe, no
    // cancel, no close. The person cannot reach the app from here.
    expect(byTestId(renderer, 'recovery-continue')[0]!.props.disabled).toBe(true);
    expect(byTestId(renderer, 'recovery-swipe')).toHaveLength(0);
    expect(byTestId(renderer, 'recovery-stop')).toHaveLength(0);
    expect(byTestId(renderer, 'recovery-close')).toHaveLength(0);
    expect(byTestId(renderer, 'recovery-cancel')).toHaveLength(0);
  });

  /** Mint A's restore never answers until `finishA`; the run times it out after 120 s. */
  async function runPastTimeout() {
    jest.useFakeTimers();
    const held = { finishA: () => undefined as void };
    mockRestoreKeyset.mockImplementation((_m: unknown, { mintUrl }: { mintUrl: string }) =>
      mintUrl === MINT_A
        ? new Promise<void>((resolve) => {
            held.finishA = resolve;
          })
        : Promise.resolve()
    );
    const renderer = await mount({ gateMode: true, onComplete: jest.fn() });
    let ended = false;
    await act(async () => {
      void byTestId(renderer, 'recovery-swipe')[0]!
        .props.onConfirm()
        .then(() => {
          ended = true;
        });
      await jest.advanceTimersByTimeAsync(0);
    });
    expect(mockAddMint.mock.calls.map((call) => call[0])).toEqual([MINT_A]);
    await advance(120_000);
    expect(ended).toBe(true);
    return { renderer, held };
  }

  async function advance(ms: number) {
    await act(async () => {
      await jest.advanceTimersByTimeAsync(ms);
    });
    for (let i = 0; i < 5; i += 1) {
      await act(async () => {
        await jest.advanceTimersByTimeAsync(1);
      });
    }
  }

  it('times out a mint that never answers, moves on, and keeps it timed out when its late result comes', async () => {
    const { renderer, held } = await runPastTimeout();

    expect(mockAddMint.mock.calls.map((call) => call[0])).toEqual([MINT_A, MINT_B]);
    expect(texts(renderer)).toContain('Recovery Partial');
    expect(texts(renderer)).toContain('Timed out');
    expect(texts(renderer)).toContain('Recovered from 1 mint, but 1 failed.');

    held.finishA();
    await advance(0);

    // The timeout cancelled nothing, so the orphaned restore still finishes after the run
    // has ended (F178), but a mint's outcome is final: its row stays timed out.
    expect(texts(renderer)).toContain('Timed out');
    expect(texts(renderer)).toContain('Recovered from 1 mint, but 1 failed.');
    // A known mint was trusted before the run: its late result, empty, untrusts nothing.
    expect(mockUntrustMint).not.toHaveBeenCalled();
  });

  it('keeps the pending operations of a mint that timed out', async () => {
    mockListPending.mockResolvedValue([
      { id: 'op-a', mintUrl: MINT_A },
      { id: 'op-b', mintUrl: MINT_B },
    ]);
    await runPastTimeout();

    expect(jest.mocked(deleteMintOperation).mock.calls.map((call) => call[1])).toEqual(['op-b']);
  });

  it('accepts a reswipe while the timed-out restore is still running', async () => {
    const { renderer } = await runPastTimeout();
    mockAddMint.mockClear();

    await act(async () => {
      void byTestId(renderer, 'recovery-swipe')[0]!.props.onConfirm();
      await jest.advanceTimersByTimeAsync(0);
    });

    // QUIRK (F178): the single-run guard was released when the run ended, so a second
    // restore of mint A starts beside the first.
    expect(mockAddMint.mock.calls.map((call) => call[0])).toEqual([MINT_A]);
  });
});
