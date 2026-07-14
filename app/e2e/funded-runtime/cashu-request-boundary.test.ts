import { Mint } from '@cashu/cashu-ts';
import { afterEach, describe, expect, it } from 'bun:test';

import { withBoundedCashuRequests } from './cashu-request-boundary';

let server: ReturnType<typeof Bun.serve> | undefined;

afterEach(() => {
  void server?.stop(true);
  server = undefined;
});

describe('startup Cashu request boundary', () => {
  it('aborts a mint request that accepts a connection but never completes', async () => {
    server = Bun.serve({
      port: 0,
      fetch: () => new Promise<Response>(() => {}),
    });
    const startedAt = Date.now();

    await expect(
      withBoundedCashuRequests({ deadlineMs: 30, requestTimeoutMs: 1_000 }, async () =>
        new Mint(`http://127.0.0.1:${server!.port}`).getInfo()
      )
    ).rejects.toThrow(/aborted/i);

    expect(Date.now() - startedAt).toBeLessThan(500);
  });
});
