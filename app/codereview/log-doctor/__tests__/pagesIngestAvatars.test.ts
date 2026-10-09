import {
  analyzeAvatarSequences,
  analyzeIngest,
  analyzePages,
  analyzeStoreWrites,
  type AnalyzableEntry,
} from '../analysis';

const entry = (event: string, params: Record<string, unknown>, _t = 0): AnalyzableEntry => ({
  level: 'debug',
  event,
  _t,
  params,
});

describe('analyzeIngest (ingest mode)', () => {
  const write = (
    store: string,
    written: number,
    changed: number,
    keyListenersNotified: number,
    globalListenersNotified: number
  ) =>
    entry('cache.store.write', {
      store,
      written,
      changed,
      keyListenersNotified,
      globalListenersNotified,
    });

  it('totals written, changed and listeners per store, and counts no-op batches', () => {
    const { stores } = analyzeIngest([
      write('profiles', 10, 2, 4, 3),
      write('profiles', 5, 0, 0, 0),
      entry('cache.store.read', { store: 'profiles' }),
    ]);

    expect(stores).toEqual([
      {
        store: 'profiles',
        batches: 2,
        noopBatches: 1,
        written: 15,
        changed: 2,
        wasted: 13,
        keyListenersNotified: 4,
        globalListenersNotified: 3,
        fanOut: 3.5,
      },
    ]);
  });

  it('ranks by wasted writes and, separately, by listeners woken per changed key', () => {
    const { byWasted, byFanOut } = analyzeIngest([
      // Re-ingests a lot, wakes few.
      write('profiles', 100, 10, 10, 0),
      // Ingests little, but each change wakes many.
      write('notes', 4, 4, 40, 40),
      // Changes nothing at all: no fan-out to divide.
      write('stats', 6, 0, 0, 0),
    ]);

    expect(byWasted.map((s) => s.store)).toEqual(['profiles', 'stats', 'notes']);
    expect(byFanOut.map((s) => s.store)).toEqual(['notes', 'profiles', 'stats']);
    expect(byFanOut[0]!.fanOut).toBe(20);
    expect(byFanOut[2]!.fanOut).toBe(0);
  });

  it('reports nothing for a log with no cache writes', () => {
    expect(analyzeIngest([entry('nav.transition', { screen: 'Home' })]).stores).toEqual([]);
  });
});

describe('analyzeStoreWrites (stores mode)', () => {
  const set = (store: string, changed: unknown, subscribers: number, scope = 'global') =>
    entry('store.set', { store, scope, changed, subscribers });

  it('totals writes, no-op writes, subscribers and the most-written keys per store', () => {
    const { stores } = analyzeStoreWrites([
      set('settings', ['theme'], 3),
      set('settings', ['theme', 'currency'], 3),
      set('settings', [], 3),
      set('settings', [], 0),
      entry('store.mint_metadata.info.miss', { key: 'm' }),
    ]);

    expect(stores).toEqual([
      {
        store: 'settings',
        scope: 'global',
        writes: 4,
        noopWrites: 2,
        noopNotifying: 1,
        subscribersNotified: 9,
        topKeys: [
          { key: 'theme', writes: 2 },
          { key: 'currency', writes: 1 },
        ],
      },
    ]);
  });

  it('ranks by writes and, separately, by writes that changed nothing', () => {
    const { byWrites, byNoop } = analyzeStoreWrites([
      set('busy', ['a'], 1),
      set('busy', ['a'], 1),
      set('busy', ['a'], 1),
      set('wasteful', [], 1, 'profile'),
      set('wasteful', [], 1, 'profile'),
      set('quiet', ['a'], 1),
    ]);

    expect(byWrites.map((s) => s.store)).toEqual(['busy', 'wasteful', 'quiet']);
    // A store with no no-op write is not a finding, so it is left out.
    expect(byNoop.map((s) => [s.store, s.scope, s.noopWrites])).toEqual([
      ['wasteful', 'profile', 2],
    ]);
  });

  it('does not count the logger truncation marker as a key, or a missing list as a no-op', () => {
    const { stores } = analyzeStoreWrites([
      set('wide', ['a', 'b', 'c', 'd', 'e', '…3 more'], 1),
      set('wide', undefined, 1),
    ]);

    expect(stores[0].noopWrites).toBe(0);
    expect(stores[0].topKeys.map((k) => k.key)).toEqual(['a', 'b', 'c']);
  });

  it('reports nothing for a log with no store writes', () => {
    expect(analyzeStoreWrites([entry('ui.screen', {})]).stores).toEqual([]);
  });
});

