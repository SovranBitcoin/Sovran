import { extractLatestSession } from '../index';

type Entry = Parameters<typeof extractLatestSession>[0][number];

const entry = (logSessionId: string | null, _t: number, event: string): Entry => ({
  ts: '2026-10-12T15:31:59.357Z',
  level: 'debug',
  event,
  _t,
  src: 'test',
  device: logSessionId === null ? {} : { platform: 'ios', logSessionId },
});

describe('extractLatestSession (--latest)', () => {
  beforeEach(() => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('keeps a whole run whose entries Metro delivered out of order', () => {
    const run = [
      entry('run-a', 100, 'app.start'),
      entry('run-a', 7769, 'wallet.open'),
      entry('run-a', 3672, 'keyring.scrub'),
      entry('run-a', 9000, 'screen.mount'),
    ];
    expect(extractLatestSession(run).map((e) => e.event)).toEqual([
      'app.start',
      'wallet.open',
      'keyring.scrub',
      'screen.mount',
    ]);
  });

  it('starts at the restart when the run id changes', () => {
    const runs = [
      entry('run-a', 100, 'app.start'),
      entry('run-a', 9000, 'screen.mount'),
      entry('run-b', 50, 'app.start'),
      entry('run-b', 900, 'wallet.open'),
    ];
    expect(extractLatestSession(runs).map((e) => e._t)).toEqual([50, 900]);
  });

  it('takes a clock that goes backwards as a restart when entries carry no run id', () => {
    const noId = (t: number, event: string) => entry(null, t, event);
    const runs = [noId(100, 'app.start'), noId(9000, 'screen.mount'), noId(50, 'app.start')];
    expect(extractLatestSession(runs).map((e) => e._t)).toEqual([50]);
  });
});
