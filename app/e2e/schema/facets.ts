/** Structured scenario classification carried in `tags`.
 *
 * Every tag is a facet of the form `<facet>:<value>` with a known name and
 * value — bare tags are rejected at authoring time (they accumulated as stale
 * free-form provenance like `legacy-derived`). Every scenario declares exactly
 * one `flow:`; the other single-valued facets are optional but may not repeat.
 * `check:` may repeat — a scenario can prove several orthogonal behaviors
 * (e.g. a toast AND the transaction source). `parseFacets` stays tolerant of
 * bare tags so the viewer can read historical run artifacts.
 *
 * - flow       — the product surface under test (grouping axis)
 * - instrument — what carries the value (bolt11, cashu token, NUT-18 request, npc address)
 * - amount     — how the amount is chosen (fixed keypad entry vs any-amount)
 * - io         — how the payload crosses the app boundary
 * - outcome    — the terminal payment state the scenario drives to
 * - check      — the non-payment behavior the scenario exists to prove
 */
export const FACETS = {
  flow: ['onboarding', 'recovery', 'receive', 'send', 'history', 'isolation', 'mint', 'wallet'],
  instrument: ['bolt11', 'cashu-token', 'payment-request', 'npc'],
  amount: ['fixed', 'any'],
  io: ['paste', 'copy', 'scan', 'display'],
  outcome: ['settled', 'dismissed', 'rolled-back', 'reclaimed'],
  check: [
    'mint-change',
    'mint-add',
    'toast',
    'tx-source',
    'share-actions',
    'context-isolation',
    'rebalance',
    'zero-balance',
    'mint-preselect',
    'fiat-unit',
    'search',
    'offline',
    'dm',
    'navigation',
    'p2pk-keys',
    'filters',
  ],
} as const;

export type FacetName = keyof typeof FACETS;
export type FacetValue<F extends FacetName> = (typeof FACETS)[F][number];

const SINGLE_VALUED: readonly FacetName[] = ['flow', 'instrument', 'amount', 'io', 'outcome'];

export interface ScenarioFacets {
  /** Required by the schema; optional here so the viewer can parse raw JSON. */
  flow?: FacetValue<'flow'>;
  instrument?: FacetValue<'instrument'>;
  amount?: FacetValue<'amount'>;
  io?: FacetValue<'io'>;
  outcome?: FacetValue<'outcome'>;
  checks: FacetValue<'check'>[];
  /** Bare tags from historical run artifacts; rejected in authored scenarios. */
  extras: string[];
}

function isFacetName(name: string): name is FacetName {
  return Object.hasOwn(FACETS, name);
}

/** Authoring-contract violations for a scenario's tags; empty means valid. */
export function facetIssues(tags: readonly string[]): string[] {
  const issues: string[] = [];
  const counts = new Map<FacetName, number>();
  for (const tag of tags) {
    const colon = tag.indexOf(':');
    if (colon < 0) {
      issues.push(`bare tag "${tag}" is not allowed — every tag must be a <facet>:<value> pair`);
      continue;
    }
    const name = tag.slice(0, colon);
    const value = tag.slice(colon + 1);
    if (!isFacetName(name)) {
      issues.push(
        `unknown facet "${name}" in tag "${tag}" (known: ${Object.keys(FACETS).join(', ')})`
      );
      continue;
    }
    if (!(FACETS[name] as readonly string[]).includes(value)) {
      issues.push(`unknown ${name} value "${value}" (known: ${FACETS[name].join(', ')})`);
      continue;
    }
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  for (const name of SINGLE_VALUED) {
    if ((counts.get(name) ?? 0) > 1) issues.push(`facet "${name}" may appear at most once`);
  }
  if ((counts.get('flow') ?? 0) === 0) issues.push('missing required "flow:<value>" facet tag');
  return issues;
}

/** Structured view of a valid tag list. Unknown facet tags are ignored, so this
 * stays safe on unvalidated input (e.g. the viewer reading raw JSON). */
export function parseFacets(tags: readonly string[]): ScenarioFacets {
  const facets: ScenarioFacets = { checks: [], extras: [] };
  for (const tag of tags) {
    const colon = tag.indexOf(':');
    if (colon < 0) {
      facets.extras.push(tag);
      continue;
    }
    const name = tag.slice(0, colon);
    const value = tag.slice(colon + 1);
    if (!isFacetName(name) || !(FACETS[name] as readonly string[]).includes(value)) continue;
    if (name === 'check') {
      facets.checks.push(value as FacetValue<'check'>);
    } else {
      facets[name] = value as never;
    }
  }
  return facets;
}
