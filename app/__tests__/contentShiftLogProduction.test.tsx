/**
 * @jest-environment node
 *
 * Release builds compile the loggers out, so every visual-instrumentation hook
 * can only reach its own early return. Reaching it still costs a
 * `useWindowDimensions` subscription, a dozen refs and a scope-registry entry
 * PER INSTANCE — and a feed screen mounts hundreds (every Skeleton, Spinner,
 * Avatar and loading Text). These tests pin the no-op implementations, and in
 * particular that the handlers come back UNDEFINED, so the views never dispatch
 * a layout or scroll event for measurement that cannot run.
 */

import TestRenderer, { act } from 'react-test-renderer';

import {
  useShiftLogger,
  useVisualFlatListLogger,
  useVisualLayoutLogger,
  useVisualListLogger,
  useVisualScrollMetricsLogger,
  useVisualStateLogger,
  VISUAL_LOGGING_ENABLED,
} from '@/shared/lib/contentShiftLog';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mockInfo = jest.fn();
const mockWarn = jest.fn();
const mockUseWindowDimensions = jest.fn(() => ({
  width: 390,
  height: 844,
  scale: 3,
  fontScale: 1,
}));

jest.mock('@/shared/lib/logger', () => ({
  SHOW_LOGS: false,
  monotonicNow: jest.fn(() => Date.now()),
  feedLog: {
    info: (event: string, params?: Record<string, unknown>) => mockInfo(event, params),
    warn: (event: string, params?: Record<string, unknown>) => mockWarn(event, params),
    isLevelEnabled: () => false,
  },
}));

jest.mock('react-native', () => ({
  useWindowDimensions: () => mockUseWindowDimensions(),
}));

function render(useHook: () => void): void {
  function Probe() {
    useHook();
    return null;
  }
  act(() => {
    TestRenderer.create(<Probe />);
  });
}

describe('visual instrumentation in a release build', () => {
  beforeEach(() => {
    mockInfo.mockClear();
    mockWarn.mockClear();
    mockUseWindowDimensions.mockClear();
  });

  it('hands back no layout handlers, so the view dispatches nothing', () => {
    const captured: { layout?: ReturnType<typeof useVisualLayoutLogger> } = {};
    render(() => {
      captured.layout = useVisualLayoutLogger({
        scope: 'test.scope',
        surface: 'test',
        component: 'Probe',
        itemType: 'probe',
      });
    });

    expect(captured.layout).toBeDefined();
    expect(captured.layout?.ref).toBeUndefined();
    expect(captured.layout?.onLayout).toBeUndefined();
    expect(() => captured.layout?.measureNow('test')).not.toThrow();
  });

  it('hands back no scroll handlers', () => {
    const captured: { scroll?: ReturnType<typeof useVisualScrollMetricsLogger> } = {};
    render(() => {
      captured.scroll = useVisualScrollMetricsLogger({
        scope: 'test.scope',
        surface: 'test',
        component: 'Probe',
      });
    });

    expect(captured.scroll).toBeDefined();
    expect(captured.scroll?.onLayout).toBeUndefined();
    expect(captured.scroll?.onScroll).toBeUndefined();
    expect(captured.scroll?.onContentSizeChange).toBeUndefined();
  });

  it('never subscribes to window dimensions', () => {
    render(() => {
      useVisualLayoutLogger({
        scope: 'test.scope',
        surface: 'test',
        component: 'Probe',
      });
      useVisualScrollMetricsLogger({ scope: 'test.scope', surface: 'test', component: 'Probe' });
    });

    expect(mockUseWindowDimensions).not.toHaveBeenCalled();
  });

  it('keeps the list and state reporters callable but silent', () => {
    const captured: { list?: ReturnType<typeof useVisualListLogger<{ id: string }>> } = {};
    render(() => {
      captured.list = useVisualListLogger<{ id: string }>({
        scope: 'test.scope',
        surface: 'test',
        component: 'Probe',
      });
      useVisualStateLogger({
        scope: 'test.scope',
        surface: 'test',
        component: 'Probe',
        stateKey: 'phase',
        state: { phase: 'idle' },
      });
      useShiftLogger('Probe').report('test.shift', 'key', 12);
    });

    expect(captured.list).toBeDefined();
    expect(() => captured.list?.onMetricsChange({})).not.toThrow();
    expect(mockInfo).not.toHaveBeenCalled();
    expect(mockWarn).not.toHaveBeenCalled();
  });

  it('keeps the flat-list reporter callable — its callers invoke it from their own handlers', () => {
    const captured: { flat?: ReturnType<typeof useVisualFlatListLogger<{ id: string }>> } = {};
    render(() => {
      captured.flat = useVisualFlatListLogger<{ id: string }>({
        scope: 'test.scope',
        surface: 'test',
        component: 'Probe',
      });
    });

    expect(typeof captured.flat?.onListScroll).toBe('function');
    expect(typeof captured.flat?.onListViewableItemsChanged).toBe('function');
    expect(() =>
      captured.flat?.onListViewableItemsChanged({ viewableItems: [], changed: [] })
    ).not.toThrow();
    expect(mockInfo).not.toHaveBeenCalled();
  });

  it('reports that visual logging is off, so instrumentation-only handlers can detach', () => {
    expect(VISUAL_LOGGING_ENABLED).toBe(false);
  });
});
