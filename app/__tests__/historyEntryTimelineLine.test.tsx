/**
 * @jest-environment node
 */

import React from 'react';
import { StyleSheet } from 'react-native';
import TestRenderer, { act } from 'react-test-renderer';
import type { HistoryEntry } from '@cashu/coco-core';
import { HistoryEntryTimeline } from '@/features/transactions/components/detail/timeline';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

jest.mock('@/shared/hooks/useThemeColor', () => ({
  useThemeColor: (tokens: string | string[]) =>
    Array.isArray(tokens) ? tokens.map((token) => token) : tokens,
}));

jest.mock('@/shared/lib/version', () => ({
  supportsBlur: () => false,
  supportsLiquidGlass: () => false,
  liquidGlassModifiers: <T,>(...modifiers: T[]) => modifiers,
}));

jest.mock('hex-color-opacity', () => jest.fn((color: string) => color));

jest.mock('@/shared/lib/utils', () => ({
  meltQuoteExpired: () => false,
  getMeltQuoteTimeUntilExpiry: () => null,
  mintHistoryEntryExpired: jest.fn(() => false),
  getMintHistoryEntryTimeUntilExpiry: () => null,
}));

jest.mock('@/shared/lib/date', () => ({
  formatDate: () => '2026-05-22',
}));

jest.mock('@/shared/lib/logger', () => {
  const ReactActual = jest.requireActual<typeof import('react')>('react');
  const logger = {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  };

  return {
    Log: ({ children }: { children?: React.ReactNode }) =>
      ReactActual.createElement(ReactActual.Fragment, null, children),
    log: logger,
    cashuLog: logger,
    paymentLog: logger,
  };
});

jest.mock('@/shared/ui/composed/GradientCard', () => {
  const ReactActual = jest.requireActual<typeof import('react')>('react');
  const { View } = jest.requireActual<typeof import('react-native')>('react-native');

  return {
    GradientCard: ({ children }: { children?: React.ReactNode }) =>
      ReactActual.createElement(View, null, children),
  };
});

jest.mock('@/shared/blocks/status', () => {
  const ReactActual = jest.requireActual<typeof import('react')>('react');
  const { mapCheckpointStatusToIndicator } = jest.requireActual<
    typeof import('@/shared/blocks/status/mapCheckpointStatus')
  >('@/shared/blocks/status/mapCheckpointStatus');

  return {
    LoadingIndicator: (props: {
      phase?: string;
      result?: string;
      confirmationProgress?: unknown;
      segmentedInProgress?: boolean;
      strokeWidthPx?: number;
      pendingColor?: string;
    }) =>
      ReactActual.createElement('LoadingIndicatorMock', {
        testID: `indicator-${props.phase}-${props.result}`,
        confirmationProgress: props.confirmationProgress,
        segmentedInProgress: props.segmentedInProgress,
        strokeWidthPx: props.strokeWidthPx,
        pendingColor: props.pendingColor,
      }),
    mapCheckpointStatusToIndicator,
  };
});

jest.mock('react-native-reanimated', () => {
  const { View } = jest.requireActual<typeof import('react-native')>('react-native');
  const easingFn = (value: number) => value;
  const entering = { duration: () => entering };

  return {
    __esModule: true,
    default: {
      View,
      createAnimatedComponent: <P extends object>(Component: React.ComponentType<P>) => Component,
    },
    Easing: {
      cubic: easingFn,
      out: <T,>(fn: T) => fn,
    },
    FadeIn: {
      duration: () => entering,
    },
    FadeOut: {
      duration: () => entering,
    },
    useSharedValue: <T,>(value: T) => ({ value }),
    useAnimatedProps: <T extends object>(factory: () => T) => factory(),
    withDelay: <T,>(_delayMs: number, value: T) => value,
    withTiming: <T,>(value: T) => value,
  };
});

