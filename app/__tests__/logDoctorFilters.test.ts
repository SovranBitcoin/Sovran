/**
 * @jest-environment node
 */

import {
  extractLatestSession,
  filterEntries,
  modeDevices,
  modePayment,
  modeToasts,
  modeVisual,
  parseArgs,
  parseLogInput,
  shouldReadFromStdin,
} from '../codereview/log-doctor/index';

function entry(input: {
  t: number;
  event: string;
  level?: string;
  device: Record<string, unknown>;
  params?: Record<string, unknown>;
}) {
  return {
    ts: '2026-06-15T00:00:00.000Z',
    _t: input.t,
    level: input.level ?? 'info',
    event: input.event,
    src: { file: 'test.ts', func: 'test', line: 1 },
    device: input.device,
    ...(input.params ? { params: input.params } : {}),
  };
}

function stdinStat(input: { fifo?: boolean; file?: boolean; socket?: boolean }) {
  return {
    isFIFO: () => input.fifo === true,
    isFile: () => input.file === true,
    isSocket: () => input.socket === true,
  };
}

const ios = {
  label: 'ios:abc123',
  platform: 'ios',
  deviceName: 'audit-iphone',
  logSessionId: 'ios-session-1',
};

const android = {
  label: 'android:def456',
  platform: 'android',
  deviceName: 'audit-android',
  logSessionId: 'android-session-1',
};

