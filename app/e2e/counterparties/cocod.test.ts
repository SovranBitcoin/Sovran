import { describe, expect, it } from 'bun:test';
import { parseVersion, resolveCocodBin, detectCapabilities, preflight, type Exec } from './cocod';

const TOP_HELP = `Coco CLI - A Cashu wallet daemon
Commands:
  status     Check daemon and wallet status
  balance    Get wallet balance
  receive    Receive operations
  send       Send operations
  mints      Mints operations
  npc        NPC operations
  x-cashu    x-cashu operations
  history    Wallet history operations`;
const SEND_HELP = `Send operations
Commands:
  cashu <amount>     Create Cashu token to send
  bolt11 <invoice>   Pay Lightning invoice`;
const RECEIVE_HELP = `Receive operations
Commands:
  cashu <token>      Receive Cashu token
  bolt11 <amount>    Create Lightning invoice to receive tokens`;
const MINTS_HELP = `Mints operations
Commands:
  add <url>    Add a mint URL
  list         List configured mints
  info <url>   Get mint info`;
const NPC_HELP = `NPC operations
Commands:
  address              Get NPC user address
  username <name>      Buy/set NPC username`;

const fakeExec =
  (version = '0.0.16'): Exec =>
  (args) => {
    const sub = args[1];
    if (args.includes('--version')) return { code: 0, stdout: version, stderr: '' };
    const map: Record<string, string> = {
      send: SEND_HELP,
      receive: RECEIVE_HELP,
      mints: MINTS_HELP,
      npc: NPC_HELP,
    };
    return { code: 0, stdout: sub && map[sub] ? map[sub] : TOP_HELP, stderr: '' };
  };
const goodEnv = {
  SOVRAN_TEST_COCOD_HOME: '/tmp/e2e-cocod-home',
  HOME: '/Users/x',
  COCOD_BIN: '/abs/cocod',
};

describe('parseVersion', () => {
  it('extracts a semver', () => expect(parseVersion('0.0.16\n')).toBe('0.0.16'));
  it('throws on garbage', () => expect(() => parseVersion('no version here')).toThrow());
});

describe('resolveCocodBin', () => {
  it('prefers COCOD_BIN and records source=env', () => {
    expect(resolveCocodBin({ COCOD_BIN: '/abs/cocod' }, () => null)).toEqual({
      bin: '/abs/cocod',
      source: 'env',
    });
  });
  it('falls back to which() and records source=path (never silent)', () => {
    expect(resolveCocodBin({}, () => '/usr/local/bin/cocod')).toEqual({
      bin: '/usr/local/bin/cocod',
      source: 'path',
    });
  });
  it('throws when cocod is nowhere', () => {
    expect(() => resolveCocodBin({}, () => null)).toThrow(/set COCOD_BIN/);
  });
});

describe('detectCapabilities', () => {
  it('maps the SAT-only surface and excludes usd', () => {
    const caps = detectCapabilities(TOP_HELP, {
      send: SEND_HELP,
      receive: RECEIVE_HELP,
      mints: MINTS_HELP,
      npc: NPC_HELP,
    });
    for (const t of [
      'unit.sat',
      'cocod.send.cashu',
      'cocod.receive.cashu',
      'cocod.send.bolt11',
      'cocod.receive.bolt11',
      'cocod.mints.add',
      'cocod.npc.address',
      'cocod.x-cashu',
    ]) {
      expect(caps.has(t)).toBe(true);
    }
    expect(caps.has('cocod.history')).toBe(false);
    expect(caps.has('unit.usd')).toBe(false);
  });
});

describe('preflight', () => {
  const which = () => '/abs/cocod';
  it('accepts the source 0.0.17 CLI with its detected payment capabilities', () => {
    const p = preflight({ exec: fakeExec('0.0.17'), env: goodEnv, which });
    expect(p.version).toBe('0.0.17');
    expect(p.capabilities.has('cocod.send.cashu')).toBe(true);
    expect(p.capabilities.has('cocod.history')).toBe(false);
  });
  it('resolves bin/version/home/capabilities on the happy path', () => {
    const p = preflight({ exec: fakeExec(), env: goodEnv, which });
    expect(p).toMatchObject({
      bin: '/abs/cocod',
      source: 'env',
      version: '0.0.16',
      home: '/tmp/e2e-cocod-home',
    });
    expect(p.capabilities.has('cocod.send.cashu')).toBe(true);
  });
  it('rejects an unexpected version', () => {
    expect(() => preflight({ exec: fakeExec('0.0.14'), env: goodEnv, which })).toThrow(
      /unexpected cocod version/
    );
  });
  it('requires an isolated test HOME', () => {
    expect(() =>
      preflight({ exec: fakeExec(), env: { COCOD_BIN: '/abs/cocod', HOME: '/Users/x' }, which })
    ).toThrow(/isolated cocod home/);
  });
  it('refuses ~/.cocod unless explicitly acknowledged', () => {
    expect(() =>
      preflight({
        exec: fakeExec(),
        env: {
          COCOD_BIN: '/abs/cocod',
          HOME: '/Users/x',
          SOVRAN_TEST_COCOD_HOME: '/Users/x/.cocod',
        },
        which,
      })
    ).toThrow(/SOVRAN_ALLOW_DEFAULT_COCOD/);
  });
  it('allows ~/.cocod with the explicit acknowledgement flag', () => {
    const p = preflight({
      exec: fakeExec(),
      env: { COCOD_BIN: '/abs/cocod', HOME: '/Users/x', SOVRAN_ALLOW_DEFAULT_COCOD: '1' },
      which,
    });
    expect(p.home).toBe('/Users/x/.cocod');
  });
});