jest.mock('react-native-svg', () => {
  const ReactActual = jest.requireActual<typeof import('react')>('react');

  const createSvgHost =
    (name: string) =>
    ({ children, ...props }: { children?: React.ReactNode; [key: string]: unknown }) =>
      ReactActual.createElement(name, props, children);

  return {
    __esModule: true,
    default: createSvgHost('Svg'),
    Svg: createSvgHost('Svg'),
    Rect: createSvgHost('Rect'),
    Defs: createSvgHost('Defs'),
    LinearGradient: createSvgHost('LinearGradient'),
    Stop: createSvgHost('Stop'),
  };
});

type JsonNode = ReturnType<TestRenderer.ReactTestRenderer['toJSON']>;
let consoleErrorSpy: jest.SpyInstance;

function collectNodesByTestID(
  node: JsonNode,
  testID: string,
  matches: JsonNode[] = []
): JsonNode[] {
  if (!node || typeof node === 'string') return matches;
  if (Array.isArray(node)) {
    node.forEach((child) => collectNodesByTestID(child, testID, matches));
    return matches;
  }
  if (node.props?.testID === testID || node.props?.['data-testid'] === testID) {
    matches.push(node);
  }
  node.children?.forEach((child) => collectNodesByTestID(child as JsonNode, testID, matches));
  return matches;
}

function collectNodesByTestIDPrefix(
  node: JsonNode,
  prefix: string,
  matches: JsonNode[] = []
): JsonNode[] {
  if (!node || typeof node === 'string') return matches;
  if (Array.isArray(node)) {
    node.forEach((child) => collectNodesByTestIDPrefix(child, prefix, matches));
    return matches;
  }
  const testID = node.props?.testID ?? node.props?.['data-testid'];
  if (typeof testID === 'string' && testID.startsWith(prefix)) {
    matches.push(node);
  }
  node.children?.forEach((child) => collectNodesByTestIDPrefix(child as JsonNode, prefix, matches));
  return matches;
}

function sendEntry(state: string): HistoryEntry {
  return {
    id: 'send-entry',
    source: 'legacy',
    legacyHistoryId: 'send-entry',
    type: 'send',
    createdAt: 1_779_430_133,
    updatedAt: 1_779_430_133,
    mintUrl: 'https://mint.example',
    unit: 'sat',
    state,
    amount: 21,
  } as unknown as HistoryEntry;
}

const unpaidMintEntry = {
  id: 'mint-entry',
  source: 'legacy',
  legacyHistoryId: 'mint-entry',
  type: 'mint',
  createdAt: 1_779_430_133,
  updatedAt: 1_779_430_133,
  mintUrl: 'https://mint.example',
  unit: 'sat',
  paymentRequest: 'lnbc1test',
  quoteId: 'quote-id',
  state: 'UNPAID',
  amount: 21,
} as unknown as HistoryEntry;

const onchainUnpaidMintEntry = {
  ...unpaidMintEntry,
  id: 'mint-onchain-entry',
  legacyHistoryId: 'mint-onchain-entry',
  paymentRequest: 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kygt080',
  metadata: {
    method: 'onchain',
    onchainAddress: 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kygt080',
  },
} as unknown as HistoryEntry;

