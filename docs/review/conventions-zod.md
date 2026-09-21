# Zod and boundary validation

Rules for schemas at the network, relay, route, QR and persistence boundaries (zod 4). Same format and standing as the [contributor conventions](contributor-conventions.md): human and agent guidance that Hunch compiles into review questions. Every rule here was reproduced against the installed package versions before it was accepted; when a dependency is upgraded, re-check the rules that name its behaviour.

## money/integer-schema

Scope: `repository-wide`

A schema field that carries sats, msats, fees or any amount that can decide a payment is an integer schema, because `z.number()` accepts fractions, negatives and integers beyond 2^53.

Does `hunk` declare a schema field for a payable amount (`amount`, `sats`, `msat`, `fee`, `reserve`, `balance`, `total`, a proof or quote amount) as `z.number()` — alone or with only `.positive()`, `.nonnegative()`, `.min(…)` or `.max(…)` — without `.int()`, `z.int()` or the shared `Sats` primitive, or as `z.union([z.number(), z.string()])` that the hunk or the schema's consumer then compares, adds or sends as an amount without an integer check?

Allowed cases: `Sats`, `CountInt` or `z.number().int()`/`z.int()` (both enforce the safe-integer range in Zod 4); fiat rates, prices, scores, percentages, latencies and other display-only floats; a loose read of a third-party history row whose amount is only displayed or logged and is re-validated before it decides a payment; a serialised SDK amount kept as `number | string` on a row that is only logged or forwarded; bigint or decimal-string amounts validated by a digit regex.

## zod/coerce-beyond-number

Scope: `repository-wide`

`z.coerce.string()`, `z.coerce.bigint()` and `z.coerce.date()` manufacture values from missing or junk input just as `z.coerce.number()` does.

Does `hunk` add `z.coerce.string()` (turns `null` into `"null"`, `undefined` into `"undefined"`, an object into `"[object Object]"`), `z.coerce.bigint()` (turns `''` into `0n` and `true` into `1n`) or `z.coerce.date()` (turns `null` and `0` into 1970-01-01 and `true` into 1 ms) to a schema that parses network, relay, storage, route or QR input?

Allowed cases: The coercion is applied to a value a preceding schema already proved to be a non-empty string of the right format (`z.string().regex(…).pipe(z.coerce.bigint())`); `z.iso.datetime()` or an integer epoch schema instead of `z.coerce.date()`; tests.

## zod/url-scheme

Scope: `repository-wide`

`z.url()` and `z.string().url()` accept every scheme `new URL` accepts — `javascript:`, `data:`, `file:`, `mailto:`, custom schemes — so a URL that will be fetched, opened, rendered or stored names its allowed protocol.

Does `hunk` add `z.url()` or `z.string().url()` with no `protocol` option (or only a later `.refine` that inspects the protocol) to a schema for a mint URL, relay URL, media or upload server, image/avatar URL, LNURL callback, deep-link target or any URL passed to `fetch`, `Linking.openURL`, a WebView or an `Image`?

Allowed cases: `HttpUrl`/`WebSocketUrl` from `@sovranbitcoin/schemas`; `z.url({ protocol: /^https?$/ })`, `/^https$/` or `/^wss?$/` with a `.max(…)`; `z.httpUrl()`; a schema whose whole purpose is to accept arbitrary URI schemes (a generic QR or clipboard classifier) and whose output is never fetched or opened without a second scheme check.

## zod/url-identity

Scope: `repository-wide`

`z.url()` validates `value.trim()` but returns the original string, and only the exact regex `/^https?$/` enforces `://`, so a validated URL is not yet a canonical identity.

Does `hunk` use the output of a `z.url(…)` schema as an identity — a record or Map key, a persisted mint/relay/server URL, a dedupe or equality comparison, a trust or allow-list entry — without `normalize: true`, a `.trim()`/normalising transform, or the app's URL normaliser (`normalizeMintUrlKey`, `normalizeMintUrl`, `normalizeRelayUrl`, `normalizeMediaServer`, `stripTrailingSlashes`), or add `z.url({ protocol: X })` where `X` is a regex other than the exact `/^https?$/` (for example `/^wss$/`, `/^https$/`) and rely on it to reject `wss:relay.example` or `https:/host`?

Allowed cases: The value is normalised before it is stored, compared or used as a key; `z.url({ normalize: true, … })`; the URL is only displayed or handed once to `fetch`/`new WebSocket`; a protocol regex paired with an explicit `^[a-z]+://` check.

## zod/hex-ids

