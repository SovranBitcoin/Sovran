/**
 * @jest-environment node
 *
 * What the provider details page shows before it knows anything.
 *
 * It used to show nothing: the accepted-mint list and the model summary are
 * both network reads, and both sections were gated on their own data, so the
 * page opened as a name and an address and then grew two whole sections under
 * the reader's thumb. A placeholder is only worth having if it is the same
 * shape as what replaces it, so these assert the counts and the slots — two
 * mint rows, the two model rows the section always has, and one description
 * line — rather than the fact that "a skeleton rendered".
 *
 * The catalog read is the one with a third outcome. A provider that refuses
 * `/v1/models` never sends a summary, and a placeholder that waits forever is
 * worse than none at all, so the skeleton ends on the failure too.
 */

import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';

import { ProviderInfoScreen } from '@/features/ai/screens/ProviderInfoScreen';
import { fetchNodeInfo, fetchProviderModelSummary } from '@/shared/lib/routstr/providers';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const NODE = 'https://ai.redsh1ft.com';

jest.mock('expo-router', () => ({ Stack: { Screen: 'StackScreen' } }));
jest.mock('expo-clipboard', () => ({ setStringAsync: jest.fn(async () => true) }));
jest.mock('react-native-reanimated', () => ({
  __esModule: true,
  default: { View: 'AnimatedView' },
}));
jest.mock('heroui-native', () => {
  const ReactActual = jest.requireActual<typeof import('react')>('react');
  // A string cannot carry the compound statics (`Object.assign('x', …)` boxes
  // it), so each slot is a component that renders a host node of its own name.
  const host = (name: string) => {
    const Host = (props: Record<string, unknown>) => ReactActual.createElement(name, props);
    Host.displayName = name;
    return Host;
  };
  return {
    ListGroup: Object.assign(host('ListGroup'), {
      Item: host('ListGroupItem'),
      ItemContent: host('ListGroupItemContent'),
      ItemTitle: host('ListGroupItemTitle'),
      ItemDescription: host('ListGroupItemDescription'),
    }),
    PressableFeedback: Object.assign(host('PressableFeedback'), {
      Scale: host('PressableFeedbackScale'),
      Ripple: host('PressableFeedbackRipple'),
    }),
  };
});