describe('log-doctor mixed-device filters', () => {
  it('detects piped stdin when Node leaves process.stdin.isTTY undefined', () => {
    expect(shouldReadFromStdin(stdinStat({ fifo: true }), undefined)).toBe(true);
    expect(shouldReadFromStdin(stdinStat({ file: true }), undefined)).toBe(true);
    expect(shouldReadFromStdin(stdinStat({ socket: true }), undefined)).toBe(true);
    expect(shouldReadFromStdin(stdinStat({}), undefined)).toBe(false);
    expect(shouldReadFromStdin(stdinStat({ fifo: true }), true)).toBe(false);
  });

  it('filters by platform, device pattern, and session id', () => {
    const entries = parseLogInput(
      [
        entry({ t: 1, event: 'payment.status.set_active', device: ios, params: { id: 'ios-pay' } }),
        entry({
          t: 2,
          event: 'payment.status.set_active',
          device: android,
          params: { id: 'android-pay' },
        }),
      ]
        .map((line) => JSON.stringify(line))
        .join('\n')
    );

    expect(
      filterEntries(entries, parseArgs(['node', 'log-doctor', 'timeline', '--platform', 'ios']))
    ).toHaveLength(1);
    expect(
      filterEntries(entries, parseArgs(['node', 'log-doctor', 'timeline', '--device', 'android']))
    ).toHaveLength(1);
    expect(
      filterEntries(
        entries,
        parseArgs(['node', 'log-doctor', 'timeline', '--session', 'ios-session-1'])
      )
    ).toHaveLength(1);
  });

  it('extracts the latest session per device clock when phone logs are interleaved', () => {
    const entries = [
      entry({ t: 1, event: 'payment.old_ios', device: { ...ios, logSessionId: 'ios-old' } }),
      entry({
        t: 1,
        event: 'payment.old_android',
        device: { ...android, logSessionId: 'and-old' },
      }),
      entry({ t: 2, event: 'payment.old_ios.2', device: { ...ios, logSessionId: 'ios-old' } }),
      entry({
        t: 2,
        event: 'payment.old_android.2',
        device: { ...android, logSessionId: 'and-old' },
      }),
      entry({ t: 0, event: 'payment.new_ios', device: { ...ios, logSessionId: 'ios-new' } }),
      entry({
        t: 0,
        event: 'payment.new_android',
        device: { ...android, logSessionId: 'and-new' },
      }),
    ];

    expect(extractLatestSession(entries).map((line) => line.event)).toEqual([
      'payment.new_ios',
      'payment.new_android',
    ]);
  });

  it('renders device, payment, and toast summaries', () => {
    const entries = [
      entry({ t: 1, event: 'payment.receive.pending', device: ios, params: { id: 'rx-1' } }),
      entry({
        t: 2,
        event: 'popup.toast.custom_show',
        device: ios,
        params: { toastId: 'toast-1', paymentId: 'rx-1' },
      }),
      entry({
        t: 3,
        event: 'popup.status_toast.status',
        device: ios,
        params: { toastId: 'toast-1', paymentId: 'rx-1', status: 'warning' },
      }),
    ];
    const opts = parseArgs(['node', 'log-doctor', 'payment']);

    expect(modeDevices(entries, opts)).toContain('ios:abc123');
    expect(modePayment(entries, opts)).toContain('payment.receive.pending');
    expect(modeToasts(entries, opts)).toContain('popup.status_toast.status');
  });

  it('renders visual layout anomaly summaries', () => {
    const entries = [
      entry({
        t: 0,
        event: 'visual.layout.measure',
        device: ios,
        params: {
          scope: 'thread.abc.list',
          surface: 'thread',
          component: 'ThreadRow',
          key: 't_post',
          itemType: 'target',
          pageY: 72,
          height: 220,
          bottom: 292,
          mountOrder: 1,
          stylePosition: 'relative',
          visible: true,
          reason: 'layout',
          overlapCount: 0,
        },
      }),
      entry({
        t: 1,
        event: 'visual.layout.measure',
        level: 'warn',
        device: ios,
        params: {
          scope: 'thread.abc.list',
          surface: 'thread',
          component: 'ThreadRow',
          key: 'reply-sort-tabs',
          itemType: 'reply-sort-tabs',
          pageY: 80,
          height: 52,
          bottom: 132,
          mountOrder: 2,
          stylePosition: 'absolute',
          styleZIndex: 40,
          styleElevation: 6,
          deltaY: -120,
          visible: true,
          reason: 'layout',
          overlapCount: 1,
          outsideContainer: true,
          containerViolationCount: 1,
          overlaps: [
            {
              key: 't_post',
              component: 'ThreadRow',
              itemType: 'target',
              mountOrder: 1,
              y: 72,
              height: 220,
              overlapArea: 1600,
            },
          ],
          containerViolations: [
            {
              key: 'thread-container',
              component: 'ThreadListContainer',
              itemType: 'container',
              mountOrder: 0,
              y: 96,
              height: 500,
              overflowTop: 16,
              overflowBottom: 0,
              overflowLeft: 0,
              overflowRight: 0,
              overflowX: 0,
              overflowY: 16,
            },
          ],
        },
      }),
      entry({
        t: 2,
        event: 'feed.shift.note.height',
        device: ios,
        params: { component: 'NoteContent', key: 'evt', delta: 32 },
      }),
      entry({
        t: 3,
        event: 'visual.layout.item_size_changed',
        level: 'warn',
        device: ios,
        params: {
          scope: 'thread.abc.list',
          surface: 'thread',
          component: 'ThreadLegendList',
          key: 'reply-sort-tabs',
          itemType: 'reply-sort-tabs',
          index: 1,
          itemSize: 52,
          previousItemSize: 220,
          deltaItemSize: -168,
          sizeJump: true,
        },
      }),
      entry({
        t: 4,
        event: 'visual.layout.list_metrics',
        device: ios,
        params: {
          scope: 'thread.abc.list',
          surface: 'thread',
          component: 'ThreadLegendList',
          size: 720,
          scroll: 20,
          scrollLength: 1180,
          contentLength: 1800,
          rows: 8,
        },
      }),
      entry({
        t: 5,
        event: 'visual.layout.viewability',
        device: ios,
        params: {
          scope: 'thread.abc.list',
          surface: 'thread',
          component: 'ThreadLegendList',
          start: 0,
          end: 3,
          viewableCount: 3,
          changedCount: 1,
          rows: 8,
          viewable: [
            {
              key: 't_post',
              index: 0,
              itemType: 'target',
              isViewable: true,
              virtualY: 0,
              virtualH: 220,
              virtualBottom: 220,
            },
            {
              key: 'reply-sort-tabs',
              index: 1,
              itemType: 'reply-sort-tabs',
              isViewable: true,
              virtualY: 220,
              virtualH: 52,
              virtualBottom: 272,
            },
            { key: 'reply-2', index: 2, itemType: 'reply', isViewable: true },
          ],
          buffered: [
            { key: 't_post', index: 0, itemType: 'target', virtualY: 0, virtualH: 220 },
            {
              key: 'reply-sort-tabs',
              index: 1,
              itemType: 'reply-sort-tabs',
              virtualY: 220,
              virtualH: 52,
            },
            { key: 'reply-2', index: 2, itemType: 'reply', virtualY: 272, virtualH: 180 },
          ],
        },
      }),
      entry({
        t: 5.5,
        event: 'visual.layout.sticky_header',
        device: ios,
        params: {
          scope: 'thread.abc.list',
          surface: 'thread',
          component: 'ThreadLegendList',
          key: 'reply-sort-tabs',
          itemType: 'reply-sort-tabs',
          index: 1,
          rows: 8,
          activeStickyIndex: 1,
          virtualY: 220,
          virtualH: 52,
          virtualBottom: 272,
        },
      }),
      entry({
        t: 6,
        event: 'visual.layout.virtual_positions',
        device: ios,
        params: {
          scope: 'thread.abc.list',
          surface: 'thread',
          component: 'ThreadLegendList',
          totalRows: 3,
          chunkIndex: 0,
          chunkCount: 1,
          rowCount: 3,
          virtualAnomaly: false,
          duplicateKeyCount: 0,
          farVirtualCount: 0,
          invalidSizeCount: 0,
          missingSizeCount: 0,
          missingVirtualPositionCount: 0,
          outsideContentLengthCount: 0,
          virtualOverlapCount: 0,
          virtualOrderBreakCount: 0,
          rows: [
            { key: 't_post', index: 0, itemType: 'target', virtualY: 0, virtualH: 220 },
            {
              key: 'reply-sort-tabs',
              index: 1,
              itemType: 'reply-sort-tabs',
              virtualY: 220,
              virtualH: 52,
            },
            { key: 'reply-2', index: 2, itemType: 'reply', virtualY: 272, virtualH: 180 },
          ],
        },
      }),
      entry({
        t: 7,
        event: 'visual.layout.virtual_positions',
        level: 'warn',
        device: ios,
        params: {
          scope: 'thread.bad.list',
          surface: 'thread',
          component: 'ThreadLegendList',
          totalRows: 3,
          chunkIndex: 0,
          chunkCount: 1,
          rowCount: 3,
          virtualAnomaly: true,
          duplicateKeyCount: 1,
          farVirtualCount: 1,
          invalidSizeCount: 0,
          missingSizeCount: 0,
          missingVirtualPositionCount: 0,
          outsideContentLengthCount: 1,
          virtualOverlapCount: 1,
          virtualOrderBreakCount: 0,
          rows: [
            { key: 'dup', index: 0, itemType: 'reply', virtualY: 0, virtualH: 80 },
            { key: 'dup', index: 1, itemType: 'reply', virtualY: 0, virtualH: 80 },
            { key: 'far', index: 2, itemType: 'reply', virtualY: 500, virtualH: 90 },
          ],
        },
      }),
      entry({
        t: 7.5,
        event: 'visual.layout.scope_snapshot',
        level: 'warn',
        device: ios,
        params: {
          scope: 'thread.abc.list',
          reason: 'scroll',
          measuredRequested: 3,
          totalRows: 3,
          chunkIndex: 0,
          chunkCount: 1,
          rowCount: 3,
          measuredRows: 2,
          unmeasuredRows: 1,
          staleRows: 1,
          visibleRows: 2,
          containerRows: 0,
          measuredOverlapCount: 1,
          measuredOrderBreakCount: 0,
          containerViolationCount: 1,
          zeroAreaCount: 0,
          farOutsideXCount: 0,
          farOutsideYCount: 0,
          absurdWidthCount: 0,
          absurdHeightCount: 0,
          snapshotAnomaly: true,
          rows: [
            {
              key: 't_post',
              component: 'ThreadRow',
              itemType: 'target',
              index: 0,
              y: 72,
              height: 220,
              bottom: 292,
              mountOrder: 1,
              stylePosition: 'relative',
              flags: ['overlap:reply-sort-tabs'],
            },
            {
              key: 'reply-sort-tabs',
              component: 'ThreadRow',
              itemType: 'reply-sort-tabs',
              index: 1,
              y: 80,
              height: 52,
              bottom: 132,
              mountOrder: 2,
              stylePosition: 'absolute',
              styleZIndex: 40,
              flags: ['overlap:t_post', 'outsideContainer:1'],
            },
            {
              key: 'reply-2',
              component: 'ThreadRow',
              itemType: 'reply',
              index: 2,
              y: null,
              height: null,
              bottom: null,
              mountOrder: 3,
              flags: ['stale'],
            },
          ],
        },
      }),
      entry({
        t: 7.75,
        event: 'visual.layout.state_change',
        device: ios,
        params: {
          scope: 'composer.post',
          surface: 'composer',
          component: 'PostComposer',
          stateKey: 'composer-state',
          phase: 'uploading',
          signature: '{busy:false,keyboardVisible:true,mediaCount:1}',
          previousSignature: '{busy:false,keyboardVisible:true,mediaCount:0}',
          firstMeasure: false,
          state: {
            busy: false,
            keyboardVisible: true,
            mediaCount: 1,
            hasPoll: false,
            overBudget: false,
          },
        },
      }),
      entry({
        t: 8,
        event: 'visual.layout.measure',
        device: ios,
        params: {
          scope: 'composer.post',
          surface: 'composer',
          component: 'PostComposerMediaUploadIndicator',
          key: 'media-upload:m1',
          itemType: 'activity-indicator',
          pageY: 320,
          height: 20,
          bottom: 340,
          visible: true,
          reason: 'layout',
          overlapCount: 0,
        },
      }),
      entry({
        t: 9,
        event: 'visual.layout.measure',
        device: ios,
        params: {
          scope: 'loading.text',
          surface: 'shared',
          component: 'TextLoading',
          key: 'text-loading:1',
          itemType: 'text-loading',
          pageY: 344,
          height: 16,
          bottom: 360,
          visible: true,
          reason: 'layout',
          overlapCount: 0,
        },
      }),
      entry({
        t: 10,
        event: 'visual.layout.measure',
        device: ios,
        params: {
          scope: 'loading.avatar',
          surface: 'shared',
          component: 'AvatarLoading',
          key: 'avatar-loading:1',
          itemType: 'avatar-loading',
          pageY: 368,
          height: 48,
          bottom: 416,
          visible: true,
          reason: 'layout',
          overlapCount: 0,
        },
      }),
      entry({
        t: 11,
        event: 'visual.layout.measure',
        device: ios,
        params: {
          scope: 'feed.notifications.all.list',
          surface: 'notifications',
          component: 'NotificationListRow',
          key: 'notification:n1',
          itemType: 'reaction',
          index: 0,
          pageY: 430,
          height: 84,
          bottom: 514,
          visible: true,
          reason: 'layout',
          overlapCount: 0,
        },
      }),
      entry({
        t: 12,
        event: 'visual.layout.list_metrics',
        device: ios,
        params: {
          scope: 'feed.notifications.all.list',
          surface: 'notifications',
          component: 'NotificationsFlatList',
          size: 700,
          scroll: 0,
          scrollLength: 700,
          contentLength: 1040,
          rows: 2,
          hasListState: false,
          metricJump: false,
        },
      }),
      entry({
        t: 13,
        event: 'visual.layout.viewability',
        device: ios,
        params: {
          scope: 'feed.notifications.all.list',
          surface: 'notifications',
          component: 'NotificationsFlatList',
          start: 0,
          end: 1,
          startBuffered: 0,
          endBuffered: 1,
          viewableCount: 2,
          changedCount: 2,
          rows: 2,
          hasListState: false,
          viewable: [
            {
              key: 'notification:n1',
              index: 0,
              itemType: 'reaction',
              rowLabel: 'single',
              isViewable: true,
              virtualY: null,
              virtualH: null,
              virtualBottom: null,
            },
            {
              key: 'notification:n2',
              index: 1,
              itemType: 'follow',
              rowLabel: 'single',
              isViewable: true,
              virtualY: null,
              virtualH: null,
              virtualBottom: null,
            },
          ],
          changed: [
            { key: 'notification:n1', index: 0, itemType: 'reaction', isViewable: true },
            { key: 'notification:n2', index: 1, itemType: 'follow', isViewable: true },
          ],
          buffered: [],
        },
      }),
      entry({
        t: 14,
        event: 'visual.layout.list_metrics',
        device: ios,
        params: {
          scope: 'composer.post',
          surface: 'composer',
          component: 'PostComposerScrollView',
          size: 620,
          scroll: 180,
          scrollLength: 620,
          contentLength: 980,
          rows: 0,
          axis: 'y',
          scrollReason: 'scroll',
          contentWidth: 390,
          contentHeight: 980,
          viewportWidth: 390,
          viewportHeight: 620,
          hasListState: false,
          metricJump: false,
        },
      }),
    ];
    const output = modeVisual(entries, parseArgs(['node', 'log-doctor', 'visual']));

    expect(output).toContain('VISUAL LAYOUT LOG');
    expect(output).toContain('ANOMALIES');
    expect(output).toContain('LATEST LIST METRICS');
    expect(output).toContain('STICKY HEADER CHANGES');
    expect(output).toContain('LATEST VIEWABILITY');
    expect(output).toContain('VIEWABLE POSITION COVERAGE');
    expect(output).toContain('BUFFERED VIRTUAL POSITIONS');
    expect(output).toContain('FULL VIRTUAL POSITION SNAPSHOTS');
    expect(output).toContain('MEASURED SCOPE SNAPSHOTS');
    expect(output).toContain('ORDER/GAP ANALYSIS');
    expect(output).toContain('LAYOUT STATE CHANGES');
    expect(output).toContain('SIZE/POSITION CORRELATION');
    expect(output).toContain('LATEST ITEM SIZES');
    expect(output).toContain('LATEST MEASURED POSITIONS');
    expect(output).toContain('thread.abc.list: rows=2');
    expect(output).toContain(
      'key=reply-sort-tabs type=reply-sort-tabs idx=1 virtualH=52 measuredH=52 dH=0'
    );
    expect(output).toContain(
      'ThreadLegendList key=reply-sort-tabs type=reply-sort-tabs idx=1 size=52'
    );
    expect(output).toContain(
      'thread.abc.list: changes=1 component=ThreadLegendList key=reply-sort-tabs type=reply-sort-tabs idx=1 activeSticky=1 virtualY=220 virtualH=52 rows=8'
    );
    expect(output).toContain('ThreadRow key=t_post type=target y=72 h=220');
    expect(output).toContain(
      'thread.abc.list: viewable=3 positioned=2 virtualPositioned=2 missingPosition=1 missingVirtualPosition=1 missingSize=1 missingKey=0'
    );
    expect(output).toContain(
      'feed.notifications.all.list: NotificationsFlatList size=700 scroll=0 scrollLen=700 contentLen=1040'
    );
    expect(output).toContain(
      'composer.post: PostComposerScrollView size=620 scroll=180 scrollLen=620 contentLen=980'
    );
    expect(output).toContain('axis=y reason=scroll');
    expect(output).toContain(
      'feed.notifications.all.list: NotificationsFlatList range=0-1 viewable=2 changed=2 rows=2 items=[0:reaction, 1:follow]'
    );
    expect(output).toContain(
      'feed.notifications.all.list: viewable=2 positioned=1 virtualPositioned=0 missingPosition=1 missingVirtualPosition=2 missingSize=1 missingKey=0'
    );
    expect(output).toContain(
      'key=reply-2 type=reply idx=2 y=? h=? virtualY=? virtualH=? virtualBottom=? visible=true flags=missingPosition,missingVirtualPosition,missingSize'
    );
    expect(output).toContain(
      'key=notification:n1 type=reaction idx=0 y=430 h=84 virtualY=? virtualH=84 virtualBottom=? visible=true flags=missingVirtualPosition'
    );
    expect(output).toContain(
      'key=notification:n2 type=follow idx=1 y=? h=? virtualY=? virtualH=? virtualBottom=? visible=true flags=missingPosition,missingVirtualPosition,missingSize'
    );
    expect(output).toContain(
      'key=reply-2 type=reply idx=2 virtualY=272 virtualH=180 virtualBottom=? flags=-'
    );
    expect(output).toContain(
      'thread.abc.list: rows=3 chunks=1/1 virtualPositioned=3 missingMeasuredPosition=1 missingVirtualPosition=0 missingSize=0 invalidSize=0 farVirtual=0 outsideContent=0 duplicateKeys=0 virtualOverlaps=0 orderBreaks=0'
    );
    expect(output).toContain(
      'key=reply-sort-tabs type=reply-sort-tabs idx=1 virtualY=220 virtualH=52 virtualBottom=? measuredY=80 measuredH=52 flags=-'
    );
    expect(output).toContain(
      'key=reply-2 type=reply idx=2 virtualY=272 virtualH=180 virtualBottom=? measuredY=? measuredH=? flags=missingMeasuredPosition'
    );
    expect(output).toContain(
      'thread.bad.list: rows=3 chunks=1/1 virtualPositioned=3 missingMeasuredPosition=3 missingVirtualPosition=0 missingSize=0 invalidSize=0 farVirtual=1 outsideContent=1 duplicateKeys=1 virtualOverlaps=1 orderBreaks=0'
    );
    expect(output).toContain(
      'virtualOverlap=1 orderBreak=0 duplicateKeys=1 missingVirtual=0 missingSize=0 invalidSize=0 farVirtual=1 outsideContent=1'
    );
    expect(output).toContain(
      'WARN measured-order scope=thread.abc.list rows=3 measured=2 virtual=3 measuredOverlaps=1 orderBreaks=0 virtualDeltaMismatches=1 largeGaps=0'
    );
    expect(output).toContain(
      'thread.abc.list: rows=3 measured=2 virtual=3 measuredOverlaps=1 orderBreaks=0 virtualDeltaMismatches=1 largeGaps=0'
    );
    expect(output).toContain(
      'key=reply-sort-tabs type=reply-sort-tabs idx=1 y=80 bottom=132 virtualY=220 virtualH=52 virtualBottom=272 flags=measuredOverlap:212,virtualDeltaMismatch:-212'
    );
    expect(output).toContain(
      'scope-snapshot scope=thread.abc.list reason=scroll chunk=0/1 rows=3 measured=2 stale=1 overlaps=1 orderBreaks=0 containers=1 zero=0 farY=0'
    );
    expect(output).toContain(
      'thread.abc.list: rows=3 chunks=1/1 measured=2 stale=1 visible=2 containers=0 overlaps=1 orderBreaks=0 containerViolations=1 zero=0 farY=0 absurdH=0'
    );
    expect(output).toContain(
      'key=reply-sort-tabs type=reply-sort-tabs idx=1 y=80 h=52 bottom=132 mount=2 pos=absolute z=40 flags=overlap:t_post,outsideContainer:1'
    );
    expect(output).toContain(
      'composer.post: changes=1 component=PostComposer stateKey=composer-state phase=uploading first=false'
    );
    expect(output).toContain(
      'busy=false hasPoll=false keyboardVisible=true mediaCount=1 overBudget=false'
    );
    expect(output).toContain('feed.notifications.all.list: no buffered position snapshot');
    expect(output).toContain(
      'PostComposerMediaUploadIndicator key=media-upload:m1 type=activity-indicator y=320 h=20'
    );
    expect(output).toContain('TextLoading key=text-loading:1 type=text-loading y=344 h=16');
    expect(output).toContain('AvatarLoading key=avatar-loading:1 type=avatar-loading y=368 h=48');
    expect(output).toContain('reply-sort-tabs');
    expect(output).toContain('mount=2 pos=absolute z=40 elev=6');
    expect(output).toContain('mount=1 pos=relative');
    expect(output).toContain('area=1600 mount=1');
    expect(output).toContain('flags=overlap:1');
    expect(output).toContain('containers=1');
    expect(output).toContain('outside ThreadListContainer/container key=thread-container');
    expect(output).toContain('overflowX=0 overflowY=16');
    expect(output).toContain('outsideContainer:1');
    expect(output).toContain('dSize=-168');
    expect(output).toContain('overlaps ThreadRow/target');

    const containerOutput = modeVisual(
      entries,
      parseArgs(['node', 'log-doctor', 'visual', '--component', 'ThreadListContainer'])
    );
    expect(containerOutput).toContain('filters: component=ThreadListContainer');
    expect(containerOutput).toContain('reply-sort-tabs');
    expect(containerOutput).toContain('outside ThreadListContainer/container');
  });

  it('filters visual summaries by visual params', () => {
    const entries = [
      entry({
        t: 0,
        event: 'visual.layout.measure',
        device: ios,
        params: {
          scope: 'thread.abc.list',
          surface: 'thread',
          component: 'ThreadRow',
          key: 'target-post',
          itemType: 'target',
          pageY: 72,
          height: 220,
          bottom: 292,
          visible: true,
          reason: 'layout',
          overlapCount: 0,
        },
      }),
      entry({
        t: 1,
        event: 'visual.layout.measure',
        device: ios,
        params: {
          scope: 'composer.post',
          surface: 'composer',
          component: 'PostComposerToolbar',
          key: 'toolbar',
          itemType: 'toolbar',
          pageY: 700,
          height: 52,
          bottom: 752,
          visible: true,
          reason: 'layout',
          overlapCount: 0,
        },
      }),
      entry({
        t: 2,
        event: 'visual.layout.viewability',
        device: ios,
        params: {
          scope: 'feed.notifications.all.list',
          surface: 'notifications',
          component: 'NotificationsFlatList',
          start: 0,
          end: 1,
          startBuffered: 0,
          endBuffered: 1,
          viewableCount: 2,
          changedCount: 0,
          rows: 2,
          viewable: [
            {
              key: 'notification:n1',
              index: 0,
              itemType: 'reaction',
              rowLabel: 'single',
              isViewable: true,
            },
            {
              key: 'notification:n2',
              index: 1,
              itemType: 'follow',
              rowLabel: 'single',
              isViewable: true,
            },
          ],
          changed: [],
          buffered: [],
        },
      }),
      entry({
        t: 3,
        event: 'visual.layout.virtual_positions',
        device: ios,
        params: {
          scope: 'feed.notifications.all.list',
          surface: 'notifications',
          component: 'NotificationsFlatList',
          totalRows: 1,
          chunkIndex: 0,
          chunkCount: 1,
          rowCount: 1,
          rows: [
            {
              key: 'virtual-only',
              index: 2,
              itemType: 'virtual-row',
              rowLabel: 'virtual',
              virtualY: 220,
              virtualH: 88,
            },
          ],
        },
      }),
    ];

    const composerOutput = modeVisual(
      entries,
      parseArgs(['node', 'log-doctor', 'visual', '--scope', 'composer'])
    );
    expect(composerOutput).toContain('filters: scope=composer');
    expect(composerOutput).toContain('PostComposerToolbar');
    expect(composerOutput).not.toContain('ThreadRow');

    const componentOutput = modeVisual(
      entries,
      parseArgs(['node', 'log-doctor', 'visual', '--component', 'ThreadRow'])
    );
    expect(componentOutput).toContain('filters: component=ThreadRow');
    expect(componentOutput).toContain('target-post');
    expect(componentOutput).not.toContain('PostComposerToolbar');

    const nestedKeyOutput = modeVisual(
      entries,
      parseArgs(['node', 'log-doctor', 'visual', '--key', 'notification:n2'])
    );
    expect(nestedKeyOutput).toContain('filters: key=notification:n2');
    expect(nestedKeyOutput).toContain('NotificationsFlatList');
    expect(nestedKeyOutput).toContain('1:follow');
    expect(nestedKeyOutput).not.toContain('ThreadRow');

    const nestedItemTypeOutput = modeVisual(
      entries,
      parseArgs(['node', 'log-doctor', 'visual', '--item-type', 'reaction'])
    );
    expect(nestedItemTypeOutput).toContain('filters: itemType=reaction');
    expect(nestedItemTypeOutput).toContain('NotificationsFlatList');
    expect(nestedItemTypeOutput).toContain('0:reaction');
    expect(nestedItemTypeOutput).not.toContain('PostComposerToolbar');

    const virtualRowOutput = modeVisual(
      entries,
      parseArgs(['node', 'log-doctor', 'visual', '--key', 'virtual-only'])
    );
    expect(virtualRowOutput).toContain('filters: key=virtual-only');
    expect(virtualRowOutput).toContain('FULL VIRTUAL POSITION SNAPSHOTS');
    expect(virtualRowOutput).toContain('key=virtual-only type=virtual-row');
  });
});