describe('analyzePages (pages mode)', () => {
  it('collects mount, navigation and render counts under the Screen name', () => {
    const [home] = analyzePages([
      entry('nav.transition', { screen: 'Home', action: 'NAVIGATE', duration_ms: 40 }),
      entry('screen.mount', { screen: 'Home', shell_ms: 12, content_ms: 90 }),
      entry('render.why', { component: 'Screen(Home)', renders: 2, changes: {} }),
      entry('render.why', { component: 'Home', renders: 2, changes: {} }),
      entry('render.why', { component: 'SomeRow', renders: 9, changes: {} }),
    ]);

    expect(home).toMatchObject({
      screen: 'Home',
      mounts: 1,
      mountMs: [90],
      shellMs: [12],
      navMs: [40],
      renderWhy: 2,
    });
  });

  it('charges frame drops and coco time to the page that mounted last', () => {
    const pages = analyzePages([
      // Before any page is known there is nothing to charge.
      entry('coco.call', { method: 'wallet.init', duration_ms: 500 }),
      entry('screen.mount', { screen: 'Home', shell_ms: 1, content_ms: 2 }),
      entry('coco.call', { method: 'wallet.getBalance', duration_ms: 30 }),
      entry('perf.frame_drop', { dropped: 4, frames: 60 }),
      entry('nav.transition', { screen: 'Send', action: 'PUSH', duration_ms: 20 }),
      entry('coco.call', { method: 'ops.send.prepare', duration_ms: 120 }),
      entry('coco.call', { method: 'ops.send.execute', duration_ms: 80.5 }),
      entry('perf.frame_drop', { dropped: 7, frames: 60 }),
      entry('perf.frame_drop', { dropped: 1, frames: 60 }),
    ]);

    expect(pages.map((p) => p.screen)).toEqual(['Home', 'Send']);
    expect(pages[0]).toMatchObject({
      cocoCalls: 1,
      cocoMs: 30,
      frameDropReports: 1,
      droppedFrames: 4,
    });
    expect(pages[1]).toMatchObject({
      mounts: 0,
      cocoCalls: 2,
      cocoMs: 200.5,
      frameDropReports: 2,
      droppedFrames: 8,
    });
  });

  it('charges store writes, and the ones that changed nothing, to the page that mounted last', () => {
    const set = (changed: string[]) =>
      entry('store.set', { store: 'settings', scope: 'global', changed, subscribers: 2 });
    const pages = analyzePages([
      set(['hydrated']),
      entry('screen.mount', { screen: 'Home', shell_ms: 1, content_ms: 2 }),
      set(['balance']),
      set([]),
      entry('screen.mount', { screen: 'Send', shell_ms: 1, content_ms: 2 }),
      set([]),
      set([]),
      set(['amount', 'mint']),
    ]);

    expect(pages[0]).toMatchObject({ screen: 'Home', storeWrites: 2, storeNoopWrites: 1 });
    expect(pages[1]).toMatchObject({ screen: 'Send', storeWrites: 3, storeNoopWrites: 2 });
  });

  it('counts a render.why logged before the screen names itself', () => {
    const [send] = analyzePages([
      entry('render.why', { component: 'Screen(Send)', renders: 2, changes: {} }),
      entry('screen.mount', { screen: 'Send', shell_ms: 1, content_ms: 2 }),
    ]);
    expect(send!.renderWhy).toBe(1);
  });
});

describe('analyzeAvatarSequences (avatars mode)', () => {
  const avatar = (seed: string, branch: string, instance = 'row-1', _t = 0) =>
    entry('visual.avatar.sequence', { seed, branch, instance }, _t);

  it('flags a seed that shows the fallback between loading and its image', () => {
    const analysis = analyzeAvatarSequences([
      avatar('alice', 'loading', 'row-1', 10),
      avatar('alice', 'fallback', 'row-1', 20),
      avatar('alice', 'image', 'row-1', 30),
    ]);
    expect(analysis.flickers).toEqual([{ seed: 'alice', instance: 'row-1', t: 30 }]);
  });

  it('passes the sequences that are not a flicker', () => {
    const analysis = analyzeAvatarSequences([
      // Straight to the picture.
      avatar('alice', 'loading'),
      avatar('alice', 'image'),
      // No picture at all: the fallback is the answer.
      avatar('bob', 'loading'),
      avatar('bob', 'fallback'),
      // A picture that failed after it was shown.
      avatar('carol', 'image'),
      avatar('carol', 'fallback'),
      // Started on the fallback, picture arrived later.
      avatar('dave', 'fallback'),
      avatar('dave', 'image'),
    ]);
    expect(analysis.flickers).toEqual([]);
    expect(analysis.seeds).toBe(4);
  });

  it('follows each avatar instance separately when two show the same seed', () => {
    const analysis = analyzeAvatarSequences([
      avatar('alice', 'loading', 'row-1'),
      avatar('alice', 'fallback', 'row-2'),
      avatar('alice', 'image', 'row-1'),
    ]);
    expect(analysis.flickers).toEqual([]);
    expect(analysis.sequences).toBe(2);
  });

  it('starts over when a recycled instance moves to another seed', () => {
    const analysis = analyzeAvatarSequences([
      avatar('alice', 'loading', 'row-1'),
      avatar('alice', 'fallback', 'row-1'),
      avatar('bob', 'image', 'row-1'),
    ]);
    expect(analysis.flickers).toEqual([]);
  });

  it('ignores a repeated branch rather than letting it hide the flicker', () => {
    const analysis = analyzeAvatarSequences([
      avatar('alice', 'loading'),
      avatar('alice', 'loading'),
      avatar('alice', 'fallback'),
      avatar('alice', 'fallback'),
      avatar('alice', 'image'),
    ]);
    expect(analysis.flickers).toHaveLength(1);
  });
});
