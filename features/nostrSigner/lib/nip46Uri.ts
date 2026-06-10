/**
 * @fileoverview NIP-46 pairing URI codec
 *
 * buildBunkerUri / parseNostrconnectUri / parseBunkerUri / parseNip46Uri plus
 * the perms CSV codec. Query parsing is fully manual (split on & and =,
 * decodeURIComponent) — `URLSearchParams.getAll` is not dependable on Hermes,
 * and a hand-rolled parser keeps behavior identical across JS engines.
 * Parsed URIs carry bearer secrets: never log them, and returned errors embed
 * only zod paths/codes, never raw input.
 */

import { err, ok, Result } from 'neverthrow';
import { z } from 'zod';

import {
  MAX_EVENT_KIND,
  Nip46MethodSchema,
  type PermToken,
} from '@/features/nostrSigner/lib/nip46Types';
import { grantKeyFor } from '@/features/nostrSigner/lib/permissionPolicy';

const MAX_URI_RELAYS = 5;
const MAX_PERMS_ENTRIES = 32;
const MAX_SECRET_LENGTH = 64;
const MAX_NAME_LENGTH = 120;
const MAX_URL_LENGTH = 2048;
// Rejected perms entries surface in UI/logs — cap attacker-controlled length.
const MAX_DROPPED_ENTRY_LENGTH = 64;

export type Nip46UriError =
  | { type: 'unsupported_scheme' }
  | { type: 'bad_encoding' }
  | { type: 'duplicate_param'; param: string }
  | { type: 'invalid_field'; issues: string[] };

const PubkeyHexSchema = z
  .string()
  .regex(/^[0-9a-fA-F]{64}$/)
  .transform((value) => value.toLowerCase());

const RelayListSchema = z
  .array(z.url({ protocol: /^wss$/ }).max(MAX_URL_LENGTH))
  .min(1)
  .max(MAX_URI_RELAYS);

const SecretSchema = z.string().min(1).max(MAX_SECRET_LENGTH);

const HttpsUrlSchema = z.url({ protocol: /^https$/ }).max(MAX_URL_LENGTH);

const NostrConnectFieldsSchema = z.strictObject({
  clientPubkey: PubkeyHexSchema,
  relays: RelayListSchema,
  secret: SecretSchema,
  name: z.string().max(MAX_NAME_LENGTH).optional(),
  url: HttpsUrlSchema.optional(),
  image: HttpsUrlSchema.optional(),
});

const BunkerFieldsSchema = z.strictObject({
  signerPubkey: PubkeyHexSchema,
  relays: RelayListSchema,
  secret: SecretSchema.optional(),
});

export interface ParsedNostrConnectUri {
  type: 'nostrconnect';
  clientPubkey: string;
  relays: string[];
  secret: string;
  name?: string;
  url?: string;
  image?: string;
  /** Grantable perm tokens decoded from the `perms` CSV. */
  perms: PermToken[];
}

interface ParsedBunkerUri {
  type: 'bunker';
  signerPubkey: string;
  relays: string[];
  secret?: string;
}

type ParsedNip46Uri = ParsedNostrConnectUri | ParsedBunkerUri;

interface BuildBunkerUriInput {
  signerPubkey: string;
  relays: string[];
  secret: string;
}

/** Inputs are internally generated (derived pubkey, config relays, CSPRNG secret) — infallible. */
export function buildBunkerUri({ signerPubkey, relays, secret }: BuildBunkerUriInput): string {
  const params = [
    ...relays.map((relay) => `relay=${encodeURIComponent(relay)}`),
    `secret=${encodeURIComponent(secret)}`,
  ];
  return `bunker://${signerPubkey}?${params.join('&')}`;
}

// URLSearchParams semantics: '+' means space, then percent-decode (so %2B stays '+').
const decodeComponent = Result.fromThrowable(
  (value: string) => decodeURIComponent(value.replace(/\+/g, ' ')),
  (): Nip46UriError => ({ type: 'bad_encoding' })
);

type QueryPair = readonly [key: string, value: string];

/**
 * Manual query-string parser. Splits on '&' and the first '=' per segment;
 * a segment without '=' becomes a key with an empty value. Exported for
 * direct unit coverage of the Hermes-independent path.
 */
