/** @jest-environment node */
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { ReceiveUnifiedTab } from '@/features/receive/components/ReceiveUnifiedTab';
import { PaymentInfo } from '@/shared/blocks/PaymentInfo';
import { deriveBip321RailSelection } from '@/features/receive/lib/bip321RailSelection';
import { setStringAsync } from 'expo-clipboard';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mockQuote = jest.fn();
jest.mock('@/features/receive/components/OnchainDepositLimitsCard', () => ({
  OnchainDepositLimitsCard: () => null,
}));
jest.mock('wallet/react', () => ({
  useReusableMintQuote: (...args: unknown[]) => mockQuote(...args),
}));
jest.mock('@/features/receive/lib/standingQuoteIdentityStore', () => ({
  standingQuoteIdentityStore: {},
}));
jest.mock('@/shared/lib/logger', () => ({ paymentLog: { info: jest.fn(), warn: jest.fn() } }));
jest.mock('expo-clipboard', () => ({ setStringAsync: jest.fn() }));
jest.mock('@/shared/lib/popup', () => ({ copyPopup: jest.fn(), paramPopup: jest.fn() }));
jest.mock('@/shared/ui/primitives/Haptics', () => ({ EnhancedHaptics: { copyHaptic: jest.fn() } }));
jest.mock('@/shared/lib/strings', () => ({ truncateMiddle: (value: string) => value }));
jest.mock('@/shared/hooks/useThemeColor', () => ({
  useThemeColor: (tokens: string | string[]) =>
    Array.isArray(tokens)
      ? tokens
      : jest.requireActual<typeof import('@/shared/lib/brandColors')>('@/shared/lib/brandColors')
          .INVARIANT_WHITE,
}));
jest.mock('uniwind', () => ({ withUniwind: (component: unknown) => component }));
jest.mock('@/assets/icons', () => ({ __esModule: true, default: () => null }));
jest.mock('assets/icons', () => ({
  __esModule: true,
  default: () => null,
  CurrencyIcon: () => null,
}));
// The unified tab keeps its rails card mounted while loading and
// draws the junk QR placeholder above it; the placeholder's worklet layers are
// covered by qrPlaceholderFrames.test — here it only needs to mount.
jest.mock('@/shared/ui/composed/QRCodeFrame', () => ({
  ...jest.requireActual<typeof import('@/shared/ui/composed/QRCodeFrame')>(
    '@/shared/ui/composed/QRCodeFrame'
  ),
  PaymentQRCodePlaceholder: (props: Record<string, unknown>) =>
    jest
      .requireActual<typeof import('react')>('react')
      .createElement('PaymentQRCodePlaceholder', props),
}));
jest.mock('@/shared/blocks/PaymentInfo', () => ({ PaymentInfo: () => null }));
jest.mock('@/features/receive/components/ReceiveRailPlaceholder', () => ({
  ReceiveRailPlaceholder: () => null,
}));
jest.mock('@/shared/ui/primitives/View/View', () => ({ View: 'View' }));
jest.mock('@/shared/ui/primitives/Text', () => ({ Text: 'Text' }));
jest.mock('@/shared/ui/composed/GradientCard', () => ({ GradientCard: 'GradientCard' }));
jest.mock('@/shared/ui/composed/Section', () => ({ Section: 'Section' }));
jest.mock('@/shared/ui/composed/CapsuleButton', () => ({ CapsuleButton: 'CapsuleButton' }));
jest.mock('heroui-native', () => {
  const ReactActual = jest.requireActual<typeof import('react')>('react');
  const host =
    (name: string) =>
    ({ children, ...props }: React.PropsWithChildren<Record<string, unknown>>) =>
      ReactActual.createElement(name, props, children);
  return {
    ListGroup: Object.assign(host('ListGroup'), {
      Item: host('Item'),
      ItemPrefix: host('Prefix'),
      ItemContent: host('Content'),
      ItemSuffix: host('Suffix'),
      ItemTitle: host('Title'),
      ItemDescription: host('Description'),
    }),
    PressableFeedback: Object.assign(host('Pressable'), {
      Scale: host('Scale'),
      Ripple: () => null,
    }),
    Separator: () => null,
    Switch: host('Switch'),
  };
});

const allAvailable = { onchain: true, bolt12: true, creq: true };
function props(available = allAvailable): React.ComponentProps<typeof ReceiveUnifiedTab> {
  return {
    unit: 'sat',
    muted: 'muted',
    bip321: {
      selection: deriveBip321RailSelection({ available }),
      onchainMint: 'https://mint.example',
      bolt12Mint: 'https://mint.example',
    },
    creq: {
      request: {
        operationId: 'fixture',
        encodedRequest: 'creqAfixture',
        encodedRequestB: 'creqBfixture',
        mints: ['https://mint.example'],
        unit: 'sat',
      },
      isLoading: false,
      error: null,
      rotate: jest.fn(),
    },
    onQrPayload: jest.fn(),
  };
}

