import { describe, expect, it } from 'bun:test';
import { mkdirSync, mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  mintFaultRuleSchema,
  mintFaultRuleSetSchema,
  parseMintFaultRuleSet,
  serializeMintFaultRuleSet,
  type MintFaultRule,
} from '../../shared/lib/e2e/mintFaults/rules';
import { MintFaultEngine } from '../../shared/lib/e2e/mintFaults/engine';
import { createSimulatorMintFaultChannel, FakeMintFaultChannel } from './mint-faults';

const rule = (over: Record<string, unknown> = {}): MintFaultRule =>
  mintFaultRuleSchema.parse({
    id: 'r1',
    mint: 'https://testnut.cashu.space',
    response: { mode: 'offline' },
    ...over,
  });

const set = (rules: MintFaultRule[], revision = 1) =>
  mintFaultRuleSetSchema.parse({ version: 1, revision, rules });

describe('mint-fault rules contract', () => {
  it('applies declarative defaults', () => {
    const parsed = rule();
    expect(parsed.path).toBe('/');
    expect(parsed.method).toBe('ANY');
    expect(parsed.afterMatches).toBe(0);
    expect(parsed.ws).toBe('down');
  });

  it('serializes and reparses a rule set losslessly', () => {
    const original = set([rule({ path: '/v1/swap', method: 'POST', afterMatches: 2 })]);
    expect(parseMintFaultRuleSet(serializeMintFaultRuleSet(original))).toEqual(original);
  });

  it('rejects duplicate rule ids', () => {
    expect(() => set([rule(), rule({ path: '/v1/info' })])).toThrow(/duplicate rule id/);
  });

  it('rejects non-https mint URLs', () => {
    expect(() => rule({ mint: 'http://mint.example' })).toThrow();
  });

  it('rejects malformed rule-set JSON', () => {
    expect(() => parseMintFaultRuleSet('{"broken":')).toThrow(/malformed JSON/);
  });
});

describe('MintFaultEngine matching', () => {
  it('returns null with no rules and for non-mint traffic', () => {
    const engine = new MintFaultEngine();
    expect(engine.decide('https://testnut.cashu.space/v1/info', 'GET')).toBeNull();
    engine.loadRuleSet(set([rule({ path: '/v1/swap' })]));
    expect(engine.decide('https://api.sovran.money/api/app/latest-version', 'GET')).toBeNull();
    expect(engine.decide('not a url', 'GET')).toBeNull();
  });

  it('matches a specific mint on segment boundaries and methods', () => {
    const engine = new MintFaultEngine();
    engine.loadRuleSet(set([rule({ path: '/v1/melt/quote/bolt11', method: 'POST' })]));
    expect(engine.decide('https://testnut.cashu.space/v1/melt/quote/bolt11', 'POST')?.apply).toBe(
      true
    );
    // Quote-poll GET with a trailing id shares the prefix but not the method.
    expect(engine.decide('https://testnut.cashu.space/v1/melt/quote/bolt11/q1', 'GET')).toBeNull();
    expect(engine.decide('https://testnut.cashu.space/v1/melt/quote/bolt11x', 'POST')).toBeNull();
    expect(engine.decide('https://other.mint.example/v1/melt/quote/bolt11', 'POST')).toBeNull();
  });

  it('matches path-prefixed mint bases', () => {
    const engine = new MintFaultEngine();
    engine.loadRuleSet(set([rule({ mint: 'https://host.example/cashu', path: '/v1/info' })]));
    expect(engine.decide('https://host.example/cashu/v1/info', 'GET')?.apply).toBe(true);
    expect(engine.decide('https://host.example/v1/info', 'GET')).toBeNull();
  });

  it("restricts wildcard rules to https '/v1/' cashu paths", () => {
    const engine = new MintFaultEngine();
    engine.loadRuleSet(set([rule({ mint: '*', path: '/v1/swap' })]));
    expect(engine.decide('https://any.mint.example/v1/swap', 'POST')?.apply).toBe(true);
    expect(engine.decide('https://prefixed.example/cashu/v1/swap', 'POST')?.apply).toBe(true);
    expect(engine.decide('http://any.mint.example/v1/swap', 'POST')).toBeNull();
    expect(engine.decide('https://api.example/api/swap', 'POST')).toBeNull();
  });

  it('honors afterMatches then maxMatches sequencing', () => {
    const engine = new MintFaultEngine();
    engine.loadRuleSet(set([rule({ afterMatches: 2, maxMatches: 1, path: '/v1/swap' })]));
    const url = 'https://testnut.cashu.space/v1/swap';
    expect(engine.decide(url, 'POST')?.apply).toBe(false);
    expect(engine.decide(url, 'POST')?.apply).toBe(false);
    expect(engine.decide(url, 'POST')?.apply).toBe(true);
    // maxMatches exhausted — matched but passthrough again.
    expect(engine.decide(url, 'POST')?.apply).toBe(false);
    const ledger = engine.snapshotLedger();
    expect(ledger.counts.r1).toEqual({ matched: 4, applied: 1 });
    expect(ledger.entries.map((entry) => entry.outcome)).toEqual([
      'passthrough',
      'passthrough',
      'applied',
      'passthrough',
    ]);
  });

  it('is first-match-wins across rules', () => {
    const engine = new MintFaultEngine();
    engine.loadRuleSet(
      set([rule({ id: 'narrow', path: '/v1/swap' }), rule({ id: 'broad', path: '/' })])
    );
    expect(engine.decide('https://testnut.cashu.space/v1/swap', 'POST')?.rule.id).toBe('narrow');
    expect(engine.decide('https://testnut.cashu.space/v1/info', 'GET')?.rule.id).toBe('broad');
  });

  it('resets counters on revision swap but keeps ledger entries', () => {
    const engine = new MintFaultEngine();
    engine.loadRuleSet(set([rule({ path: '/v1/swap' })], 1));
    engine.decide('https://testnut.cashu.space/v1/swap', 'POST');
    engine.loadRuleSet(set([rule({ path: '/v1/swap' })], 2));
    expect(engine.activeRevision).toBe(2);
    const ledger = engine.snapshotLedger();
    expect(ledger.counts.r1).toEqual({ matched: 0, applied: 0 });
    expect(ledger.entries).toHaveLength(1);
    expect(ledger.activeRevision).toBe(2);
  });

  it('seeds prior-launch ledger entries exactly once and never over live ones', () => {
    const engine = new MintFaultEngine();
    const entry = {
      seq: 7,
      at: 1,
      ruleId: 'old',
      mode: 'offline' as const,
      outcome: 'applied' as const,
      method: 'POST',
      url: 'https://testnut.cashu.space/v1/swap',
    };
    engine.seedLedger([entry]);
    expect(engine.snapshotLedger().entries).toEqual([entry]);
    // Second seed is a no-op; new entries continue the persisted seq.
    engine.seedLedger([{ ...entry, seq: 99, ruleId: 'other' }]);
    engine.loadRuleSet(set([rule({ path: '/v1/swap' })], 2));
    engine.decide('https://testnut.cashu.space/v1/swap', 'POST');
    const ledger = engine.snapshotLedger();
    expect(ledger.entries.map((e) => e.ruleId)).toEqual(['old', 'r1']);
    expect(ledger.entries[1]!.seq).toBe(8);
  });

  it('reports the ws mode of the first mint-matching rule', () => {
    const engine = new MintFaultEngine();
    expect(engine.wsModeFor('wss://testnut.cashu.space/v1/ws')).toBeNull();
    engine.loadRuleSet(set([rule({ ws: 'silent', path: '/v1/swap' })]));
    expect(engine.wsModeFor('wss://testnut.cashu.space/v1/ws')).toBe('silent');
    expect(engine.wsModeFor('wss://other.mint.example/v1/ws')).toBeNull();
  });
});