export function parseQueryString(query: string): Result<QueryPair[], Nip46UriError> {
  const pairs: QueryPair[] = [];
  for (const segment of query.split('&')) {
    if (segment === '') continue;
    const eq = segment.indexOf('=');
    const key = decodeComponent(eq === -1 ? segment : segment.slice(0, eq));
    if (key.isErr()) return err(key.error);
    const value = decodeComponent(eq === -1 ? '' : segment.slice(eq + 1));
    if (value.isErr()) return err(value.error);
    pairs.push([key.value, value.value]);
  }
  return ok(pairs);
}

interface UriParts {
  scheme: 'nostrconnect' | 'bunker';
  authority: string;
  query: string;
}

const SCHEME_RE = /^(nostrconnect|bunker):\/\//i;

function splitUri(raw: string): Result<UriParts, Nip46UriError> {
  const trimmed = raw.trim();
  const schemeMatch = SCHEME_RE.exec(trimmed);
  if (!schemeMatch) return err({ type: 'unsupported_scheme' });
  const scheme = schemeMatch[1]!.toLowerCase() as UriParts['scheme'];
  // Fragments are meaningless in pairing URIs — drop defensively.
  const rest = trimmed.slice(schemeMatch[0].length).split('#')[0] ?? '';
  const questionIndex = rest.indexOf('?');
  const rawAuthority = questionIndex === -1 ? rest : rest.slice(0, questionIndex);
  const query = questionIndex === -1 ? '' : rest.slice(questionIndex + 1);
  const authority = rawAuthority.endsWith('/') ? rawAuthority.slice(0, -1) : rawAuthority;
  return ok({ scheme, authority, query });
}

const SINGLE_PARAMS = ['secret', 'name', 'url', 'image', 'perms'] as const;
type SingleParam = (typeof SINGLE_PARAMS)[number];

interface CollectedParams {
  relays: string[];
  singles: Partial<Record<SingleParam, string>>;
}

/**
 * `relay` repeats (identical duplicates collapse); every other known param is
 * single-valued and a repeat is rejected — duplicate-parameter injection must
 * not let a second value shadow the one the user reviewed. Unknown params are
 * ignored for forward compatibility.
 */
function collectParams(pairs: readonly QueryPair[]): Result<CollectedParams, Nip46UriError> {
  const relays: string[] = [];
  const singles: Partial<Record<SingleParam, string>> = {};
  for (const [key, value] of pairs) {
    if (key === 'relay') {
      if (!relays.includes(value)) relays.push(value);
      continue;
    }
    if ((SINGLE_PARAMS as readonly string[]).includes(key)) {
      const param = key as SingleParam;
      if (singles[param] !== undefined) return err({ type: 'duplicate_param', param });
      singles[param] = value;
    }
  }
  return ok({ relays, singles });
}

function invalidField(error: z.ZodError): Nip46UriError {
  // Paths/codes only — values may embed the bearer secret.
  const issues = error.issues.map((issue) => `${issue.path.join('.')}: ${issue.code}`);
  return { type: 'invalid_field', issues };
}

