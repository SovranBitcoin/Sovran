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
