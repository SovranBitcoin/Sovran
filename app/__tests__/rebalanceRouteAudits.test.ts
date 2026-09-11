import type { AuditMintResponse } from '@/shared/lib/apiClient';
import { fetchRebalanceRouteAudits } from '@/features/mint/lib/rebalanceRouteAudits';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { resolve, promise };
}

test('audit reads use at most three concurrent requests and preserve candidate order', async () => {
  const candidates = Array.from({ length: 12 }, (_, i) => `https://mint-${i}.example`);
  const pending = candidates.map(() => deferred<AuditMintResponse | null>());
  // Reports are opaque to the loader; production graph building owns their shape.
  const reports = candidates.map((mintUrl) => ({ mintUrl }) as unknown as AuditMintResponse);
  let inFlight = 0;
  let maxInFlight = 0;
  const fetchAudit = jest.fn((url: string) => {
    inFlight++;
    maxInFlight = Math.max(maxInFlight, inFlight);
    return pending[candidates.indexOf(url)].promise.finally(() => {
      inFlight--;
    });
  });
  const result = fetchRebalanceRouteAudits(candidates, fetchAudit);
  expect(fetchAudit.mock.calls.map(([url]) => url)).toEqual(candidates.slice(0, 3));

  // A fast third response releases a worker while the first two are pending.
  pending[2].resolve(reports[2]);
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  expect(fetchAudit).toHaveBeenCalledTimes(4);
  for (let i = 0; i < pending.length; i++) pending[i].resolve(reports[i]);
  expect(await result).toEqual(reports);
  expect(maxInFlight).toBe(3);
  expect(fetchAudit).toHaveBeenCalledTimes(12);
});

test('failed best-effort audit results are omitted and the other routes remain available', async () => {
  const report = { mintUrl: 'https://available.example' } as unknown as AuditMintResponse;
  const fetchAudit = jest.fn().mockResolvedValueOnce(null).mockResolvedValueOnce(report);
  expect(await fetchRebalanceRouteAudits(['unavailable', 'available'], fetchAudit)).toEqual([
    report,
  ]);
});

test('no candidates make no requests', async () => {
  const fetchAudit = jest.fn();
  expect(await fetchRebalanceRouteAudits([], fetchAudit)).toEqual([]);
  expect(fetchAudit).not.toHaveBeenCalled();
});

test('unexpected audit exceptions still reject the route computation', async () => {
  const failure = new Error('audit parser failure');
  await expect(
    fetchRebalanceRouteAudits(['invalid'], async () => {
      throw failure;
    })
  ).rejects.toBe(failure);
});