/** Empty or whitespace-only optional metadata is treated as absent, not invalid. */
function optionalTrimmed(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

export function parseNostrconnectUri(raw: string): Result<ParsedNostrConnectUri, Nip46UriError> {
  return splitUri(raw).andThen((parts) => {
    if (parts.scheme !== 'nostrconnect') {
      return err<never, Nip46UriError>({ type: 'unsupported_scheme' });
    }
    return parseQueryString(parts.query)
      .andThen(collectParams)
      .andThen(({ relays, singles }) => {
        const fields = NostrConnectFieldsSchema.safeParse({
          clientPubkey: parts.authority,
          relays,
          secret: singles.secret,
          name: optionalTrimmed(singles.name),
          url: optionalTrimmed(singles.url),
          image: optionalTrimmed(singles.image),
        });
        if (!fields.success) return err<never, Nip46UriError>(invalidField(fields.error));
        return parsePermsCsv(singles.perms ?? '').map(
          ({ tokens }): ParsedNostrConnectUri => ({
            type: 'nostrconnect',
            ...fields.data,
            perms: tokens,
          })
        );
      });
  });
}

export function parseBunkerUri(raw: string): Result<ParsedBunkerUri, Nip46UriError> {
  return splitUri(raw).andThen((parts) => {
    if (parts.scheme !== 'bunker') return err<never, Nip46UriError>({ type: 'unsupported_scheme' });
    return parseQueryString(parts.query)
      .andThen(collectParams)
      .andThen(({ relays, singles }) => {
        const fields = BunkerFieldsSchema.safeParse({
          signerPubkey: parts.authority,
          relays,
          secret: singles.secret,
        });
        if (!fields.success) return err<never, Nip46UriError>(invalidField(fields.error));
        return ok<ParsedBunkerUri, Nip46UriError>({ type: 'bunker', ...fields.data });
      });
  });
}

/** Parse either pairing URI form (scan/paste input), dispatching on scheme. */
export function parseNip46Uri(raw: string): Result<ParsedNip46Uri, Nip46UriError> {
  return splitUri(raw).andThen(
    (parts): Result<ParsedNip46Uri, Nip46UriError> =>
      parts.scheme === 'nostrconnect' ? parseNostrconnectUri(raw) : parseBunkerUri(raw)
  );
}

interface ParsedPermsCsv {
  tokens: PermToken[];
  dropped: string[];
}

const KIND_TOKEN_RE = /^\d{1,5}$/;

function parsePermEntry(entry: string): PermToken | null {
  const colon = entry.indexOf(':');
  const rawMethod = colon === -1 ? entry : entry.slice(0, colon);
  const rawKind = colon === -1 ? undefined : entry.slice(colon + 1);
  const method = Nip46MethodSchema.safeParse(rawMethod);
  if (!method.success) return null;
  if (method.data === 'sign_event') {
    if (rawKind === undefined || !KIND_TOKEN_RE.test(rawKind)) return null;
    const kind = Number(rawKind);
    if (kind > MAX_EVENT_KIND) return null;
    return { method: method.data, kind };
  }
  // A kind qualifier is only meaningful on sign_event.
  if (rawKind !== undefined) return null;
  return { method: method.data };
}

/**
 * Decode the nostrconnect `perms` CSV (`method[:kind]`, comma-separated).
 * Entries that cannot become a standing grant — unknown methods, missing or
 * out-of-range sign_event kinds, kinds on non-sign methods, auto-class
 * methods (ping/get_public_key/connect) — are dropped per-entry and reported.
 * Valid duplicates collapse silently; more than MAX_PERMS_ENTRIES is an error.
 */
export function parsePermsCsv(csv: string): Result<ParsedPermsCsv, Nip46UriError> {
  const entries = csv
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry !== '');
  if (entries.length > MAX_PERMS_ENTRIES) {
    return err({ type: 'invalid_field', issues: ['perms: too_big'] });
  }
  const tokens: PermToken[] = [];
  const dropped: string[] = [];
  const seen = new Set<string>();
  for (const entry of entries) {
    const token = parsePermEntry(entry);
    if (token === null || grantKeyFor(token.method, token.kind) === null) {
      dropped.push(entry.slice(0, MAX_DROPPED_ENTRY_LENGTH));
      continue;
    }
    const key = token.kind === undefined ? token.method : `${token.method}:${token.kind}`;
    if (seen.has(key)) continue;
    seen.add(key);
    tokens.push(token);
  }
  return ok({ tokens, dropped });
}

/** Encode perm tokens back to the CSV wire form. */
export function buildPermsCsv(tokens: readonly PermToken[]): string {
  return tokens
    .map((token) => (token.kind === undefined ? token.method : `${token.method}:${token.kind}`))
    .join(',');
}

/**
 * Re-encode a parsed nostrconnect URI to its wire form (the connect sheet's
 * payload contract). Inverse of `parseNostrconnectUri` for everything the sheet
 * consumes — only the grantable `perms` survive a parse, so ungrantable entries
 * never round-trip. Lives beside the parser/`buildBunkerUri` so the URI codec
 * stays in one layer.
 */
export const encodeNostrconnectUri = Result.fromThrowable(
  (parsed: ParsedNostrConnectUri): string => {
    const params = [
      ...parsed.relays.map((relay) => `relay=${encodeURIComponent(relay)}`),
      `secret=${encodeURIComponent(parsed.secret)}`,
    ];
    if (parsed.perms.length > 0) {
      params.push(`perms=${encodeURIComponent(buildPermsCsv(parsed.perms))}`);
    }
    if (parsed.name !== undefined) params.push(`name=${encodeURIComponent(parsed.name)}`);
    if (parsed.url !== undefined) params.push(`url=${encodeURIComponent(parsed.url)}`);
    if (parsed.image !== undefined) params.push(`image=${encodeURIComponent(parsed.image)}`);
    return `nostrconnect://${parsed.clientPubkey}?${params.join('&')}`;
  },
  () => 'encode_failed' as const
);