describe('HistoryEntryTimeline connector rail', () => {
  beforeEach(() => {
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
      if (String(args[0]).includes('react-test-renderer is deprecated')) return;
      throw new Error(`Unexpected console.error: ${args.map(String).join(' ')}`);
    });
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
    jest.clearAllMocks();
  });

  it('renders connector rails as fixed-size SVG lines', () => {
    let renderer: TestRenderer.ReactTestRenderer;

    act(() => {
      renderer = TestRenderer.create(<HistoryEntryTimeline historyEntry={unpaidMintEntry} />);
    });

    const lines = collectNodesByTestID(renderer!.toJSON(), 'history-entry-timeline-line');

    expect(lines).toHaveLength(2);

    // Every dot's ring/segment strokes match the 3px connector rail width.
    const indicators = collectNodesByTestIDPrefix(renderer!.toJSON(), 'indicator-');
    expect(indicators.length).toBeGreaterThan(0);
    indicators.forEach((indicator) => {
      const props =
        indicator && typeof indicator !== 'string' && !Array.isArray(indicator)
          ? indicator.props
          : null;
      expect(props?.strokeWidthPx).toBe(3);
      // Pending strokes share the rail's unfilled track color (theme `muted`).
      expect(props?.pendingColor).toBe('muted');
    });

    lines.forEach((line) => {
      expect(
        line && typeof line !== 'string' && !Array.isArray(line) ? line.props.width : null
      ).toBe(3);
      expect(
        line && typeof line !== 'string' && !Array.isArray(line) ? line.props.height : null
      ).toBe(50);
      const style = StyleSheet.flatten(
        line && typeof line !== 'string' && !Array.isArray(line) ? line.props.style : undefined
      );
      expect(style).toEqual(expect.objectContaining({ marginVertical: 4 }));
    });

    act(() => {
      renderer.unmount();
    });
  });

  it('does not run Lightning expiry checks for legacy-shaped onchain rows', () => {
    const utils = jest.requireMock('@/shared/lib/utils') as {
      mintHistoryEntryExpired: jest.Mock;
    };
    let renderer: TestRenderer.ReactTestRenderer;

    act(() => {
      renderer = TestRenderer.create(
        <HistoryEntryTimeline historyEntry={onchainUnpaidMintEntry} />
      );
    });

    expect(utils.mintHistoryEntryExpired).not.toHaveBeenCalled();

    act(() => {
      renderer.unmount();
    });
  });

  it('top-aligns label blocks identically for every step type', () => {
    let renderer: TestRenderer.ReactTestRenderer;

    // Unpaid mint: one next-pending row + two future-small rows. All label
    // blocks must share one marginTop so a step going active (gaining its
    // sublabel) never nudges the label.
    act(() => {
      renderer = TestRenderer.create(<HistoryEntryTimeline historyEntry={unpaidMintEntry} />);
    });

    const negativeMarginTops: number[] = [];
    const walk = (node: JsonNode) => {
      if (!node || typeof node === 'string') return;
      if (Array.isArray(node)) {
        node.forEach(walk);
        return;
      }
      const style = StyleSheet.flatten(node.props?.style);
      // This environment renders styles as CSS strings ("-3px"); parse both.
      const marginTop = style?.marginTop != null ? parseFloat(String(style.marginTop)) : NaN;
      if (Number.isFinite(marginTop) && marginTop < 0) {
        negativeMarginTops.push(marginTop);
      }
      node.children?.forEach((child) => walk(child as JsonNode));
    };
    walk(renderer!.toJSON());

    expect(negativeMarginTops).toHaveLength(3);
    expect(new Set(negativeMarginTops)).toEqual(new Set([-3]));

    act(() => {
      renderer.unmount();
    });
  });

  it('transitions rows in place on rollback with an animated gradient rail', () => {
    let renderer: TestRenderer.ReactTestRenderer;

    act(() => {
      renderer = TestRenderer.create(<HistoryEntryTimeline historyEntry={sendEntry('pending')} />);
    });
    expect(collectNodesByTestIDPrefix(renderer!.toJSON(), 'indicator-')).toHaveLength(3);

    // Rollback: 3 steps collapse to 2. Rows are position-keyed, so the second
    // row's indicator TRANSITIONS to done/reverted (playing the draw-in) and
    // the third row unmounts.
    act(() => {
      renderer.update(<HistoryEntryTimeline historyEntry={sendEntry('rolledBack')} />);
    });
    const indicators = collectNodesByTestIDPrefix(renderer!.toJSON(), 'indicator-');
    expect(indicators).toHaveLength(2);
    expect(collectNodesByTestID(renderer!.toJSON(), 'indicator-done-reverted')).toHaveLength(1);

    // The rolled-back rail animates its fill like a success rail: a muted base
    // rect plus a growing gradient fill rect — not a static gradient.
    const lines = collectNodesByTestID(renderer!.toJSON(), 'history-entry-timeline-line');
    expect(lines).toHaveLength(1);
    const line = lines[0];
    const lineChildren =
      line && typeof line !== 'string' && !Array.isArray(line) ? (line.children ?? []) : [];
    const rects = lineChildren.filter(
      (child) => child && typeof child !== 'string' && child.type === 'Rect'
    );
    expect(rects).toHaveLength(2);
    const hasGradientFill = rects.some(
      (rect) => rect && typeof rect !== 'string' && String(rect.props.fill).startsWith('url(#')
    );
    expect(hasGradientFill).toBe(true);

    act(() => {
      renderer.unmount();
    });
  });

  it('passes confirmation progress only to the onchain payment-received indicator', () => {
    const progress = {
      hasPayment: true,
      hasUnconfirmedPayment: false,
      receivedSats: 21,
      currentConfirmations: 2,
      requiredConfirmations: 6,
      isSatisfied: false,
    };
    let renderer: TestRenderer.ReactTestRenderer;

    act(() => {
      renderer = TestRenderer.create(
        <HistoryEntryTimeline
          historyEntry={onchainUnpaidMintEntry}
          onchainConfirmationProgress={progress}
        />
      );
    });

    const indicators = collectNodesByTestIDPrefix(renderer!.toJSON(), 'indicator-');
    const progressIndicators = indicators.filter(
      (indicator) =>
        indicator &&
        typeof indicator !== 'string' &&
        !Array.isArray(indicator) &&
        indicator.props.confirmationProgress != null
    );

    expect(progressIndicators).toHaveLength(1);
    const paidIndicator =
      progressIndicators[0] &&
      typeof progressIndicators[0] !== 'string' &&
      !Array.isArray(progressIndicators[0])
        ? progressIndicators[0]
        : null;
    expect(paidIndicator?.props.confirmationProgress).toEqual({
      currentConfirmations: 2,
      requiredConfirmations: 6,
    });
    expect(paidIndicator?.props.segmentedInProgress).toBe(true);

    act(() => {
      renderer.unmount();
    });
  });

  it('passes pending confirmation segments to the onchain payment-received indicator before payment', () => {
    let renderer: TestRenderer.ReactTestRenderer;

    act(() => {
      renderer = TestRenderer.create(
        <HistoryEntryTimeline
          historyEntry={onchainUnpaidMintEntry}
          onchainConfirmationProgress={{
            hasPayment: false,
            hasUnconfirmedPayment: false,
            receivedSats: 0,
            currentConfirmations: null,
            requiredConfirmations: 3,
            isSatisfied: false,
          }}
        />
      );
    });

    const indicators = collectNodesByTestIDPrefix(renderer!.toJSON(), 'indicator-');
    const progressIndicators = indicators.filter(
      (indicator) =>
        indicator &&
        typeof indicator !== 'string' &&
        !Array.isArray(indicator) &&
        indicator.props.confirmationProgress != null
    );

    expect(progressIndicators).toHaveLength(1);
    const previewIndicator =
      progressIndicators[0] &&
      typeof progressIndicators[0] !== 'string' &&
      !Array.isArray(progressIndicators[0])
        ? progressIndicators[0]
        : null;
    expect(previewIndicator?.props.confirmationProgress).toEqual({
      currentConfirmations: null,
      requiredConfirmations: 3,
    });
    // No payment observed yet: the ring is a preview of the required
    // confirmations, so the next segment must not breathe "in progress"
    // while the prior "Waiting for payment" step is still pending.
    expect(previewIndicator?.props.segmentedInProgress).toBe(false);

    act(() => {
      renderer.unmount();
    });
  });
});