describe('Unified rails and payload', () => {
  let renderer: TestRenderer.ReactTestRenderer;
  // The disabled hook deliberately retains a result: a real hook can keep its
  // previous quote until its null-input effect runs. The tab must mask it.
  beforeEach(() => {
    jest.clearAllMocks();
    mockQuote.mockImplementation((input: { method: string } | null) => ({
      quote: { request: input?.method === 'onchain' ? 'bc1fixture' : 'lnofixture' },
      isLoading: false,
      error: null,
    }));
  });
  afterEach(() => {
    if (renderer) act(() => renderer.unmount());
  });
  const control = (id: string) =>
    renderer.root.findAllByProps({ testID: id }).find((node) => typeof node.type === 'string')!;
  const qr = () => renderer.root.findByType(PaymentInfo).props.data as string;

  it('lists every rail with its own copy row, each copying just its value', async () => {
    const input = props();
    act(() => {
      renderer = TestRenderer.create(<ReceiveUnifiedTab {...input} />);
    });
    expect(qr()).toBe('bitcoin:bc1fixture?lno=lnofixture&creq=creqBfixture');
    expect(qr()).not.toContain('lightning=');
    expect(input.onQrPayload).toHaveBeenLastCalledWith({ value: qr(), copyTarget: 'bip321' });
    expect(control('receive-unified-rails-state').props.accessibilityValue.text).toBe(
      'onchain:1,bolt12:1,creq:1'
    );
    // No switches or Advanced section any more.
    expect(
      renderer.root.findAllByProps({ testID: 'receive-unified-advanced-toggle' })
    ).toHaveLength(0);
    // First row: the whole bitcoin: link, the QR's own payload.
    await act(async () => control('receive-unified-copy').props.onPress());
    expect(setStringAsync).toHaveBeenLastCalledWith(qr());
    await act(async () => control('receive-unified-copy-onchain').props.onPress());
    expect(setStringAsync).toHaveBeenLastCalledWith('bc1fixture');
    await act(async () => control('receive-unified-copy-bolt12').props.onPress());
    expect(setStringAsync).toHaveBeenLastCalledWith('lnofixture');
    // The Cashu row copies what the Cashu tab copies (creqA), while the URI
    // carries the same request as creqB.
    await act(async () => control('receive-unified-copy-creq').props.onPress());
    expect(setStringAsync).toHaveBeenLastCalledWith('creqAfixture');
  });

  it('keeps an unavailable rail listed with its reason and out of the QR', () => {
    const input = props({ ...allAvailable, bolt12: false });
    input.bip321.selection.rails[1].reason = 'No trusted mint supports BOLT 12 for sat';
    act(() => {
      renderer = TestRenderer.create(<ReceiveUnifiedTab {...input} />);
    });
    expect(qr()).toBe('bitcoin:bc1fixture?creq=creqBfixture');
    expect(mockQuote).toHaveBeenCalledWith(null, {});
    expect(control('receive-unified-unavailable-bolt12')).toBeDefined();
    expect(renderer.root.findAllByProps({ testID: 'receive-unified-copy-bolt12' })).toHaveLength(0);
    expect(JSON.stringify(renderer.toJSON())).toContain(input.bip321.selection.rails[1].reason);
    expect(control('receive-unified-rails-state').props.accessibilityValue.text).toBe(
      'onchain:1,bolt12:0,creq:1'
    );
  });

  it('holds the first QR until an enabled request settles', () => {
    const input = props();
    input.creq = { ...input.creq, request: null, isLoading: true };
    act(() => {
      renderer = TestRenderer.create(<ReceiveUnifiedTab {...input} />);
    });
    expect(renderer.root.findAllByType(PaymentInfo)).toHaveLength(0);
    expect(input.onQrPayload).toHaveBeenLastCalledWith(null);
    act(() => renderer.update(<ReceiveUnifiedTab {...props()} />));
    expect(qr()).toContain('creq=creqBfixture');
  });

  it('does not label a failed quote as included', () => {
    const input = props({ onchain: true, bolt12: false, creq: false });
    mockQuote.mockReturnValue({ quote: null, isLoading: false, error: 'private upstream detail' });
    act(() => {
      renderer = TestRenderer.create(<ReceiveUnifiedTab {...input} />);
    });
    expect(renderer.root.findAllByType(PaymentInfo)).toHaveLength(0);
    expect(control('receive-unified-rails-state').props.accessibilityValue.text).toBe(
      'onchain:0,bolt12:0,creq:0'
    );
    expect(JSON.stringify(renderer.toJSON())).not.toContain('private upstream detail');
  });
});
