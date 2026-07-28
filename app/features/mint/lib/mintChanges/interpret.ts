/**
 * NUT-06 patch ops → typed facts about what a mint actually did.
 *
 * The mechanical decoder (`decode.ts`) answers "which JSON pointer moved". This
 * answers "what does that mean for someone holding ecash at this mint", which is
 * the only thing the Mints tab should say out loud. Everything here is grounded
 * in the spec (`Sovran/nuts`):
 *
 *  - NUT-04 (minting) is how you get ecash INTO the wallet → `receive`.
 *  - NUT-05 (melting) is how you get value OUT → `send`.
 *  - The `method` inside those (bolt11 / bolt12 / onchain, per NUT-23/25/30) is
 *    the rail, and it is what a user recognises: Lightning, Onchain, BOLT 12.
 *  - Every other `nuts` entry is a capability flag; a handful matter to a user,
 *    the rest are plumbing.
 *
 * Plumbing is dropped on purpose. `method_name` is the loudest example: NUT-04/05
 * gained the field in mid-2026 and Nutshell 0.20.3 then added it to every mint on
 * the network at once, which is not news. Anything this file does NOT recognise
 * still surfaces as an `other` fact built from the decoder's label, so an
 * unmapped change is never silently swallowed.
 */
import { decodePointer, pairPatchOps, type PatchOp } from './decode';
import { NUT_TITLES } from './nuts';

export type Direction = 'receive' | 'send';
export type FactAction = 'added' | 'removed';

export type MintChangeFact =
  /** NUT-21/22 — the mint gated (or ungated) access behind sign-in. */
  | { kind: 'auth'; action: FactAction | 'changed' }
  /** The mint's own key changed: every proof it signs is now signed by a new key. */
  | { kind: 'key' }
  /** NUT-04/05 `disabled` — the mint stopped (or resumed) one direction. */
  | { kind: 'paused'; direction: Direction; paused: boolean }
  /** A payment rail (method) gained or lost for one direction. */
  | { kind: 'rail'; action: FactAction; direction: Direction; method: string; unit?: string }
  /** A per-direction amount bound moved. */
  | {
      kind: 'limit';
      direction: Direction;
      bound: 'min' | 'max';
      from?: number;
      to?: number;
      unit?: string;
    }
  /** NUT-06 `motd` — the one field the spec says wallets MUST show users. */
  | { kind: 'notice'; text?: string }
  | { kind: 'feature'; action: FactAction; feature: string }
  | {
      kind: 'identity';
      field: 'name' | 'icon' | 'description' | 'contact' | 'urls' | 'tos';
      action: FactAction | 'changed';
      detail?: string;
      /** The value that was replaced, when the precondition carried one. */
      previous?: string;
    }
  | { kind: 'software'; impl?: string; version?: string; switched: boolean }
  /** Recognised as a change, not as a meaning. Carries its own sentence. */
  | { kind: 'other'; text: string };

/** The mint's current `nuts` map, used to resolve units a patch omits. */
export type NutsMap = Record<string, unknown> | undefined;

/* ── vocabulary ──────────────────────────────────────────────────────── */

/**
 * Rail names as the rest of the app writes them (`ReceiveScreen` tabs,
 * `MintAddScreen`), so the Mints tab and the payment screens agree.
 */
const RAIL_NAMES: Record<string, string> = {
  bolt11: 'Lightning',
  bolt12: 'BOLT 12',
  onchain: 'Onchain',
};

export function railName(method: string): string {
  return RAIL_NAMES[method.toLowerCase()] ?? method;
}

/**
 * Capability NUTs worth naming to a user. Everything absent here is either
 * plumbing (NUT-07 state checks, NUT-19 endpoint lists) or wallet-side only.
 */
const FEATURE_NAMES: Record<string, string> = {
  '8': 'Lightning fee refunds',
  '9': 'backup restore',
  '10': 'locked ecash',
  '11': 'locked ecash',
  '12': 'offline verification',
  '14': 'timelocked payments',
  '15': 'multi-path payments',
  '17': 'live payment updates',
  '19': 'safer retries',
  '20': 'signed mint quotes',
  '28': 'pay to blinded key',
  '29': 'batched deposits',
};

/** NUTs whose entire subtree is internal detail. */
const NOISE_NUTS = new Set(['7']);

function featureName(nut: string): string {
  const known = FEATURE_NAMES[nut];
  if (known) return known;
  const title = NUT_TITLES[String(Number(nut))];
  return title ? title.toLowerCase() : `NUT-${nut}`;
}

/* ── small readers (every value here is untrusted mint output) ────────── */

const asRecord = (value: unknown): Record<string, unknown> => value as Record<string, unknown>;
const isRecord = (value: unknown): boolean => !!value && typeof value === 'object';
const str = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() ? value.trim() : undefined;
const int = (value: unknown): number | undefined => (typeof value === 'number' ? value : undefined);

