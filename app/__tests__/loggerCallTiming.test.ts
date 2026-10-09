/**
 * @jest-environment node
 *
 * The timing proxy stands in for the coco Manager everywhere it is handed out,
 * so it has to be invisible to callers: same results, same errors, same `this`,
 * a stable identity — and one `coco.call` entry per call.
 */

import { createLogger } from '@/shared/lib/logger';
import { withCallTiming } from '@/shared/lib/loggerCallTiming';

class FakeWalletApi {
  private balance = 21;
  getBalance() {
    return this.balance;
  }
  async receive(amount: number) {
    return { received: amount + this.balance };
  }
  failSync(): never {
    throw new Error('sync boom');
  }
  async failAsync(): Promise<never> {
    throw new Error('async boom');
  }
}

class FakeManager {
  readonly wallet = new FakeWalletApi();
  readonly ops = { send: { prepare: async (amount: number) => ({ prepared: amount }) } };
  readonly proofService = { getReadyProofs: () => ['proof'] };
  private disposed = false;
  dispose() {
    this.disposed = true;
    return this.disposed;
  }
}

function setup(level: 'debug' | 'warn' = 'debug') {
  const logger = createLogger({ level, async: false, transports: [], pretty: false });
  const manager = new FakeManager();
  const timed = withCallTiming(manager, {
    event: 'coco.call',
    logger,
    namespaces: ['wallet', 'ops'],
  });
  const calls = () =>
    logger
      .getRecentLogs()
      .filter((entry) => entry.event === 'coco.call')
      .map((entry) => entry.params as Record<string, unknown>);
  return { manager, timed, calls };
}

describe('withCallTiming', () => {
  it('returns sync results unchanged, runs methods against the real object, and times them', () => {
    const { timed, calls } = setup();

    expect(timed.wallet.getBalance()).toBe(21);
    expect(timed.dispose()).toBe(true);

    expect(calls()).toEqual([
      { method: 'wallet.getBalance', duration_ms: expect.any(Number), async: false, ok: true },
      { method: 'dispose', duration_ms: expect.any(Number), async: false, ok: true },
    ]);
  });

  it('hands back the original promise and reports once it settles', async () => {
    const { manager, timed, calls } = setup();
    const original = Promise.resolve({ received: 1 });
    jest.spyOn(manager.wallet, 'receive').mockReturnValue(original);

    const returned = timed.wallet.receive(1);

    expect(returned).toBe(original);
    expect(calls()).toEqual([]);
    await expect(returned).resolves.toEqual({ received: 1 });
    expect(calls()).toEqual([
      { method: 'wallet.receive', duration_ms: expect.any(Number), async: true, ok: true },
    ]);
  });

  it('follows nested namespaces and names the full method path', async () => {
    const { timed, calls } = setup();

    await expect(timed.ops.send.prepare(5)).resolves.toEqual({ prepared: 5 });

    expect(calls().map((call) => call.method)).toEqual(['ops.send.prepare']);
  });

  it('rethrows a sync error and passes a rejection through, marking both failed', async () => {
    const { timed, calls } = setup();

    expect(() => timed.wallet.failSync()).toThrow('sync boom');
    await expect(timed.wallet.failAsync()).rejects.toThrow('async boom');

    expect(calls()).toEqual([
      { method: 'wallet.failSync', duration_ms: expect.any(Number), async: false, ok: false },
      { method: 'wallet.failAsync', duration_ms: expect.any(Number), async: true, ok: false },
    ]);
  });

  it('keeps one identity per object and per method, usable as a WeakMap key', () => {
    const { manager, timed } = setup();

    expect(timed).not.toBe(manager);
    expect(timed).toBeInstanceOf(FakeManager);
    expect(timed.wallet).toBe(timed.wallet);
    expect(timed.wallet.receive).toBe(timed.wallet.receive);
    expect(timed.ops.send).toBe(timed.ops.send);
    const keyed = new WeakMap<object, string>([[timed, 'profile']]);
    expect(keyed.get(timed)).toBe('profile');
  });

  it('leaves objects outside the listed namespaces untouched', () => {
    const { manager, timed, calls } = setup();

    expect(timed.proofService).toBe(manager.proofService);
    expect(timed.proofService.getReadyProofs()).toEqual(['proof']);
    expect(calls()).toEqual([]);
  });

  it('never logs arguments or results', async () => {
    const { timed, calls } = setup();

    await timed.wallet.receive(4242);

    expect(JSON.stringify(calls())).not.toContain('4242');
    expect(Object.keys(calls()[0]).sort()).toEqual(['async', 'duration_ms', 'method', 'ok']);
  });

  it('returns the target itself when debug entries would not be emitted', () => {
    const { manager, timed, calls } = setup('warn');

    expect(timed).toBe(manager);
    expect(timed.wallet.getBalance()).toBe(21);
    expect(calls()).toEqual([]);
  });
});