jest.mock('@/assets/icons', () => ({ __esModule: true, default: 'Icon' }), { virtual: true });
jest.mock('@/shared/hooks/useGuardedRouter', () => ({
  guardedRouter: { back: jest.fn(), push: jest.fn(), navigate: jest.fn() },
}));
jest.mock('@/shared/hooks/useThemeColor', () => ({
  useThemeColor: (tokens: string | readonly string[]) =>
    Array.isArray(tokens) ? tokens.map((token) => `theme-${token}`) : 'theme',
}));
jest.mock('@/shared/lib/logger', () => ({
  aiLog: { info: jest.fn(), debug: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));
jest.mock('@/shared/lib/popup', () => ({ paramPopup: jest.fn(), staticPopup: jest.fn() }));
jest.mock('@/shared/lib/nav/useRouteParams', () => ({
  useRouteParams: () => ({ providerInfoEntry: JSON.stringify({ nodeBaseUrl: NODE }) }),
}));
jest.mock('@/shared/lib/nav/profileRoutes', () => ({ buildModalProfileHref: () => '/profile' }));
jest.mock('@/shared/lib/routstr/reclaim', () => ({ reclaimRoutstrBalances: jest.fn() }));
jest.mock('@/shared/lib/routstr/providers', () => ({
  fetchNodeInfo: jest.fn(),
  fetchProviderModelSummary: jest.fn(),
  normalizeNodeUrl: (url: string) => url.trim().replace(/\/+$/, ''),
}));
jest.mock('@/shared/lib/routstr/providerHealth', () => ({
  cachedProbe: () => undefined,
  probeProviders: jest.fn(async () => {}),
}));
jest.mock('@cashu/coco-react', () => ({ useBalanceContext: () => ({ balances: { byMint: {} } }) }));
jest.mock('@/shared/lib/cashu/amount', () => ({ amountToNumber: () => 0 }));
jest.mock('@/shared/ui/composed/IdentityHeader', () => ({
  useIdentityHeader: () => ({
    scrollY: { value: 0 },
    headerBand: null,
    headerTitle: () => null,
    contentStyle: {},
    probe: null,
  }),
}));
jest.mock('@/shared/hooks/useNostrProfile', () => ({
  useNostrProfile: () => ({ data: null, isLoading: false }),
}));
jest.mock('@/shared/ui/composed/ContactRow', () => ({
  ContactRow: 'ContactRow',
  nostrIdentity: (pubkey: string) => ({ pubkey }),
}));
jest.mock('@/features/ai/components/ProviderAvatar', () => ({ ProviderAvatar: 'ProviderAvatar' }));
jest.mock('@/features/ai/components/ProviderMintRow', () => {
  const ReactActual = jest.requireActual<typeof import('react')>('react');
  return {
    ProviderMintRow: (props: { mintUrl: string; loading?: boolean }) =>
      ReactActual.createElement('ProviderMintRow', props),
  };
});
jest.mock('@/shared/stores/profile/routstrStore', () => ({
  useRoutstrStore: Object.assign(
    (selector: (s: Record<string, unknown>) => unknown) =>
      selector({ userNodeBaseUrl: null, legacyAccounts: {}, knownProviders: {} }),
    { getState: () => ({ rememberProviders: jest.fn(), setUserNode: jest.fn() }) }
  ),
}));
jest.mock('@/shared/ui/composed/BottomButtons', () => ({ BottomButtons: 'BottomButtons' }));
jest.mock('@/shared/ui/composed/ButtonHandler', () => ({ ButtonHandler: 'ButtonHandler' }));
jest.mock('@/shared/ui/composed/Notice', () => ({ Notice: 'Notice' }));
jest.mock('@/shared/ui/composed/Screen', () => ({ Screen: 'Screen' }));
jest.mock('@/shared/ui/composed/Section', () => ({ Section: 'Section' }));
jest.mock('@/shared/ui/primitives/View/Spacer', () => ({ Spacer: 'Spacer' }));
jest.mock('@/shared/ui/primitives/View/VStack', () => ({ VStack: 'VStack' }));
jest.mock('@/shared/ui/primitives/Text', () => ({ Text: 'Text' }));
// The crossfade's whole contract here is which branch it renders; the fade
// itself is Reanimated's business and has its own tests.
jest.mock('@/shared/ui/composed/SkeletonContentCrossfade', () => ({
  SkeletonContentCrossfade: ({
    loading,
    renderSkeleton,
    renderContent,
  }: {
    loading: boolean;
    renderSkeleton: () => React.ReactNode;
    renderContent: () => React.ReactNode;
  }) => (loading ? renderSkeleton() : renderContent()),
}));

type Node = { type: unknown; props: Record<string, unknown> };

/** Host nodes only: a mocked component and the host it renders both carry the
 *  same props, and counting both would double every row. */
const countOf = (renderer: TestRenderer.ReactTestRenderer, type: string, loading: boolean) =>
  renderer.root.findAll(
    (node) => (node as unknown as Node).type === type && (node.props.loading === true) === loading,
    { deep: true }
  ).length;

const hasTestID = (renderer: TestRenderer.ReactTestRenderer, testID: string) =>
  renderer.root.findAll(
    (node) => typeof (node as unknown as Node).type === 'string' && node.props?.testID === testID,
    { deep: true }
  ).length;

async function open() {
  let renderer!: TestRenderer.ReactTestRenderer;
  await act(async () => {
    renderer = TestRenderer.create(React.createElement(ProviderInfoScreen));
  });
  return renderer;
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('the provider details page while it is still asking', () => {
  it('reserves the accepted-mint list, the model rows and the description line', async () => {
    // Neither read ever answers, so this is the page at its emptiest.
    jest.mocked(fetchNodeInfo).mockReturnValue(new Promise(() => {}));
    jest.mocked(fetchProviderModelSummary).mockReturnValue(new Promise(() => {}));

    const renderer = await open();

    expect(countOf(renderer, 'ProviderMintRow', true)).toBe(2);
    expect(hasTestID(renderer, 'ai-provider-info-description-skeleton')).toBe(1);
    expect(hasTestID(renderer, 'ai-provider-model-count-skeleton')).toBe(1);
    expect(hasTestID(renderer, 'ai-provider-model-e2ee-skeleton')).toBe(1);
    act(() => renderer.unmount());
  });

  it('swaps the placeholder rows for the real ones, one for one', async () => {
    jest.mocked(fetchNodeInfo).mockResolvedValue({
      name: 'redsh1ft',
      description: 'A node serving frontier models',
      mints: ['https://mint.minibits.cash/Bitcoin', 'https://mint.sovran.money'],
    });
    jest.mocked(fetchProviderModelSummary).mockResolvedValue({ count: 582, e2ee: true });

    const renderer = await open();

    expect(countOf(renderer, 'ProviderMintRow', true)).toBe(0);
    expect(countOf(renderer, 'ProviderMintRow', false)).toBe(2);
    expect(hasTestID(renderer, 'ai-provider-info-description-skeleton')).toBe(0);
    expect(hasTestID(renderer, 'ai-provider-model-count-skeleton')).toBe(0);
    act(() => renderer.unmount());
  });

  it('stops waiting when the catalog is never going to answer', async () => {
    jest.mocked(fetchNodeInfo).mockResolvedValue(null);
    // An older node that does not serve `/v1/models` at all.
    jest.mocked(fetchProviderModelSummary).mockResolvedValue(null);

    const renderer = await open();

    expect(hasTestID(renderer, 'ai-provider-model-count-skeleton')).toBe(0);
    expect(countOf(renderer, 'ProviderMintRow', true)).toBe(0);
    act(() => renderer.unmount());
  });
});
