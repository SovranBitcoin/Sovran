import {
  clusterErrorEntries,
  errorClusterKey,
  normalizeErrorText,
  percentile,
  scanRedactionAudit,
  sparkline,
  summarizeDurations,
  type AnalyzableEntry,
} from '../analysis';

describe('percentile / summarizeDurations', () => {
  const samples = [100, 300, 500, 800, 1000];

  it('computes nearest-rank percentiles', () => {
    expect(percentile(samples, 50)).toBe(500);
    expect(percentile(samples, 95)).toBe(1000);
    expect(percentile(samples, 99)).toBe(1000);
    expect(percentile(samples, 0)).toBe(100);
  });

  it('is order-independent', () => {
    expect(percentile([1000, 100, 500, 300, 800], 50)).toBe(500);
  });

  it('handles the empty sample', () => {
    expect(percentile([], 50)).toBe(0);
    expect(summarizeDurations([])).toEqual({
      count: 0,
      min: 0,
      max: 0,
      avg: 0,
      p50: 0,
      p95: 0,
      p99: 0,
    });
  });

  it('summarizes min/max/avg/percentiles', () => {
    const d = summarizeDurations(samples);
    expect(d.count).toBe(5);
    expect(d.min).toBe(100);
    expect(d.max).toBe(1000);
    expect(d.avg).toBe(540);
    expect(d.p50).toBe(500);
  });
});

describe('sparkline', () => {
  it('returns empty for no samples', () => {
    expect(sparkline([])).toBe('');
  });

  it('collapses a uniform sample', () => {
    expect(sparkline([5, 5, 5])).toContain('all 5ms');
  });

  it('renders a min–max legend for a varied sample', () => {
    expect(sparkline([1, 2, 3, 100])).toContain('(1–100ms)');
  });
});

describe('normalizeErrorText', () => {
  it('collapses urls, uuids, hex and numbers', () => {
    expect(normalizeErrorText('connect to https://relay.example.com/ws failed')).toBe(
      'connect to <url> failed'
    );
    expect(normalizeErrorText('job 550e8400-e29b-41d4-a716-446655440000 stalled')).toBe(
      'job <uuid> stalled'
    );
    expect(normalizeErrorText('key abcdef0123456789 rejected')).toBe('key <hex> rejected');
    expect(normalizeErrorText('retry 42 of 99')).toBe('retry <n> of <n>');
  });
});

describe('error clustering', () => {
  const mk = (
    over: Partial<AnalyzableEntry> & { error?: AnalyzableEntry['error'] }
  ): AnalyzableEntry => ({
    level: 'error',
    event: 'net.fail',
    _t: 0,
    ...over,
  });

  it('gives two errors that differ only by ids the same cluster key', () => {
    const a = mk({
      error: { name: 'TimeoutError', message: 'timeout after 1200 ms', stack: [] },
      params: { url: 'https://a.com/1' },
    });
    const b = mk({
      error: { name: 'TimeoutError', message: 'timeout after 3400 ms', stack: [] },
      params: { url: 'https://a.com/2' },
    });
    expect(errorClusterKey(a)).toBe(errorClusterKey(b));
  });

  it('separates a genuinely different error', () => {
    const a = mk({ error: { name: 'TimeoutError', message: 'x', stack: [] } });
    const c = mk({ error: { name: 'NetworkError', message: 'x', stack: [] } });
    expect(errorClusterKey(a)).not.toBe(errorClusterKey(c));
  });

  it('clusters with counts, exemplar and time span', () => {
    const entries: AnalyzableEntry[] = [
      mk({
        _t: 10,
        error: { name: 'TimeoutError', message: 'timeout after 1 ms', stack: [] },
        params: { url: 'https://a.com/1' },
      }),
      mk({
        _t: 50,
        error: { name: 'TimeoutError', message: 'timeout after 9 ms', stack: [] },
        params: { url: 'https://a.com/2' },
      }),
      mk({ _t: 30, error: { name: 'NetworkError', message: 'down', stack: [] } }),
    ];
    const clusters = clusterErrorEntries(entries.map((entry, index) => ({ entry, index })));
    expect(clusters).toHaveLength(2);
    expect(clusters[0].count).toBe(2); // sorted by count desc
    expect(clusters[0].firstT).toBe(10);
    expect(clusters[0].lastT).toBe(50);
    expect(clusters[0].exemplarIndex).toBe(0);
  });
});

describe('scanRedactionAudit', () => {
  it('counts brands, inline markers, and flags un-redacted secrets by tier', () => {
    const entries: AnalyzableEntry[] = [
      { level: 'info', event: 'auth.login', params: { key: { _kind: 'nsec', len: 63 } } },
      { level: 'info', event: 'wallet.recv', params: { msg: 'got <REDACTED:cashu-token> ok' } },
      {
        level: 'warn',
        event: 'profile.import',
        params: { leaked: 'nsec1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq' },
      },
      { level: 'debug', event: 'nostr.event', params: { pubkey: 'a'.repeat(64) } },
    ];
    const audit = scanRedactionAudit(entries);

    expect(audit.brandCounts.nsec).toBe(1);
    expect(audit.redactedSubstrCounts['cashu-token']).toBe(1);
    expect(audit.totalRedactions).toBe(2);

    const nsec = audit.suspicious.find((s) => s.category === 'nsec');
    expect(nsec?.highSignal).toBe(true);
    expect(nsec?.sampleEvents).toContain('profile.import');

    const hex64 = audit.suspicious.find((s) => s.category === 'hex64');
    expect(hex64?.highSignal).toBe(false);

    // high-signal findings sort ahead of low-signal ones
    expect(audit.suspicious[0].highSignal).toBe(true);
  });

  it('does not flag a value once the logger has branded it', () => {
    const audit = scanRedactionAudit([
      { level: 'info', event: 'x', params: { sk: { _kind: 'private_key', len: 64 } } },
    ]);
    expect(audit.suspicious).toHaveLength(0);
    expect(audit.brandCounts.private_key).toBe(1);
  });
});

