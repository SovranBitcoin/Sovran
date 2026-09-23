/**
 * @jest-environment node
 *
 * The render-diagnostics emitters exist to feed log-doctor's `renders` mode,
 * which reads four event families: `render.why`, `state.change`,
 * `query.result` / `query.diff`, and `render.count`. These tests lock the two
 * things that make those events trustworthy:
 *
 *   1. the event names and param shapes log-doctor parses, and
 *   2. the privacy contract — a string or object value is described by its
 *      length / key count and NEVER logged.
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
const mockClock = { now: 1_000 };

jest.mock('@/shared/lib/loggerCore', () => ({
  // The hooks pick their no-op implementations when `SHOW_LOGS` is false (every
  // release build). These tests cover the live path.
  SHOW_LOGS: true,
  monotonicNow: () => mockClock.now,
  log: {
    debug: (event: string, params?: Record<string, unknown>) => mockDebug(event, params),
    warn: (event: string, params?: Record<string, unknown>) => mockWarn(event, params),
  },
}));

function lastCall(fn: jest.Mock, event: string): Record<string, unknown> | undefined {
  for (let i = fn.mock.calls.length - 1; i >= 0; i--) {
    if (fn.mock.calls[i][0] === event) return fn.mock.calls[i][1] as Record<string, unknown>;
  }
  return undefined;
}

beforeEach(() => {
  mockDebug.mockClear();
  mockWarn.mockClear();
  mockClock.now = 1_000;
});

describe('useWhyDidRender', () => {
  function Subject({ inputs }: { inputs: Record<string, unknown> }) {
    useWhyDidRender('Subject', inputs);
    return null;
  }

  it('says nothing on the first commit — there is nothing to compare against', () => {
    act(() => {
      TestRenderer.create(<Subject inputs={{ count: 1 }} />);
    });
    expect(lastCall(mockDebug, 'render.why')).toBeUndefined();
  });

  it('names each changed input with a hint log-doctor can group by', () => {
    let tree!: TestRenderer.ReactTestRenderer;
    act(() => {
      tree = TestRenderer.create(<Subject inputs={{ count: 1, rows: [1, 2], ready: false }} />);
    });
    act(() => {
      tree.update(<Subject inputs={{ count: 2, rows: [1, 2, 3], ready: false }} />);
    });
    const params = lastCall(mockDebug, 'render.why');
    expect(params).toMatchObject({
      component: 'Subject',
      changedCount: 2,
      changes: {
        count: { hint: '1 → 2' },
        rows: { hint: 'array len 2 → 3' },
      },
    });
    expect((params?.changes as Record<string, unknown>).ready).toBeUndefined();
  });

  it('flags a commit where nothing changed — the re-render with no cause', () => {
    const stable = { a: 1 };
    let tree!: TestRenderer.ReactTestRenderer;
    act(() => {
      tree = TestRenderer.create(<Subject inputs={{ stable }} />);
    });
    act(() => {
      tree.update(<Subject inputs={{ stable }} />);
    });
    expect(lastCall(mockDebug, 'render.why')).toMatchObject({ unexplained: true, changes: {} });
  });

  it('describes strings and objects by shape, never by value', () => {
    let tree!: TestRenderer.ReactTestRenderer;
    act(() => {
      tree = TestRenderer.create(
        <Subject inputs={{ note: 'hunter2', profile: { name: 'a', about: 'b' } }} />
      );
    });
    act(() => {
      tree.update(<Subject inputs={{ note: 'hunter2000', profile: { name: 'c', about: 'd' } }} />);
    });
    const params = lastCall(mockDebug, 'render.why');
    const serialised = JSON.stringify(params);
    expect(serialised).not.toContain('hunter2');
    expect(params?.changes).toMatchObject({
      note: { hint: 'string len 7 → 10' },
      profile: { hint: 'new object identity, 2 keys' },
    });
  });

  // Both of these read as a plain object to `Object.keys`, and both are hot
  // inputs in this app: the profile cache is a Map, and `FormattedString`
  // (a String subclass) reaches render inputs as a boxed primitive.
  it('reports a Map by its entry count, not as zero keys', () => {
    let tree!: TestRenderer.ReactTestRenderer;
    act(() => {
      tree = TestRenderer.create(<Subject inputs={{ profiles: new Map([['a', 1]]) }} />);
    });
    act(() => {
      tree.update(
        <Subject
          inputs={{
            profiles: new Map([
              ['a', 1],
              ['b', 2],
            ]),
          }}
        />
      );
    });
    expect(lastCall(mockDebug, 'render.why')?.changes).toMatchObject({
      profiles: { hint: 'map 1 → 2 entries' },
    });
  });

  it('names a boxed String rather than counting its character indices', () => {
    let tree!: TestRenderer.ReactTestRenderer;
    act(() => {
      tree = TestRenderer.create(<Subject inputs={{ mintUrl: new String('https://a.example') }} />);
    });
    act(() => {
      tree.update(<Subject inputs={{ mintUrl: new String('https://a.example') }} />);
    });
    expect(lastCall(mockDebug, 'render.why')?.changes).toMatchObject({
      mintUrl: { hint: 'new String object identity' },
    });
  });
});

describe('useStateChangeLogger', () => {
  function Subject({ states }: { states: Record<string, unknown> }) {
    useStateChangeLogger('Subject', states);
    return null;
  }

  it('emits one state.change per changed key, with the state name log-doctor groups on', () => {
    let tree!: TestRenderer.ReactTestRenderer;
    act(() => {
      tree = TestRenderer.create(<Subject states={{ sort: 'new', open: false }} />);
    });
    act(() => {
      tree.update(<Subject states={{ sort: 'old', open: true }} />);
    });
    const changes = mockDebug.mock.calls.filter(([event]) => event === 'state.change');
    expect(changes).toHaveLength(2);
    expect(changes.map(([, params]) => (params as { state: string }).state).sort()).toEqual([
      'open',
      'sort',
    ]);
    expect(changes.find(([, p]) => (p as { state: string }).state === 'open')?.[1]).toMatchObject({
      component: 'Subject',
      from: 'false',
      to: 'true',
    });
  });
});

describe('useQueryResultLogger', () => {
  function Subject({ status, count }: { status: string; count: number }) {
    useQueryResultLogger({ source: 'useThing', status, count, extra: { stale: false } });
    return null;
  }

  it('emits query.result once, then query.diff with the previous status and count', () => {
    let tree!: TestRenderer.ReactTestRenderer;
    act(() => {
      tree = TestRenderer.create(<Subject status="loading" count={0} />);
    });
    expect(lastCall(mockDebug, 'query.result')).toMatchObject({
      source: 'useThing',
      status: 'loading',
      count: 0,
      stale: false,
    });

    act(() => {
      tree.update(<Subject status="ready" count={12} />);
    });
    expect(lastCall(mockDebug, 'query.diff')).toMatchObject({
      source: 'useThing',
      status: 'ready',
      from_status: 'loading',
      count: 12,
      prev_count: 0,
      delta: 12,
    });
  });

  it('stays silent when the snapshot has not moved', () => {
    let tree!: TestRenderer.ReactTestRenderer;
    act(() => {
      tree = TestRenderer.create(<Subject status="ready" count={3} />);
    });
    mockDebug.mockClear();
    act(() => {
      tree.update(<Subject status="ready" count={3} />);
    });
    expect(mockDebug).not.toHaveBeenCalled();
  });
});

describe('row render aggregation', () => {
  it('rolls a whole list into one render.count carrying the wasted count', () => {
    // Three distinct rows, one of them drawn twice: 4 renders, 3 rows, 1 wasted.
    countRowRender('Feed', 'a');
    countRowRender('Feed', 'b');
    countRowRender('Feed', 'c');
    countRowRender('Feed', 'a');
    mockClock.now = 1_500;
    flushRowRenderWindows();

    const counts = mockDebug.mock.calls.filter(([event]) => event === 'render.count');
    expect(counts).toHaveLength(1);
    expect(counts[0][1]).toMatchObject({
      component: 'Feed/row',
      renders: 4,
      rows: 3,
      maxRowRenders: 2,
      wasted: 1,
      aliveMs: 500,
    });
  });

  it('escalates to warn when one row redraws past the threshold', () => {
    for (let i = 0; i < 6; i++) countRowRender('Feed', 'a', { warnAfter: 4 });
    flushRowRenderWindows();
    expect(lastCall(mockWarn, 'render.count')).toMatchObject({
      component: 'Feed/row',
      renders: 6,
      rows: 1,
      maxRowRenders: 6,
      wasted: 5,
    });
    expect(lastCall(mockDebug, 'render.count')).toBeUndefined();
  });

  it('never logs the row key it counts by', () => {
    countRowRender('Feed', 'npub1secretlookingrowkey');
    flushRowRenderWindows();
    expect(JSON.stringify(mockDebug.mock.calls)).not.toContain('npub1secretlookingrowkey');
  });

  it('counts a row component through the hook form', () => {
    function Row({ rowKey }: { rowKey: string }) {
      useRowRenderLogger('Hooked', rowKey);
      return null;
    }
    act(() => {
      TestRenderer.create(
        <>
          <Row rowKey="x" />
          <Row rowKey="y" />
        </>
      );
    });
    flushRowRenderWindows();
    expect(lastCall(mockDebug, 'render.count')).toMatchObject({
      component: 'Hooked/row',
      renders: 2,
      rows: 2,
      wasted: 0,
    });
  });
});
