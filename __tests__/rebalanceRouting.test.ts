/**
 * @jest-environment node
 */
import type { GetInfoResponse } from '@cashu/cashu-ts';

import { computeRouteSuggestion } from '@/features/mint/lib/rebalanceRouting';
import type { AuditMintResponse } from '@/shared/lib/apiClient';
import type { MiddlemanRoutingSettings } from '@/shared/stores/global/settingsStore';

const mockBuildSwapGraph = jest.fn();
const mockAddLocalHistoryEdges = jest.fn();
const mockGetLocalCandidates = jest.fn((..._args: unknown[]) => [] as string[]);
const mockPickIntermediaryPath = jest.fn();

jest.mock('@/features/mint/components/rebalance', () => ({
  buildSwapGraph: (...args: unknown[]) => mockBuildSwapGraph(...args),
  addLocalHistoryEdges: (...args: unknown[]) => mockAddLocalHistoryEdges(...args),
  getLocalCandidatesForDestination: (...args: unknown[]) => mockGetLocalCandidates(...args),
  pickIntermediaryPath: (...args: unknown[]) => mockPickIntermediaryPath(...args),
}));

// Variable-based casts (the repo bans object-literal type assertions).
function fakeAudit(url: string): AuditMintResponse {
  const audit = { mintUrl: url };
  return audit as unknown as AuditMintResponse;
}
function mintInfo(name: string): GetInfoResponse {
  const info = { name };
  return info as unknown as GetInfoResponse;
}
const emptyRouting = (() => {
  const r = {};
  return r as unknown as MiddlemanRoutingSettings;
})();
const emptyMintInfo: Record<string, GetInfoResponse | null> = {};

const baseInput = () => ({
  fromMintUrl: 'https://a.mint',
  toMintUrl: 'https://b.mint',
  planMintUrls: ['https://a.mint', 'https://b.mint'],
  trustedMintUrls: ['https://t.mint'],
  mintInfoMap: emptyMintInfo,
  middlemanRouting: emptyRouting,
  groups: [],
  fetchAudit: jest.fn(async (url: string) => fakeAudit(url)),
});

describe('computeRouteSuggestion', () => {
  beforeEach(() => {
    mockBuildSwapGraph.mockReset().mockReturnValue({});
    mockAddLocalHistoryEdges.mockReset();
    mockGetLocalCandidates.mockReset().mockReturnValue([]);
    mockPickIntermediaryPath.mockReset();
  });

  it('returns null when no intermediary path is found', async () => {
    mockPickIntermediaryPath.mockReturnValue({ path: null });
    const result = await computeRouteSuggestion(baseInput());
    expect(result).toBeNull();
  });

  it('maps a found path to display names, falling back to the url', async () => {
    mockPickIntermediaryPath.mockReturnValue({ path: ['https://a.mint', 'https://x.mint'] });
    const result = await computeRouteSuggestion({
      ...baseInput(),
      mintInfoMap: { 'https://a.mint': mintInfo('Alpha') },
    });
    expect(result).toEqual({
      path: ['https://a.mint', 'https://x.mint'],
      pathNames: ['Alpha', 'https://x.mint'],
    });
  });

  it('dedupes candidates and audits each via the injected port', async () => {
    mockGetLocalCandidates.mockReturnValue(['https://local.mint', 'https://a.mint']);
    mockPickIntermediaryPath.mockReturnValue({ path: null });
    const input = baseInput();
    await computeRouteSuggestion(input);
    const auditedUrls = input.fetchAudit.mock.calls.map((c) => c[0]);
    // 'a' appears in both plan and local candidates — must be audited once.
    expect(new Set(auditedUrls).size).toBe(auditedUrls.length);
    expect(auditedUrls).toEqual(
      expect.arrayContaining([
        'https://a.mint',
        'https://b.mint',
        'https://t.mint',
        'https://local.mint',
      ])
    );
  });

  it('passes only successful audits to the graph builder', async () => {
    mockPickIntermediaryPath.mockReturnValue({ path: null });
    const input = {
      ...baseInput(),
      fetchAudit: jest.fn(async (url: string) =>
        url === 'https://b.mint' ? null : fakeAudit(url)
      ),
    };
    await computeRouteSuggestion(input);
    const audits = mockBuildSwapGraph.mock.calls[0][0] as { mintUrl: string }[];
    expect(audits.some((a) => a.mintUrl === 'https://b.mint')).toBe(false);
    expect(audits.length).toBeGreaterThan(0);
  });

  it('caps the candidate set at 12 audits', async () => {
    mockGetLocalCandidates.mockReturnValue(
      Array.from({ length: 30 }, (_, i) => `https://m${i}.mint`)
    );
    mockPickIntermediaryPath.mockReturnValue({ path: null });
    const input = baseInput();
    await computeRouteSuggestion(input);
    expect(input.fetchAudit.mock.calls.length).toBeLessThanOrEqual(12);
  });
});
