/**
 * @jest-environment node
 */

import {
  extractLatestSession,
  filterEntries,
  modeDevices,
  modePayment,
  modeToasts,
  parseArgs,
  parseLogInput,
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
});
