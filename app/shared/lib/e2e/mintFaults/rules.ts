/**
 * The declarative mint-fault rule contract shared by the app runtime (the
 * fetch interceptor in this directory) and the e2e harness (schema + the
 * container-file channel in e2e/drivers/mint-faults.ts). App-owned so the
 * dependency direction matches e2eProofReconciliationConfig: the harness
 * imports from app/shared, never the reverse.
 *
 * A rule declares a mint-scoped, endpoint-scoped fake outcome. A matched
 * request NEVER reaches the network — delay-then-real is impossible by
 * design, so the client can never race a real mint into divergent state.
 */
import { z } from 'zod';
import { normalizeMintUrl } from '@cashu/coco-core';

/** Armed/launch channel: the harness-owned Metro serializes a rule-set here.
 * Presence of the var (even with zero rules) arms the interceptor. */
export const E2E_MINT_FAULTS_ENV = 'EXPO_PUBLIC_E2E_MINT_FAULTS' as const;
/** Dynamic channel: rule-set file the harness writes into the app container,
 * relative to the container's Documents/ directory (beside e2e/state.json). */
export const MINT_FAULT_RULES_REL = 'e2e/mint-faults.json' as const;
/** Evidence + ack channel: the app's intercepted-request ledger, which echoes
 * the active rule-set revision so the harness can await pickup. */
export const MINT_FAULT_LEDGER_REL = 'e2e/mint-faults.ledger.json' as const;

const ruleId = z.string().regex(/^[a-z0-9][a-z0-9._-]*$/, 'must be a safe lowercase rule id');

const httpsMintUrl = z
  .string()
  .min(1)
  .superRefine((value, ctx) => {
    try {
      const normalized = normalizeMintUrl(value);
      const url = new URL(normalized);
      if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) {
        throw new Error('unsafe');
      }
    } catch {
      ctx.addIssue({ code: 'custom', message: 'mint must be a bare https mint URL' });
    }
  });

/** `'*'` = any https host, but then only cashu-protocol `/v1/` paths match —
 * keeping api.sovran.money, relays, blossom, and loopback IPC structurally
 * out of reach even for careless rules. */
const mintMatch = z.union([z.literal('*'), httpsMintUrl]);

export const mintFaultResponseSchema = z.discriminatedUnion('mode', [
  // NUT-protocol error: status + {code, detail} body → coco MintOperationError
  // (or HttpResponseError when status ≥ 500 despite the parseable body).
  z.strictObject({
    mode: z.literal('error'),
    status: z.number().int().min(400).max(599).default(400),
    code: z.number().int(),
    detail: z.string().min(1),
  }),
  // fetch rejects with RN's exact network-failure shape → coco NetworkError
  // → colada isMintOfflineError → offline state.
  z.strictObject({ mode: z.literal('offline') }),
  // Hang until the caller's AbortSignal fires; afterMs = fail on our own
  // clock instead (as an AbortError, matching an aborted request).
  z.strictObject({
    mode: z.literal('timeout'),
    afterMs: z.number().int().positive().max(120_000).optional(),
  }),
  // Arbitrary status + verbatim body: 429, bare 5xx, wrong-status-with-body.
  z.strictObject({
    mode: z.literal('httpStatus'),
    status: z.number().int().min(100).max(599),
    body: z.string().default(''),
  }),
  // 200 with unparsable JSON → coco HttpResponseError('bad response').
  z.strictObject({ mode: z.literal('malformed') }),
]);
export type MintFaultResponse = z.infer<typeof mintFaultResponseSchema>;

export const mintFaultRuleSchema = z.strictObject({
  id: ruleId,
  mint: mintMatch,
  /** Path prefix relative to the mint base, e.g. "/v1/melt/quote/bolt11".
   * Prefix semantics on path-segment boundaries, so quote-poll GETs with a
   * trailing quote id match their POST-create prefix. */
  path: z.string().startsWith('/').default('/'),
  method: z.enum(['GET', 'POST', 'ANY']).default('ANY'),
  /** Sequencing: the rule arms only after this many matching requests have
   * been let through (e.g. 2 = first two pass, third is faked). */
  afterMatches: z.number().int().min(0).default(0),
  /** The rule disarms after applying this many times (passthrough after). */
  maxMatches: z.number().int().positive().optional(),
  /** Latency before the fake outcome resolves. Never delay-then-real. */
  delayMs: z.number().int().positive().max(60_000).optional(),
  /** NUT-17 WebSocket behavior for mints this rule matches while it is live:
   * 'down' (default) = socket errors+closes → coco HybridTransport degrades
   * to fast polling (through this same faulted fetch); 'silent' = opens but
   * never acks or notifies; 'pass' = real WebSocket. */
  ws: z.enum(['down', 'silent', 'pass']).default('down'),
  response: mintFaultResponseSchema,
});
export type MintFaultRule = z.infer<typeof mintFaultRuleSchema>;

export const mintFaultRuleSetSchema = z
  .strictObject({
    version: z.literal(1),
    /** Monotonic per session; the app echoes it in the ledger so the harness
     * can await rule pickup deterministically instead of sleeping. */
    revision: z.number().int().min(0),
    rules: z.array(mintFaultRuleSchema).max(32),
  })
  .superRefine((set, ctx) => {
    const seen = new Set<string>();
    set.rules.forEach((rule, index) => {
      if (seen.has(rule.id)) {
        ctx.addIssue({
          code: 'custom',
          path: ['rules', index, 'id'],
          message: 'duplicate rule id',
        });
      }
      seen.add(rule.id);
    });
  });
export type MintFaultRuleSet = z.infer<typeof mintFaultRuleSetSchema>;

/** Per-rule counters mirrored into the ledger. `matched` counts every request
 * the rule's static predicate claimed; `applied` counts faked outcomes. */
export interface MintFaultLedgerCounts {
  matched: number;
  applied: number;
}

export interface MintFaultLedgerEntry {
  seq: number;
  at: number;
  ruleId: string;
  mode: MintFaultResponse['mode'];
  outcome: 'applied' | 'passthrough';
  method: string;
  url: string;
}

export interface MintFaultLedger {
  v: 1;
  /** Revision of the rule-set the entries were recorded under — the ack the
   * harness polls for after writing a new rules file. */
  activeRevision: number;
  counts: Record<string, MintFaultLedgerCounts>;
  entries: MintFaultLedgerEntry[];
}

export function serializeMintFaultRuleSet(set: MintFaultRuleSet): string {
  return JSON.stringify(mintFaultRuleSetSchema.parse(set));
}

export function parseMintFaultRuleSet(raw: string): MintFaultRuleSet {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new Error('mint-fault rule set is malformed JSON');
  }
  return mintFaultRuleSetSchema.parse(value);
}

export function parseMintFaultLedger(raw: string): MintFaultLedger {
  const value = JSON.parse(raw) as MintFaultLedger;
  if (!value || value.v !== 1 || typeof value.activeRevision !== 'number') {
    throw new Error('mint-fault ledger has an invalid shape');
  }
  return value;
}
