/**
 * @jest-environment node
 *
 * Structural pin of the CURRENT timeline renderer across every Design System
 * scenario frame — the acceptance surface for the timeline redesign. Each
 * frame snapshots the ordered text content, every dot indicator's resolved
 * props (phase/result, ring progress, stroke targeting, chrome colors), and
 * every connector rail's fill/gradient. The redesign must reproduce these
 * resolved props exactly (only test-key fields may change).
 */

import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { HistoryEntryTimeline } from '@/features/transactions/components/detail/timeline';
import { buildTimelineScenarios } from '@/features/settings/screens/designSystemTimelineScenarios';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const FIXED_TS = 1_779_430_133_000;

jest.mock('@/shared/hooks/useThemeColor', () => ({
  useThemeColor: (tokens: string | string[]) =>
    Array.isArray(tokens) ? tokens.map((token) => token) : tokens,
}));

jest.mock('@/shared/lib/version', () => ({
  supportsBlur: () => false,
  supportsLiquidGlass: () => false,
  liquidGlassModifiers: <T,>(...modifiers: T[]) => modifiers,
}));

jest.mock('@/shared/lib/color', () => ({
  ...jest.requireActual('@/shared/lib/color'),
  withAlpha: jest.fn((color: string) => color),
}));

jest.mock('@/shared/lib/date', () => ({
  formatDate: () => '2026-05-22',
}));

jest.mock('@/shared/lib/logger', () => {
  const ReactActual = jest.requireActual<typeof import('react')>('react');
  const logger = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };
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
    LoadingIndicator: (props: Record<string, unknown>) =>
      ReactActual.createElement('LoadingIndicatorMock', {
        testID: `indicator-${String(props.phase)}-${String(props.result)}`,
        confirmationProgress: props.confirmationProgress,
        segmentedInProgress: props.segmentedInProgress,
        strokeWidthPx: props.strokeWidthPx,
        pendingColor: props.pendingColor,
        color: props.color,
        transitionDelayMs: props.transitionDelayMs,
      }),
    mapCheckpointStatusToIndicator,
  };
});

jest.mock('react-native-reanimated', () => {
  const { View } = jest.requireActual<typeof import('react-native')>('react-native');
  const easingFn = (value: number) => value;
  const entering: Record<string, unknown> = {};
  entering.duration = () => entering;
  entering.delay = () => entering;
  return {
    __esModule: true,
    default: {
      View,
      createAnimatedComponent: <P extends object>(Component: React.ComponentType<P>) => Component,
    },
    Easing: { cubic: easingFn, out: <T,>(fn: T) => fn },
    FadeIn: { duration: () => entering, delay: () => entering },
    FadeOut: { duration: () => entering, delay: () => entering },
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

interface JsonElement {
  type: string;
  props: Record<string, unknown>;
  children?: (JsonElement | string)[] | null;
}
type JsonNode = JsonElement | JsonElement[] | string | null | undefined;

function isElement(node: JsonNode): node is JsonElement {
  return !!node && typeof node !== 'string' && !Array.isArray(node);
}

function walk(node: JsonNode, visit: (node: JsonElement | string) => void): void {
  if (node == null) return;
  if (typeof node === 'string') {
    visit(node);
    return;
  }
  if (Array.isArray(node)) {
    node.forEach((child) => walk(child, visit));
    return;
  }
  visit(node);
  node.children?.forEach((child) => walk(child, visit));
}

/** Normalize live countdown badges so snapshots stay time-independent. */
function normalizeText(text: string): string {
  return text.replace(/expires in .+$/, 'expires in <countdown>');
}

interface IndicatorPin {
  id: string;
  confirmationProgress: unknown;
  segmentedInProgress: unknown;
  strokeWidthPx: unknown;
  pendingColor: unknown;
  color: unknown;
  transitionDelayMs: unknown;
}

interface LinePin {
  filledHeight: unknown;
  fill: string;
  gradientStops: string[];
}

function pinFrame(root: JsonNode): {
  texts: string[];
  indicators: IndicatorPin[];
  lines: LinePin[];
} {
  const texts: string[] = [];
  const indicators: IndicatorPin[] = [];
  const lines: LinePin[] = [];

  walk(root, (node) => {
    if (typeof node === 'string') {
      const trimmed = node.trim();
      if (trimmed) texts.push(normalizeText(trimmed));
      return;
    }
    const testID = node.props?.testID as string | undefined;
    if (testID?.startsWith('indicator-')) {
      indicators.push({
        id: testID,
        confirmationProgress: node.props.confirmationProgress ?? null,
        segmentedInProgress: node.props.segmentedInProgress ?? null,
        strokeWidthPx: node.props.strokeWidthPx ?? null,
        pendingColor: node.props.pendingColor ?? null,
        color: node.props.color ?? null,
        transitionDelayMs: node.props.transitionDelayMs ?? null,
      });
    }
    if (testID === 'history-entry-timeline-line') {
      const children = (node.children ?? []).filter(isElement);
      const rects = children.filter((child) => child.type === 'Rect');
      const fillRect = rects[1] ?? null;
      const stops: string[] = [];
      walk(node as JsonNode, (inner) => {
        if (typeof inner !== 'string' && inner.type === 'Stop') {
          stops.push(String(inner.props.stopColor));
        }
      });
      lines.push({
        filledHeight: fillRect?.props.animatedProps ?? null,
        fill: String(fillRect?.props.fill ?? ''),
        gradientStops: stops,
      });
    }
  });

  return { texts, indicators, lines };
}

describe('timeline scenario pins (redesign acceptance surface)', () => {
  let consoleErrorSpy: jest.SpyInstance;

  beforeAll(() => {
    jest.useFakeTimers();
    jest.setSystemTime(FIXED_TS);
  });

  afterAll(() => {
    jest.useRealTimers();
  });

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

  const scenarios = buildTimelineScenarios(FIXED_TS);

  it('covers every showcase group', () => {
    expect(new Set(scenarios.map((s) => s.group))).toEqual(
      new Set(['Cashu', 'Lightning', 'Onchain', 'Request'])
    );
  });

  for (const scenario of scenarios) {
    describe(`${scenario.id} (${scenario.group} · ${scenario.variant})`, () => {
      scenario.frames.forEach((frame, frameIndex) => {
        it(`frame ${frameIndex}: ${frame.note}`, () => {
          let renderer: TestRenderer.ReactTestRenderer;
          act(() => {
            renderer = TestRenderer.create(
              <HistoryEntryTimeline
                historyEntry={frame.historyEntry}
                meltQuote={frame.meltQuote}
                tokenCreated={frame.tokenCreated}
                nostrSent={frame.nostrSent}
                onchainConfirmationProgress={frame.onchainConfirmationProgress}
                onchainSettledInternally={frame.onchainSettledInternally}
              />
            );
          });

          expect(pinFrame(renderer!.toJSON() as unknown as JsonNode)).toMatchSnapshot();

          act(() => {
            renderer.unmount();
          });
        });
      });
    });
  }
});