describe('analyzeReads / summarizeReads (reads mode)', () => {
  const { analyzeReads, summarizeReads } = jest.requireActual<typeof import('../analysis')>('../analysis');
  const e = (t: number, event: string, params: Record<string, unknown>): AnalyzableEntry => ({
    level: 'info',
    event,
    _t: t,
    params,
  });
  const id = (surface: string, keyHash: string, n: number) => ({ readId: `r${n}-${surface}`, surface, keyHash });

  it('computes TTFUD from request → first populated render with the same readId', () => {
    const r = id('feed', 'k_a', 1);
    const { runs } = analyzeReads([
      e(0, 'read.feed.request', { ...r, action: 'fetch', trigger: 'mount', cached: false, stale: false }),
      e(2, 'read.feed.render', { ...r, phase: 'skeleton' }),
      e(150, 'read.feed.done', { ...r, tier: 'nagg', count: 3 }),
      e(160, 'read.feed.render', { ...r, phase: 'populated' }),
      e(999, 'read.feed.render', { ...r, phase: 'populated' }), // later renders never move TTFUD
    ]);
    expect(runs).toHaveLength(1);
    expect(runs[0]!.firstPopulatedT).toBe(160);
    expect(runs[0]!.ok).toBe(true);
    expect([...runs[0]!.sources]).toEqual(['nagg']);
    const [summary] = summarizeReads(runs);
    expect(summary).toMatchObject({ surface: 'feed', reads: 1, cacheHit: 0, ttfudMs: [160] });
  });

  it('flags a fetch issued over a fresh entry without a user trigger as RefetchFresh', () => {
    const fresh = id('profile', 'k_p', 2);
    const user = id('profile', 'k_p', 3);
    const served = id('profile', 'k_p', 4);
    const { runs } = analyzeReads([
      e(0, 'read.profile.request', { ...fresh, action: 'fetch', trigger: 'focus', cached: true, stale: false }),
      e(10, 'read.profile.request', { ...user, action: 'fetch', trigger: 'user', cached: true, stale: false }),
      e(20, 'read.profile.request', { ...served, action: 'serve-fresh', trigger: 'focus', cached: true, stale: false }),
    ]);
    const [summary] = summarizeReads(runs);
    expect(summary).toMatchObject({ reads: 3, cacheHit: 3, serveFresh: 1, refetchFresh: 1 });
  });

  it('counts superseded and failed reads and collects fill sources from facade events', () => {
    const a = id('searchProfiles', 'k_s', 5);
    const b = id('searchProfiles', 'k_s', 6);
    const { runs } = analyzeReads([
      e(0, 'read.searchProfiles.request', { ...a, action: 'fetch', trigger: 'key-change', cached: false, stale: false }),
      e(5, 'read.searchProfiles.request', { ...b, action: 'fetch', trigger: 'key-change', cached: false, stale: false }),
      e(50, 'read.searchProfiles.superseded', { ...a, reason: 'newer-request' }),
      e(60, 'nostr.read.searchProfiles.done', { readId: b.readId, tier: 'nagg' }),
      e(70, 'nostr.tier.aggregate.merged', { readId: b.readId, tier: 'relay' }),
      e(80, 'read.searchProfiles.done', { ...b, sources: ['nagg', 'relay'], degraded: false, count: 4 }),
      e(90, 'read.searchProfiles.request', { ...id('searchProfiles', 'k_t', 7), action: 'fetch', trigger: 'key-change', cached: false, stale: false }),
      e(95, 'read.searchProfiles.failed', { ...id('searchProfiles', 'k_t', 7), errorType: 'network', retained: false }),
    ]);
    const [summary] = summarizeReads(runs);
    expect(summary).toMatchObject({ reads: 3, superseded: 1, failed: 1 });
    expect(summary!.sources.get('nagg')).toBe(1);
    expect(summary!.sources.get('relay')).toBe(1);
  });

  it('detects a blank flash (populated → skeleton → populated within 2s) and ignores a slow reload', () => {
    const r = id('notifications', 'k_n', 8);
    const { blankFlashes } = analyzeReads([
      e(0, 'read.notifications.render', { ...r, phase: 'populated' }),
      e(100, 'read.notifications.render', { ...r, phase: 'skeleton' }),
      e(400, 'read.notifications.render', { ...r, phase: 'populated' }),
      e(1000, 'read.notifications.render', { ...r, phase: 'skeleton' }),
      e(9000, 'read.notifications.render', { ...r, phase: 'populated' }), // 8s: a reload, not a flash
    ]);
    expect(blankFlashes).toEqual([{ surface: 'notifications', keyHash: 'k_n', t: 100, gapMs: 300 }]);
  });
});