function methodOf(value: unknown): { method?: string; unit?: string } {
  if (!isRecord(value)) return {};
  const o = asRecord(value);
  return { method: str(o.method)?.toLowerCase(), unit: str(o.unit)?.toLowerCase() };
}

function methodsOf(value: unknown): unknown[] {
  if (!isRecord(value)) return [];
  const methods = asRecord(value).methods;
  return Array.isArray(methods) ? methods : [];
}

/** `nuts['4'].methods[index]` from the mint's CURRENT doc — the unit a scalar
 *  patch op (`max_amount: 25000 → 100000`) can't carry on its own. */
function currentMethod(
  nuts: NutsMap,
  nut: string,
  index: number
): { method?: string; unit?: string } {
  const entry = nuts?.[nut];
  const methods = methodsOf(entry);
  return methodOf(methods[index]);
}

const directionOf = (nut: string): Direction | null =>
  nut === '4' ? 'receive' : nut === '5' ? 'send' : null;

/* ── interpretation ──────────────────────────────────────────────────── */

/**
 * `nuts` is the mint's CURRENT capability map (from `mintMetadataStore`), used
 * only to resolve units the patch itself omits. Absent → sentences leave the
 * unit off rather than guessing one.
 */
export function interpretPatch(patch: PatchOp[], nuts?: NutsMap): MintChangeFact[] {
  const facts: MintChangeFact[] = [];

  for (const op of pairPatchOps(patch)) {
    const tokens = op.path
      .split('/')
      .slice(1)
      .map((t) => t.replace(/~1/g, '/').replace(/~0/g, '~'));
    const added = op.op === 'add';
    const removed = op.op === 'remove';
    // A removal's value lives in the `test` precondition; an add/replace's in
    // the op itself.
    const subject = removed ? op.before : op.value;

    if (tokens[0] === 'nuts') {
      pushNutFacts(facts, tokens.slice(1), { op, added, removed, subject, nuts });
      continue;
    }
    pushTopLevelFacts(facts, tokens, { op, added, removed, subject });
  }

  return facts;
}

type OpContext = {
  op: { op: string; path: string; value?: unknown; before?: unknown; hadBefore: boolean };
  added: boolean;
  removed: boolean;
  subject: unknown;
  nuts?: NutsMap;
};

function pushNutFacts(facts: MintChangeFact[], rest: string[], ctx: OpContext): void {
  const nut = rest[0] ?? '';
  const tail = rest.slice(1);
  if (!nut || NOISE_NUTS.has(nut)) return;

  // NUT-21/22 — clear and blind authentication. Anything under them means the
  // gate moved, which outranks everything else this file can say.
  if (nut === '21' || nut === '22') {
    if (tail.length === 0) facts.push({ kind: 'auth', action: ctx.added ? 'added' : 'removed' });
    else facts.push({ kind: 'auth', action: 'changed' });
    return;
  }

  const direction = directionOf(nut);
  if (direction) {
    pushRailFacts(facts, direction, nut, tail, ctx);
    return;
  }

  // Capability NUTs: only the entry itself and its `supported` flag are news.
  // Deeper churn (NUT-17 command lists, NUT-19 endpoints, NUT-29 methods) is
  // plumbing that rides along with a rail change we already reported.
  if (tail.length === 0) {
    facts.push({
      kind: 'feature',
      action: ctx.added ? 'added' : 'removed',
      feature: featureName(nut),
    });
    return;
  }
  if (tail.length === 1 && tail[0] === 'supported') {
    const on = ctx.op.value === true || (Array.isArray(ctx.op.value) && ctx.op.value.length > 0);
    facts.push({
      kind: 'feature',
      action: ctx.removed || !on ? 'removed' : 'added',
      feature: featureName(nut),
    });
  }
}