describe('FakeMintFaultChannel', () => {
  it('records sets and reports every seen rule as applied once', async () => {
    const channel = new FakeMintFaultChannel();
    await channel.set([rule({ id: 'a' })]);
    await channel.set([]);
    const ledger = await channel.ledger();
    expect(channel.sets).toHaveLength(2);
    expect(ledger?.activeRevision).toBe(2);
    expect(ledger?.entries.filter((entry) => entry.ruleId === 'a')).toHaveLength(1);
  });
});

describe('createSimulatorMintFaultChannel', () => {
  const container = () => {
    const dir = mkdtempSync(join(tmpdir(), 'mint-faults-'));
    mkdirSync(join(dir, 'Documents', 'e2e'), { recursive: true });
    return dir;
  };
  const exec = (dir: string) => async (cmd: string[]) => {
    expect(cmd.slice(0, 3)).toEqual(['xcrun', 'simctl', 'get_app_container']);
    return `${dir}\n`;
  };

  it('writes the rules file and returns once the app acks the revision', async () => {
    const dir = container();
    // The "app" has already flushed a ledger at the next revision.
    writeFileSync(
      join(dir, 'Documents', 'e2e', 'mint-faults.ledger.json'),
      JSON.stringify({ v: 1, activeRevision: 1, counts: {}, entries: [] })
    );
    const channel = createSimulatorMintFaultChannel({ udid: 'U', exec: exec(dir) });
    await channel.set([rule()]);
    const written = parseMintFaultRuleSet(
      readFileSync(join(dir, 'Documents', 'e2e', 'mint-faults.json'), 'utf8')
    );
    expect(written.revision).toBe(1);
    expect(written.rules).toHaveLength(1);
  });

  it('throws when the app never acks within the timeout', async () => {
    const dir = container();
    const channel = createSimulatorMintFaultChannel({ udid: 'U', exec: exec(dir) });
    await expect(channel.set([rule()], 300)).rejects.toThrow(/not acked/);
  });

  it('serves the app ledger and null when absent', async () => {
    const dir = container();
    const channel = createSimulatorMintFaultChannel({ udid: 'U', exec: exec(dir) });
    expect(await channel.ledger()).toBeNull();
    writeFileSync(
      join(dir, 'Documents', 'e2e', 'mint-faults.ledger.json'),
      JSON.stringify({
        v: 1,
        activeRevision: 3,
        counts: { r1: { matched: 2, applied: 1 } },
        entries: [],
      })
    );
    expect((await channel.ledger())?.counts.r1?.applied).toBe(1);
  });
});
