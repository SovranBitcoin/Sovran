/**
 * Typed secrets + redaction. Every value that could carry payment/identity
 * material is wrapped in a `Secret`, whose `toJSON`/`toString` emit only a safe
 * descriptor — so an accidental `console.log`, `JSON.stringify`, thrown error, or
 * reporter render can never leak the raw value. The raw value is reachable ONLY
 * via `.reveal()`, called at the single command/driver boundary that needs it.
 * `redactString`/`redactDeep` are defense-in-depth for arbitrary text (e.g. a
 * cocod stderr cause that embedded a token) that never became a `Secret`.
 */
import { createHash } from 'node:crypto';

export type SecretKind =
  | 'mnemonic'
  | 'nsec'
  | 'privkey'
  | 'cashu-token'
  | 'cashu-proof'
  | 'bolt11'
  | 'payment-request'
  | 'lightning-address'
  | 'onchain-address'
  | 'clipboard'
  | 'cocod-arg';

/** The only shape a secret may take once it crosses a reporter/artifact/log
 *  boundary. Fields here are classified safe to surface. */
interface SafeSecret {
  secret: true;
  kind: SecretKind;
  len: number;
  fingerprint: string; // non-reversible, first 12 hex of sha256
  unit?: string;
  amountSat?: number;
  mintHost?: string;
  quoteId?: string;
}

const fp = (raw: string) => createHash('sha256').update(raw).digest('hex').slice(0, 12);

type SecretExtra = Partial<Pick<SafeSecret, 'unit' | 'amountSat' | 'mintHost' | 'quoteId'>>;

export class Secret {
  readonly kind: SecretKind;
  readonly #raw: string;
  readonly #extra: SecretExtra;

  constructor(kind: SecretKind, raw: string, extra: SecretExtra = {}) {
    this.kind = kind;
    this.#raw = raw;
    this.#extra = extra;
  }

  /** Safe metadata only — used by every reporter/ledger/artifact path. */
  descriptor(): SafeSecret {
    return {
      secret: true,
      kind: this.kind,
      len: this.#raw.length,
      fingerprint: fp(this.#raw),
      ...this.#extra,
    };
  }

  /** Raw value — call ONLY at the command/driver boundary, never a logging one. */
  reveal(): string {
    return this.#raw;
  }

  toJSON(): SafeSecret {
    return this.descriptor();
  }
  toString(): string {
    return `‹${this.kind}:redacted len=${this.#raw.length} ${fp(this.#raw)}›`;
  }
}

export const secret = (kind: SecretKind, raw: string, extra?: SecretExtra) =>
  new Secret(kind, raw, extra);
export const isSecret = (v: unknown): v is Secret => v instanceof Secret;

// Defense-in-depth scrubbing of raw text. High-signal patterns first; the
// mnemonic pattern is conservative (12+ lowercase words) to avoid prose FPs.
const SCRUB: [SecretKind, RegExp][] = [
  ['nsec', /nsec1[a-z0-9]{20,}/gi],
  ['privkey', /\bxprv[a-km-zA-HJ-NP-Z1-9]{50,}\b/g],
  ['payment-request', /\bcreq[AB][A-Za-z0-9_-]{20,}/g],
  ['cashu-token', /\bcashu[AB][A-Za-z0-9_-]{20,}/g],
  ['bolt11', /\bln(bc|tb|bcrt)[0-9][a-z0-9]{30,}/gi],
  ['lightning-address', /\b[a-z0-9._-]+@[a-z0-9.-]+\.[a-z]{2,}\b/gi],
  ['onchain-address', /\b(?:bc1|tb1|bcrt1)[ac-hj-np-z02-9]{20,}\b/gi],
  ['nsec', /npub1[a-z0-9]{20,}/gi], // npub is public, but scrub in raw logs to be safe
  ['mnemonic', /\b([a-z]{3,8}\s){11,23}[a-z]{3,8}\b/g],
  ['privkey', /\b[0-9a-f]{64}\b/gi],
];

export function redactString(text: string): string {
  let out = text;
  for (const [kind, re] of SCRUB) out = out.replace(re, `‹${kind}:redacted›`);
  return out;
}

/** Recursively redact: unwrap Secrets to their descriptor, scrub raw strings. */
export function redactDeep<T>(node: T): unknown {
  if (isSecret(node)) return node.descriptor();
  if (typeof node === 'string') return redactString(node);
  if (Array.isArray(node)) return node.map(redactDeep);
  if (node && typeof node === 'object') {
    return Object.fromEntries(Object.entries(node).map(([k, v]) => [k, redactDeep(v)]));
  }
  return node;
}