function pushRailFacts(
  facts: MintChangeFact[],
  direction: Direction,
  nut: string,
  tail: string[],
  ctx: OpContext
): void {
  // Whole NUT-04/05 entry, or its whole `methods` array: every method inside is
  // a rail gained or lost.
  if (tail.length === 0 || (tail.length === 1 && tail[0] === 'methods')) {
    const methods = tail.length === 0 ? methodsOf(ctx.subject) : ((ctx.subject as unknown[]) ?? []);
    for (const entry of Array.isArray(methods) ? methods : []) {
      const { method, unit } = methodOf(entry);
      if (method) {
        facts.push({
          kind: 'rail',
          action: ctx.removed ? 'removed' : 'added',
          direction,
          method,
          ...(unit ? { unit } : {}),
        });
      }
    }
    return;
  }

  if (tail[0] === 'disabled') {
    facts.push({ kind: 'paused', direction, paused: ctx.op.value === true });
    return;
  }

  if (tail[0] !== 'methods') {
    facts.push({ kind: 'other', text: genericText(ctx.op.path) });
    return;
  }

  const indexToken = tail[1] ?? '';
  const field = tail[2];

  // A whole method appended or removed.
  if (field === undefined) {
    const { method, unit } = methodOf(ctx.subject);
    if (!method) return;
    facts.push({
      kind: 'rail',
      action: ctx.removed ? 'removed' : 'added',
      direction,
      method,
      ...(unit ? { unit } : {}),
    });
    return;
  }

  const index = /^\d+$/.test(indexToken) ? Number(indexToken) : 0;
  const resolved = currentMethod(ctx.nuts, nut, index);

  if (field === 'min_amount' || field === 'max_amount') {
    const from = int(ctx.op.before);
    const to = ctx.removed ? undefined : int(ctx.op.value);
    facts.push({
      kind: 'limit',
      direction,
      bound: field === 'min_amount' ? 'min' : 'max',
      ...(from !== undefined ? { from } : {}),
      ...(to !== undefined ? { to } : {}),
      ...(resolved.unit ? { unit: resolved.unit } : {}),
    });
    return;
  }

  // `method_name`, `options`, and the invoice-description flag are spec
  // bookkeeping, not a change in what the mint can do.
  if (field === 'method_name' || field === 'options' || field === 'description') return;

  if (field === 'amountless') {
    facts.push({
      kind: 'feature',
      action: ctx.op.value === false || ctx.removed ? 'removed' : 'added',
      feature: 'amountless invoices',
    });
    return;
  }

  if (tail.includes('confirmations')) {
    const to = int(ctx.op.value);
    facts.push({
      kind: 'other',
      text:
        to !== undefined ? `now waits for ${to} confirmations` : 'changed its confirmation policy',
    });
    return;
  }

  facts.push({ kind: 'other', text: genericText(ctx.op.path) });
}

function pushTopLevelFacts(facts: MintChangeFact[], tokens: string[], ctx: OpContext): void {
  const field = tokens[0] ?? '';

  switch (field) {
    case 'pubkey':
      facts.push({ kind: 'key' });
      return;
    case 'motd': {
      const text = str(ctx.op.value);
      facts.push({ kind: 'notice', ...(text ? { text } : {}) });
      return;
    }
    case 'version': {
      const before = str(ctx.op.before)?.split('/')[0];
      const after = str(ctx.op.value);
      const [impl, version] = (after ?? '').split('/');
      facts.push({
        kind: 'software',
        ...(impl ? { impl } : {}),
        ...(version ? { version } : {}),
        switched: !!before && !!impl && before !== impl,
      });
      return;
    }
    case 'name': {
      const name = str(ctx.op.value);
      const previous = str(ctx.op.before);
      facts.push({
        kind: 'identity',
        field: 'name',
        action: ctx.added ? 'added' : ctx.removed ? 'removed' : 'changed',
        ...(name ? { detail: name } : {}),
        ...(previous ? { previous } : {}),
      });
      return;
    }
    case 'icon_url':
      facts.push({ kind: 'identity', field: 'icon', action: ctx.removed ? 'removed' : 'changed' });
      return;
    case 'description':
    case 'description_long':
      facts.push({
        kind: 'identity',
        field: 'description',
        action: ctx.removed ? 'removed' : 'changed',
      });
      return;
    case 'tos_url':
      facts.push({ kind: 'identity', field: 'tos', action: ctx.removed ? 'removed' : 'changed' });
      return;
    case 'contact': {
      // `/contact` (whole list) or `/contact/N/...` (one entry). Name the method
      // when the op carried it, so "added an email contact" beats "a contact".
      const entry = Array.isArray(ctx.subject) ? ctx.subject[0] : ctx.subject;
      const method = str(asRecord(isRecord(entry) ? entry : {}).method);
      facts.push({
        kind: 'identity',
        field: 'contact',
        action: ctx.added ? 'added' : ctx.removed ? 'removed' : 'changed',
        ...(method && ctx.added ? { detail: method.toLowerCase() } : {}),
      });
      return;
    }
    case 'urls': {
      const value = Array.isArray(ctx.subject) ? ctx.subject[0] : ctx.subject;
      const url = str(value);
      facts.push({
        kind: 'identity',
        field: 'urls',
        action: ctx.added ? 'added' : ctx.removed ? 'removed' : 'changed',
        ...(url?.includes('.onion') ? { detail: 'tor' } : {}),
      });
      return;
    }
    default:
      facts.push({ kind: 'other', text: genericText(ctx.op.path) });
  }
}

/** Fallback sentence for a pointer this file doesn't model, e.g. "changed its keysets". */
function genericText(path: string): string {
  const { label } = decodePointer(path);
  const subject = (label[0] ?? 'settings').toLowerCase();
  return `changed its ${subject}`;
}