Scope: `repository-wide`

A Nostr event id, pubkey, signature or SHA-256 digest is validated for length and hex charset, not as a bare or length-only string.

Does `hunk` declare a schema field for a Nostr event id, pubkey, signature, P2PK key or hash (`id`, `eventId`, `pubkey`, `peer`, `author`, `sig`, `sha256`, `x`) on relay, network, route, QR or persisted input as `z.string()`, `z.string().max(…)`, `z.string().length(64)` or another length-only check with no charset constraint, or use `z.hex()` alone (no length), so that the value is used without its hex format ever being checked?

Allowed cases: `Hex64`, `Hex128`, `Sha256Hex`, `HexOrNpub` from `@sovranbitcoin/schemas`; `NostrPubkeyHexSchema`/`NostrEventIdSchema` from `app/shared/lib/protocolIds.ts` (deliberately case-tolerant for reads); `z.string().refine(isNostrPubkeyHex)`; `z.hash('sha256')` or `z.hex().length(64)` on a read path where uppercase is acceptable; opaque non-Nostr ids (operation ids, quote ids, UUIDs) bounded with `.max(…)`; a loose upstream envelope whose events are signature-verified before use; a field that the same function passes through a hex predicate (`isNostrPubkeyHex`, a 64-hex regex) before any use, dropping or nulling it on failure.

## nostr/event-schema-bounds

Scope: `nostr/**/*.{ts,tsx}`, `**/{nostr,relay,relays,feed,threads,contacts,composer,profile,profiles,notifications,dm,dms,zap,zaps}/**/*.{ts,tsx}`, `**/*{Nostr,Relay,Nip,Npub,Nagg,Primal,Zap,GiftWrap,Giftwrap}*.{ts,tsx}`

A schema for a raw Nostr event bounds every attacker-sized part and models tags as bounded string arrays, never as fixed tuples.

Does `hunk` add or edit a schema for a raw Nostr event or tag in which `created_at` is `z.number()` without `.int()`, `content` or a tag element is `z.string()` without `.max(…)`, `tags` is `z.array(z.array(z.string()))` without `.max(…)` on both levels, or a tag is a `z.tuple([...])` without `.rest(…)` (Zod rejects `['e', id, relay, marker]` against a two-element tuple with `too_big`)?

Allowed cases: Bounded arrays (`z.array(z.array(z.string().max(n)).max(m)).max(k)`); `z.tuple([...]).rest(z.string().max(n))`; a schema for an event the app itself just built and signed; an envelope module that documents a transport-level size limit enforced before parsing.

## input/size-caps

Scope: `repository-wide`

Every string, array and record parsed from input someone else controls carries a size cap, because Zod validates a 10 MB string or a million-item array without complaint and the result flows into state, caches and AsyncStorage.

Does `hunk` add, to a schema that parses a network or relay response, a route or deep-link param, a QR, NFC, BLE or clipboard payload, or a persisted blob, a `z.string()` with no `.max(…)`, `.length(…)` or bounded-quantifier `.regex(…)`, a `z.array(…)` with no `.max(…)`, or a `z.record(…)` with neither a bounded key schema nor a size check (`.refine((r) => Object.keys(r).length <= N)` or a tolerant helper with a cap)?

Allowed cases: `z.enum`, `z.literal` and string-format schemas that are length-limited by construction (`Hex64`, `Bolt11`, `LightningAddress`, `HttpUrl`); the house `.max(2048)` for URLs and comparable named limits; fields inside a schema that only parses constants the module owns; a documented transport-level byte limit enforced before the parse; tests and fixtures.

## zod/cap-before-expensive-check

Scope: `repository-wide`

Zod runs every check on a schema even after an earlier one failed, so `.max(n)` does not protect a later `.regex`, `.refine` or decoder from a huge input unless it aborts.

Does `hunk` chain, on a string from untrusted input, a `.regex(…)` with nested or overlapping quantifiers, or a `.refine`/`.superRefine` that decodes, hashes, bech32/base64-decodes or `JSON.parse`s the value, after a `.max(…)`/`.length(…)` that lacks `{ abort: true }` — or with no length check before it at all?

Allowed cases: `.max(n, { abort: true })` before the expensive check; a linear-time anchored regex with bounded quantifiers (`/^[a-f0-9]{64}$/`); a cheap predicate (`isNostrPubkeyHex`, a `startsWith`); a `.pipe(…)` whose first schema carries the cap (a failed first stage stops the pipe); length checked by the caller before `safeParse`.

## zod/union-order

