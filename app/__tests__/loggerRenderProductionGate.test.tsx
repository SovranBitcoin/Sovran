/**
 * @jest-environment node
 *
 * The production contract for the render-diagnostics emitters.
 *
 * `SHOW_LOGS` false makes each export a no-op, but a no-op still lets the
 * CALLER evaluate its arguments — and several call sites compute real work
 * there (`rows.filter(…)` three times over, `Object.keys(map).length` on a
 * hundred-entry cache). Passing a thunk moves that behind the gate. These tests
 * assert the thunk is NEVER invoked in a release build, which is the only thing
 * that makes the instrumentation free to ship.
 */

import TestRenderer, { act } from 'react-test-renderer';

import {
  countRowRender,
  flushRowRenderWindows,
  useQueryResultLogger,
  useRowRenderLogger,
  useStateChangeLogger,
  useWhyDidRender,
} from '@/shared/lib/loggerRender';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mockDebug = jest.fn();
const mockWarn = jest.fn();

jest.mock('@/shared/lib/loggerCore', () => ({
  // A release build.
  SHOW_LOGS: false,
  monotonicNow: () => 0,
  log: {
    debug: (event: string, params?: Record<string, unknown>) => mockDebug(event, params),
    warn: (event: string, params?: Record<string, unknown>) => mockWarn(event, params),
  },
}));

beforeEach(() => {
  mockDebug.mockClear();
  mockWarn.mockClear();
});

describe('render diagnostics in a release build', () => {
  it('never invokes the thunk handed to any of the three hooks', () => {
    const whyThunk = jest.fn(() => ({ rows: [1, 2, 3] }));
    const stateThunk = jest.fn(() => ({ sort: 'new' }));
    const queryThunk = jest.fn(() => ({ source: 'useThing', status: 'ready', count: 3 }));

    function Subject() {
      useWhyDidRender('Subject', whyThunk);
      useStateChangeLogger('Subject', stateThunk);
      useQueryResultLogger(queryThunk);
      return null;
    }

    let renderer!: TestRenderer.ReactTestRenderer;
    act(() => {
      renderer = TestRenderer.create(<Subject />);
    });
    act(() => {
      renderer.update(<Subject />);
    });
    act(() => {
      renderer.unmount();
    });

    expect(whyThunk).not.toHaveBeenCalled();
    expect(stateThunk).not.toHaveBeenCalled();
    expect(queryThunk).not.toHaveBeenCalled();
  });

  it('emits nothing at all — no event reaches the logger', () => {
    function Subject() {
      useWhyDidRender('Subject', { a: 1 });
      useRowRenderLogger('List', 'row-1');
      return null;
    }
    act(() => {
      TestRenderer.create(<Subject />);
    });
    countRowRender('List', 'row-2');
    flushRowRenderWindows();

    expect(mockDebug).not.toHaveBeenCalled();
    expect(mockWarn).not.toHaveBeenCalled();
  });

  it('keeps the row counter from accumulating state it can never flush', () => {
    for (let i = 0; i < 100; i++) countRowRender('List', `row-${i}`);
    flushRowRenderWindows();
    expect(mockDebug).not.toHaveBeenCalled();
  });
});
