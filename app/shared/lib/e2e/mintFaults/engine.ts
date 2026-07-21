/**
 * Pure mint-fault rule engine: URL/method matching, first-match-wins claim,
 * afterMatches/maxMatches arithmetic, and the intercepted-request ledger.
 * No IO and no react-native imports so both the jest suite and the harness's
 * bun tests can exercise it directly.
 */
import { normalizeMintUrl } from '@cashu/coco-core';
import type {
  MintFaultLedger,
  MintFaultLedgerCounts,
  MintFaultLedgerEntry,
  MintFaultRule,
  MintFaultRuleSet,
} from './rules';

/** Ledger entries are capped to bound flush cost; counts stay complete. */
const MAX_LEDGER_ENTRIES = 500;

export interface MintFaultDecision {
  rule: MintFaultRule;
  /** true = fake the outcome; false = matched but passing through (sequencing). */
  apply: boolean;
}

interface CompiledRule {
  rule: MintFaultRule;
  /** normalized https base, or null for the '*' wildcard */
  mintBase: string | null;
  matched: number;
  applied: number;
}

/** Path prefix on segment boundaries: `/v1/melt/quote/bolt11` matches itself
 * and `/v1/melt/quote/bolt11/<quoteId>` but never `/v1/melt/quote/bolt11x`. */
function pathMatches(effectivePath: string, rulePath: string): boolean {
  if (rulePath === '/') return true;
  if (!effectivePath.startsWith(rulePath)) return false;
  const next = effectivePath.charAt(rulePath.length);
  return next === '' || next === '/' || next === '?';
}

export class MintFaultEngine {
  private compiled: CompiledRule[] = [];
  private revision = 0;
  private entries: MintFaultLedgerEntry[] = [];
  private seq = 0;
  private onChange?: () => void;
  private swapListeners = new Set<() => void>();

  /** Notified after every ledger mutation (debounced flushing lives in io). */
  setOnLedgerChange(listener: () => void): void {
    this.onChange = listener;
  }

  /** Notified after a rule-set swap: the WS factory force-closes real sockets
   * for mints whose ws mode is no longer 'pass', and the interceptor rejects
   * in-flight signal-less timeout fakes so a rule clear unblocks the app. */
  addOnRulesSwapped(listener: () => void): void {
    this.swapListeners.add(listener);
  }

  get activeRevision(): number {
    return this.revision;
  }

  /** Replace the active rule set wholesale. Counters reset — sequencing is
   * relative to the revision that declared it. */
  loadRuleSet(set: MintFaultRuleSet): void {
    this.compiled = set.rules.map((rule) => ({
      rule,
      mintBase: rule.mint === '*' ? null : normalizeMintUrl(rule.mint),
      matched: 0,
      applied: 0,
    }));
    this.revision = set.revision;
    this.onChange?.();
    for (const listener of [...this.swapListeners]) listener();
  }

  hasRules(): boolean {
    return this.compiled.length > 0;
  }

  /** Restore ledger entries persisted by a previous app launch — goHome in
   * e2e relaunches the app, and a post-relaunch `mintFaultIntercepted`
   * assert must still see the proof that a fault fired. No-op once any
   * entry exists (seeding races an early intercepted request otherwise). */
  seedLedger(entries: readonly MintFaultLedgerEntry[]): void {
    if (this.entries.length > 0 || entries.length === 0) return;
    this.entries = entries.slice(-MAX_LEDGER_ENTRIES);
    this.seq = Math.max(...this.entries.map((entry) => entry.seq));
    this.onChange?.();
  }

  /** The path relative to the rule's mint base, or derived from the first
   * `/v1/` segment for wildcard rules; null = this rule cannot match. */
  private effectivePath(compiledRule: CompiledRule, url: URL): string | null {
    const full = url.pathname + url.search;
    if (compiledRule.mintBase === null) {
      if (url.protocol !== 'https:') return null;
      const v1 = full.indexOf('/v1/');
      return v1 === -1 ? null : full.slice(v1);
    }
    const base = new URL(compiledRule.mintBase);
    if (url.protocol !== base.protocol || url.host !== base.host) return null;
    const basePath = base.pathname === '/' ? '' : base.pathname;
    if (basePath && !url.pathname.startsWith(basePath)) return null;
    const relative = full.slice(basePath.length);
    return relative.startsWith('/') ? relative : null;
  }

  /**
   * Claim a request. First rule whose static predicate (mint + path + method)
   * matches owns it; that rule's counters then decide fake vs passthrough.
   * Returns null for non-mint traffic, which stays unlogged.
   */
  decide(urlString: string, method: string): MintFaultDecision | null {
    if (this.compiled.length === 0) return null;
    let url: URL;
    try {
      url = new URL(urlString);
    } catch {
      return null;
    }
    const normalizedMethod = method.toUpperCase();
    for (const compiledRule of this.compiled) {
      const { rule } = compiledRule;
      if (rule.method !== 'ANY' && rule.method !== normalizedMethod) continue;
      const effective = this.effectivePath(compiledRule, url);
      if (effective === null || !pathMatches(effective, rule.path)) continue;
      compiledRule.matched++;
      const armed = compiledRule.matched > rule.afterMatches;
      const exhausted = rule.maxMatches !== undefined && compiledRule.applied >= rule.maxMatches;
      const apply = armed && !exhausted;
      if (apply) compiledRule.applied++;
      this.record({
        seq: ++this.seq,
        at: Date.now(),
        ruleId: rule.id,
        mode: rule.response.mode,
        outcome: apply ? 'applied' : 'passthrough',
        method: normalizedMethod,
        url: urlString,
      });
      return { rule, apply };
    }
    return null;
  }

  /** NUT-17 behavior for a socket to this URL: the first rule whose mint
   * predicate matches decides; null = no rule → real WebSocket. */
  wsModeFor(wsUrlString: string): MintFaultRule['ws'] | null {
    if (this.compiled.length === 0) return null;
    let url: URL;
    try {
      url = new URL(wsUrlString.replace(/^wss:/, 'https:').replace(/^ws:/, 'http:'));
    } catch {
      return null;
    }
    for (const compiledRule of this.compiled) {
      if (compiledRule.mintBase === null) {
        if (url.protocol === 'https:') return compiledRule.rule.ws;
        continue;
      }
      const base = new URL(compiledRule.mintBase);
      if (url.protocol === base.protocol && url.host === base.host) return compiledRule.rule.ws;
    }
    return null;
  }

  private record(entry: MintFaultLedgerEntry): void {
    this.entries.push(entry);
    if (this.entries.length > MAX_LEDGER_ENTRIES) {
      this.entries = this.entries.slice(-MAX_LEDGER_ENTRIES);
    }
    this.onChange?.();
  }

  snapshotLedger(): MintFaultLedger {
    const counts: Record<string, MintFaultLedgerCounts> = {};
    for (const compiledRule of this.compiled) {
      counts[compiledRule.rule.id] = {
        matched: compiledRule.matched,
        applied: compiledRule.applied,
      };
    }
    return { v: 1, activeRevision: this.revision, counts, entries: [...this.entries] };
  }
}

/** Module-singleton engine shared by the interceptor, io, and WS factory. */
export const mintFaultEngine = new MintFaultEngine();
