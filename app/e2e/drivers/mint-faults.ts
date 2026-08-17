/**
 * Host-side mint-fault channel: writes the rule-set file into the app
 * container (`Documents/e2e/mint-faults.json`, the reverse of app-data.ts's
 * reads) and awaits the app's revision ack in the intercepted-request ledger
 * — deterministic pickup, no sleeps. `ledger()` also feeds the
 * `mintFaultIntercepted` assert and the per-frame `.faults.json` sidecar.
 */
import { mkdirSync, renameSync, writeFileSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import {
  MINT_FAULT_LEDGER_REL,
  MINT_FAULT_RULES_REL,
  parseMintFaultLedger,
  serializeMintFaultRuleSet,
  type MintFaultLedger,
  type MintFaultRule,
} from '../../shared/lib/e2e/mintFaults/rules';
import { BUNDLE_ID, run, sleep, type RunOptions } from './simctl';

const ACK_POLL_MS = 250;
const DEFAULT_ACK_TIMEOUT_MS = 10_000;

export interface MintFaultChannel {
  /** Replace the active rule set and wait until the app acks the revision. */
  set(rules: readonly MintFaultRule[], timeoutMs?: number): Promise<void>;
  /** Latest app-side ledger, or null when not yet written/readable. */
  ledger(): Promise<MintFaultLedger | null>;
}

interface SimulatorMintFaultChannelOptions {
  udid: string;
  bundleId?: string;
  exec?: (cmd: string[], opts?: RunOptions) => Promise<string>;
  signal?: AbortSignal;
}

export function createSimulatorMintFaultChannel(
  options: SimulatorMintFaultChannelOptions
): MintFaultChannel {
  const bundleId = options.bundleId ?? BUNDLE_ID;
  const exec = options.exec ?? run;
  let revision = 0;

  const resolveContainer = async (): Promise<string> => {
    // Resolved per call: a `reset: reinstall` mid-run replaces the container.
    const out = await exec(
      ['xcrun', 'simctl', 'get_app_container', options.udid, bundleId, 'data'],
      options.signal ? { signal: options.signal } : {}
    );
    const container = out.split('\n')[0]?.trim() ?? '';
    if (!container.startsWith('/')) {
      throw new Error('mint-fault channel could not resolve the app data container');
    }
    return container;
  };

  const readLedger = async (): Promise<MintFaultLedger | null> => {
    try {
      const container = await resolveContainer();
      const raw = readFileSync(join(container, 'Documents', MINT_FAULT_LEDGER_REL), 'utf8');
      return parseMintFaultLedger(raw);
    } catch {
      return null;
    }
  };

  return {
    async set(rules, timeoutMs = DEFAULT_ACK_TIMEOUT_MS): Promise<void> {
      const container = await resolveContainer();
      revision += 1;
      const payload = serializeMintFaultRuleSet({
        version: 1,
        revision,
        rules: [...rules],
      });
      const target = join(container, 'Documents', MINT_FAULT_RULES_REL);
      mkdirSync(dirname(target), { recursive: true });
      // Atomic same-directory rename so the app's poller never reads a torn file.
      const tmp = `${target}.host-tmp`;
      writeFileSync(tmp, payload, { mode: 0o600 });
      renameSync(tmp, target);
      const deadline = Date.now() + timeoutMs;
      for (;;) {
        const ledger = await readLedger();
        if (ledger && ledger.activeRevision >= revision) return;
        if (Date.now() >= deadline) {
          throw new Error(
            `mint-fault rules not acked by the app within ${timeoutMs}ms (revision ${revision}, ` +
              `saw ${ledger?.activeRevision ?? 'no ledger'}) — is the scenario armed via mock.mint-faults?`
          );
        }
        await sleep(ACK_POLL_MS);
      }
    },
    ledger: readLedger,
  };
}

/** In-memory fake for offline orchestrator tests and dry-runs: records set()
 * calls and — unless a scripted ledger is installed — reports every rule ever
 * set as applied once, so permissive dry-runs prove orchestration without a
 * device (never a real assertion, same posture as FakeDriver.permissive). */
export class FakeMintFaultChannel implements MintFaultChannel {
  readonly sets: MintFaultRule[][] = [];
  private revision = 0;
  private scripted: MintFaultLedger | null = null;
  private seenRuleIds: string[] = [];

  setLedger(ledger: MintFaultLedger): void {
    this.scripted = ledger;
  }

  async set(rules: readonly MintFaultRule[]): Promise<void> {
    this.sets.push([...rules]);
    this.revision += 1;
    for (const rule of rules) {
      if (!this.seenRuleIds.includes(rule.id)) this.seenRuleIds.push(rule.id);
    }
  }

  async ledger(): Promise<MintFaultLedger | null> {
    if (this.scripted) return this.scripted;
    return {
      v: 1,
      activeRevision: this.revision,
      counts: {},
      entries: this.seenRuleIds.map((ruleId, index) => ({
        seq: index + 1,
        at: 0,
        ruleId,
        mode: 'offline',
        outcome: 'applied',
        method: 'ANY',
        url: 'fake://mint',
      })),
    };
  }
}