Scope: `repository-wide`

`z.union` returns the first member that parses, and object members strip unknown keys, so a broad member listed first silently wins and drops the fields of a narrower one.

Does `hunk` add or reorder a `z.union([...])` in which an earlier object member's required keys are a subset of a later member's (the later member's extra fields are stripped), or an earlier member can never fail — it ends in `.catch(…)`, is a `z.coerce.*`, `z.unknown()`/`z.any()`, or an object whose keys are all optional?

Allowed cases: Members that are mutually exclusive by a literal tag, by primitive type (`z.union([z.number(), z.string()])`) or by disjoint required keys; most-specific member first with a comment; `z.strictObject` members; a deliberately permissive last member used as a fallback.

## zod/tagged-union

Scope: `repository-wide`

Objects that share a literal tag are a `z.discriminatedUnion`, which reports the failing field's path instead of one pathless `invalid_union` and does not try every member.

Does `hunk` add a `z.union([...])` whose members are all objects carrying the same key as a `z.literal` or single-value `z.enum` (`ok: z.literal(true)` / `ok: z.literal(false)`, `type: z.literal('…')`, `kind`, `status`, `transport`) instead of `z.discriminatedUnion('<key>', [...])`?

Allowed cases: Members without a common literal key; error-body schemas that match by shape because upstreams disagree; a union member that is itself a union or a primitive; a tag read from a nested path; a persisted or list item where an unknown tag must degrade per entry rather than reject (use the tolerant helpers or a per-item parse).

## zod/shared-fallback-reference

Scope: `repository-wide`

`.catch(value)` returns the very same object on every fallback, and `.default(value)` clones only one level, so a mutable fallback is shared state between parses.

Does `hunk` pass an array or object to `.catch(` by value — `.catch([])`, `.catch({})`, `.catch({ … })`, or `.catch(SOME_CONSTANT)` where the constant holds an array or object — or pass `.default(` an object or array that itself contains nested arrays or objects (`.default({ items: [] })`, `.default(DEFAULTS)`), where the parsed result enters a store, cache or any value that is later mutated, pushed to or handed to immer?

Allowed cases: A factory (`.catch(() => [])`, `.catch(() => ({}))`, `.default(() => ({ items: [] }))`); `.prefault(…)` (re-parsed, so nested values are fresh); primitives, `undefined` and `null`, including a constant that is a string, number, boolean or enum member (`.catch(DEFAULT_MODE)` where `DEFAULT_MODE = 'relaxed'`); flat `.default([])`/`.default({})` (Zod 4 returns a fresh shallow copy per parse); a fallback that is frozen (`Object.freeze`) or provably never mutated.

## persist/additive-fields

Scope: `**/stores/**/*.{ts,tsx}`, `**/*[Ss]tore.{ts,tsx}`, `**/persist/**/*.ts`, `**/{cache,caches}/**/*.ts`, `**/*[Cc]ache.ts`

A field added to a persisted schema must parse when the key is absent, because every blob written before the change lacks it and one missing key discards the whole store.

Does `hunk` add a field to a schema passed to `persistConfig({ schema })` (or to a row schema inside it) that is required when absent — no `.optional()`, `.default(…)`, `.catch(…)` or `.nullish()`, including a field that is only `.nullable()` (the key is still required) — without a `version` bump whose `migrate` fills the field?

Allowed cases: `.optional()`, `.nullish()`, `.default(v)`, `.nullable().default(null)`, `.catch(v)` with a neutral value (see `persist/fallbacks`); a row inside `tolerantArray`/`tolerantRecord` where dropping old rows is intended and said so; a `version` bump plus `migrate` that writes the new field, with a regression test; a brand-new store with no shipped blobs.

## persist/caps-match-writers

Scope: `**/stores/**/*.{ts,tsx}`, `**/*[Ss]tore.{ts,tsx}`, `**/persist/**/*.ts`, `**/{cache,caches}/**/*.ts`, `**/*[Cc]ache.ts`

A size or format bound in a persisted schema is a promise the store's writers must keep, because a blob that exceeds it is rejected whole on the next launch.

Does `hunk` add or lower a `.max(…)`, `.length(…)`, `.min(…)`, `.regex(…)` or size `.refine(…)` on a persisted collection or field (or the `max` argument of `tolerantArray`) without the store's write path in the same change trimming, capping or validating to the same bound — or add a writer that appends to a persisted collection whose schema has a `.max(…)` without enforcing that cap?

Allowed cases: The writer slices or evicts to a shared constant that the schema also uses; the bound is contained per entry by `tolerantArray`/`tolerantRecord` so an oversize or malformed row drops alone; a `.transform` that bounds on read (`boundPeers`) instead of rejecting; a capacity test in `app/__tests__/persistedCapacity.test.ts` covering the store.

## zod/custom-needs-predicate

Scope: `repository-wide`

`z.custom<T>()` without a predicate accepts every value, and `.brand<…>()` adds a type and no runtime check, so the type they produce must be earned by validation in the same schema.

Does `hunk` add `z.custom<T>()` with no validator function, a `.brand<…>()` (or a branded `z.custom`) on a schema that has no charset, length, format or predicate check behind the brand, or create a branded/protocol id value with an `as` cast (`value as NostrPubkeyHex`, `as Hex64`) on data that did not pass the branded schema or its type guard?

Allowed cases: `z.custom<T>(predicate, message)` with a real type guard (`NostrPubkeyHexSchema`); a brand applied after `.regex`/`.refine`; casts inside the single constructor or guard that owns the brand (`protocolIds.ts`), or in a `.transform` directly after the validating check (`nip46Uri.ts` `PubkeyHexSchema`); tests.

## zod/use-parsed-output

Scope: `repository-wide`

After a successful parse the program continues with `result.data` (or the `Result` value), never with the raw input, which still holds stripped keys and un-normalised values.

Does `hunk` use `schema.safeParse(x).success` or `parseWith(...)(x).isOk()` as a boolean gate and then read, store, spread or send the original `x` — when the schema is an object schema (strip mode drops unknown keys only from `.data`), or contains a `.transform`, `.toLowerCase()`, `.trim()`, `.default`, `.catch`, `.pipe`, a codec or a brand?

Allowed cases: A primitive string or number validated by a schema with no transforming step and used as a plain predicate (`LightningAddress.safeParse(v).success`, `Hex64.safeParse(v).success`); the raw value kept deliberately and verbatim (a signed Nostr event, a token string) with display data derived from `.data`; tests.

## zod/infer-direction

Scope: `repository-wide`

`z.infer` is the OUTPUT type; a value that is fed INTO a schema with a transform, default, catch, pipe or coercion is typed `z.input`, and an output is never parsed a second time by the same schema.

Does `hunk` type a value that is written, sent, serialised or passed to `.parse`/`.safeParse` with `z.infer<typeof S>`/`z.output<typeof S>` where `S` contains a type-changing `.transform`, `.pipe`, `z.coerce.*` or codec, or re-parse with `S` a value that `S` already produced (the transformed output fails the input schema with `invalid_type`)?

Allowed cases: Schemas whose input and output types are identical; `z.input<typeof S>` for writers and `z.infer` for readers; idempotent string normalisers (`.trim()`, `.toLowerCase()`); `z.codec` with `.encode` for the reverse direction; a second parse by a different schema (a narrower view).

## zod/loose-output-containment

Scope: `repository-wide`

A `z.looseObject` or `.passthrough()` result still carries every unknown key the sender chose, with any value and any size, so it is copied field by field into trusted or durable objects.

Does `hunk` spread the output of a `z.looseObject`/`.passthrough()`/`.catchall()` parse of network, relay, QR or deep-link data after trusted fields in an object literal (`{ trusted: false, ...parsed }` lets the sender overwrite `trusted`), merge it with `Object.assign`, or write the whole parsed object into a persisted store, a query cache or AsyncStorage?

Allowed cases: Picking named fields (`{ mintUrl: parsed.mintUrl, name: parsed.name }`); spreading the parsed object first and the trusted fields after it; a strip-mode `z.object` view applied before the spread or the write; in-memory pass-through of a protocol object whose unknown fields must be preserved verbatim (a coco-core history entry re-serialised by `wallet/src/operations`), bounded by the transport size; persisted rows that are loose by house convention and written only by the app's own `partialize`.

## zod/record-lookup

Scope: `repository-wide`

A parsed `z.record` is a plain object typed as having a value for every key: a lookup by an outside key can return `undefined`, or an inherited member such as `constructor`, while the compiler says it is a row.

Does `hunk` index the output of a `z.record(z.string(), …)` (or a store map typed `Record<string, T>`) with a key that comes from a relay, route param, deep link, QR or other external input and use the result without an `undefined` check, or test membership with `key in record` / truthiness instead of `Object.hasOwn(record, key)`?

Allowed cases: `record[key]?.…`, an explicit `=== undefined` guard or `Object.hasOwn`; keys validated as `Hex64`, npub or an `HttpUrl` (they cannot spell an `Object.prototype` member); iteration with `Object.entries`/`Object.keys`; a `Map`.

## input/per-item-containment

Scope: `repository-wide`

One malformed item from a relay or third-party API costs that item, not the page: `z.array(Item)` fails as a whole, and filtering inside a transform hides how many were dropped.

Does `hunk` parse a list that comes from relays or a third-party upstream (Primal, mempool, BTC Map, mint directories, LNURL services) with `z.array(StrictItemSchema)` inside the response schema so that a single bad item rejects the entire response, or drop invalid items inside a schema `.transform`/`.catch` on such a list without counting or logging the rejects?

Allowed cases: An outer loop that `safeParse`s each item and logs a reject count; all-or-nothing parsing of our own nagg contract where a bad item means a contract bug worth surfacing; `tolerantArray`/`tolerantRecord` for persisted blobs (their purpose is per-entry containment on rehydrate); item fields made individually tolerant with `.optional().catch(undefined)`.

## routes/param-schemas

Scope: `app/app/**/*.tsx`, `**/lib/*RouteParams.ts`, `**/nav/**/*.ts`

Route and deep-link params arrive as `string | string[]`, are attacker-controlled, and a bad param bounces the route — it is never coerced or defaulted into a valid one.

Does `hunk` give a schema passed to `useRouteParams` a non-string field (`z.number()`, `z.int()`, `z.boolean()`, `z.array(…)`, `z.object(…)` — these can never match and the route always navigates back), a `z.coerce.*` field, a `.catch(…)` that rewrites an invalid param into a valid one, a `z.string()` without `.max(…)`, or a JSON-carrying param whose inner payload is `JSON.parse`d without a bounded schema of its own?

Allowed cases: `z.string().max(n)`, `z.enum([...])`, `Hex64`/npub schemas; numbers as `z.string().regex(/^[0-9]{1,16}$/)` followed by `.transform(Number).pipe(z.int()…)`; flags via `z.stringbool()` or an explicit enum; `.optional()` for absent params; a JSON param parsed with `safeParse` against a bounded inner schema (`EntrySchema`) after a `.max(…)` on the string.

## zod/recursive-depth

Scope: `repository-wide`

A recursive schema recurses on the call stack: input nested a few thousand levels deep, or a cyclic object, throws `RangeError` out of `safeParse` even though `JSON.parse` accepted it.

Does `hunk` add a recursive schema (`z.lazy(() => …)` or a getter property that returns the enclosing schema) that parses network, relay, QR, deep-link or persisted data without a depth bound — a size cap on the raw text, an explicit depth-limited schema, or a `try/catch` around the parse that reports a parse error?

Allowed cases: A schema unrolled to a fixed depth; raw input capped to a byte length that makes deep nesting impossible before `JSON.parse`; recursion over data the app built itself; the parse wrapped so a `RangeError` becomes a `ParseError` result.

## zod/partial-defaults

Scope: `repository-wide`

`.partial()` keeps each field's `.default()` and `.catch()`, so parsing a patch that omits a key yields the default for it and an update built from the result overwrites the stored value.

Does `hunk` derive an update, patch or settings-override schema with `.partial()` (or `.pick(…).partial()`) from a schema whose fields carry `.default(…)`/`.catch(…)`, and then merge the parsed result over existing state (`{ ...current, ...parsed }`, `set(parsed)`)?

Allowed cases: A patch schema declared without defaults; omitted keys removed before the merge; `.partial()` on a schema with no `.default`/`.catch` fields; a lenient read of an upstream object where filling defaults is the intent and nothing is merged over stored state.

## zod/enum-source

Scope: `repository-wide`

`z.enum` infers a literal union only from an `as const` tuple or object; an enum built from `Object.keys(…)` or a plain `string[]` validates at runtime but its type is `string`, and every exhaustive `switch` or `Record<Union, …>` downstream stops checking.

Does `hunk` build a `z.enum(…)` from `Object.keys(X)`, a non-`as const` array variable, a `.map(…)` result or anything cast to `[string, ...string[]]`?

Allowed cases: `z.enum(['a', 'b'])` literals; an `as const` array or object passed directly (`z.enum(SWITCHABLE_UNITS)`); `z.enum(X)` with a TypeScript `enum` or `as const` object; an array whose declared element type is already the literal union (`readonly AccountUnit[]` from the unit registry); `.extract`/`.exclude`/`.options` of an existing enum; a genuinely dynamic vocabulary where `string` is the honest type.
