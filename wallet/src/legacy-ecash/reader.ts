import { z } from "zod";

/**
 * Reads the ecash that releases 0.0.1 to 0.0.40 kept in their redux-persist
 * row. Those releases stored the proofs themselves, per profile and per mint:
 *
 *   row            { cashu: "<json>", nostr: "<json>", … }   values are JSON strings
 *   cashu          { profiles: Profile[], keysets?: { [mintUrl]: { id, unit }[] } }
 *   Profile        { mints, proofs: { [mintUrl]: Proof[] }, counters, keysets, transactions }
 *   Proof          { id, amount, secret, C, dleq?, witness? }   as cashu-ts 2.2.2 wrote it
 *   transaction    a Lightning receive carries `paid` and its quote id: as
 *                  `quote` up to 0.0.12, as `mintQuote: { quote, … }` after
 *
 * A profile the old app created on demand has `proofs: []` until its first
 * proof arrives. Nothing here changes the row or throws: an entry that cannot
 * be read is skipped and counted, so the caller can tell that the row still
 * holds something it does not understand.
 */

export interface LegacyProof {
  id: string;
  amount: number;
  secret: string;
  C: string;
  dleq?: unknown;
  witness?: unknown;
}

export interface LegacyEcashGroup {
  /** Stable across launches: old profile position, keyset and mint URL as stored. */
  id: string;
  profileIndex: number;
  /** The old profile's Nostr public key, when the row has one. */
  profilePubkeyHex: string | null;
  mintUrl: string;
  keysetId: string;
  /** From the keysets the old app cached; null when it never cached this one. */
  unit: string | null;
  proofs: LegacyProof[];
}

/** A Lightning receive the old app never recorded as paid. */
export interface LegacyMintQuote {
  mintUrl: string;
  mintQuoteId: string;
  amount: number;
  unit: string;
}

export type LegacyEcashRead =
  /** There is no row. */
  | { kind: "none" }
  /** There is a row and its ecash cannot be read at all. */
  | { kind: "unreadable" }
  | {
      kind: "read";
      groups: LegacyEcashGroup[];
      mintQuotes: LegacyMintQuote[];
      /** Entries that looked like ecash or a quote and could not be read. */
      skipped: number;
    };

/** Enough for a wallet used for a year; a larger list is cut and counted as skipped. */
const MAX_MINT_QUOTES = 200;

const Row = z.record(z.string(), z.unknown());
const CashuSlice = z.looseObject({ profiles: z.array(z.unknown()) });
const NostrSlice = z.looseObject({ profiles: z.array(z.unknown()) });
const Proof = z.looseObject({
  id: z.string().min(1).max(128),
  amount: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  secret: z.string().min(1).max(4096),
  C: z.string().min(1).max(256),
});
const CachedKeyset = z.looseObject({ id: z.string(), unit: z.string().min(1).max(32) });
const MintQuoteId = z.string().min(1).max(512);
const Transaction = z.looseObject({
  mintQuote: z.looseObject({ quote: MintQuoteId }).optional(),
  quote: MintQuoteId.optional(),
  mintUrl: z.string(),
  // The earliest builds stored what was typed, as text.
  amount: z.union([
    z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    z
      .string()
      .regex(/^[1-9]\d{0,14}$/)
      .transform((digits) => Number(digits)),
  ]),
  unit: z.string().min(1).max(32),
});

function parseJson(text: unknown): unknown {
  if (typeof text !== "string") return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function isMintUrl(value: string): boolean {
  if (value.length > 512) return false;
  try {
    const { protocol } = new URL(value);
    return protocol === "https:" || protocol === "http:";
  } catch {
    return false;
  }
}

function entriesOf(value: unknown): [string, unknown][] {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? Object.entries(value)
    : [];
}

/** keyset id -> unit, from one of the row's `{ [mintUrl]: keyset[] }` caches. */
function addCachedUnits(units: Map<string, string>, cache: unknown, mintUrl: string): void {
  const keysets: unknown = entriesOf(cache).find(([url]) => url === mintUrl)?.[1];
  if (!Array.isArray(keysets)) return;
  for (const keyset of keysets) {
    const parsed = CachedKeyset.safeParse(keyset);
    if (parsed.success && !units.has(parsed.data.id)) units.set(parsed.data.id, parsed.data.unit);
  }
}

export function readLegacyEcash(raw: string | null): LegacyEcashRead {
  if (raw === null) return { kind: "none" };
  const row = Row.safeParse(parseJson(raw));
  if (!row.success) return { kind: "unreadable" };
  // A row the old app wrote always has this slice; one without it holds no ecash.
  if (row.data.cashu === undefined) return { kind: "read", groups: [], mintQuotes: [], skipped: 0 };
  const cashu = CashuSlice.safeParse(parseJson(row.data.cashu));
  if (!cashu.success) return { kind: "unreadable" };

  const nostr = NostrSlice.safeParse(parseJson(row.data.nostr));
  const pubkeyOf = (profileIndex: number): string | null => {
    const profile: unknown = nostr.success ? nostr.data.profiles[profileIndex] : undefined;
    if (typeof profile !== "object" || profile === null) return null;
    const pubkey: unknown = Reflect.get(profile, "pubkey");
    return typeof pubkey === "string" && /^[0-9a-f]{64}$/.test(pubkey) ? pubkey : null;
  };

  const groups = new Map<string, LegacyEcashGroup>();
  const mintQuotes = new Map<string, LegacyMintQuote>();
  // The old reducer removed exact duplicates only, so the same proof can sit
  // under two profiles. The first one found owns it.
  const seenSecrets = new Set<string>();
  let skipped = 0;

  cashu.data.profiles.forEach((profile, profileIndex) => {
    if (typeof profile !== "object" || profile === null) {
      skipped += 1;
      return;
    }
    const proofsByMint: unknown = Reflect.get(profile, "proofs");
    if (Array.isArray(proofsByMint)) skipped += proofsByMint.length;

    for (const [mintUrl, proofs] of entriesOf(proofsByMint)) {
      if (!Array.isArray(proofs)) {
        skipped += 1;
        continue;
      }
      if (!isMintUrl(mintUrl)) {
        skipped += proofs.length;
        continue;
      }
      const units = new Map<string, string>();
      addCachedUnits(units, cashu.data.keysets, mintUrl);
      addCachedUnits(units, Reflect.get(profile, "keysets"), mintUrl);

      for (const candidate of proofs) {
        const proof = Proof.safeParse(candidate);
        if (!proof.success) {
          skipped += 1;
          continue;
        }
        const seenKey = `${mintUrl}\n${proof.data.secret}`;
        if (seenSecrets.has(seenKey)) continue;
        seenSecrets.add(seenKey);

        const id = `${profileIndex}|${proof.data.id}|${mintUrl}`;
        let group = groups.get(id);
        if (!group) {
          group = {
            id,
            profileIndex,
            profilePubkeyHex: pubkeyOf(profileIndex),
            mintUrl,
            keysetId: proof.data.id,
            unit: units.get(proof.data.id) ?? null,
            proofs: [],
          };
          groups.set(id, group);
        }
        group.proofs.push(proof.data);
      }
    }

    const transactions: unknown = Reflect.get(profile, "transactions");
    if (!Array.isArray(transactions)) return;
    for (const candidate of transactions) {
      if (typeof candidate !== "object" || candidate === null) continue;
      // Sends, ecash receives and failed quote requests carry no quote id.
      if (Reflect.get(candidate, "mintQuote") == null && Reflect.get(candidate, "quote") == null) {
        continue;
      }
      // A send names the quote it paid, which is not one that mints anything.
      if (Reflect.get(candidate, "transactionType") === "send") continue;
      // The old app set `paid` once it had minted the ecash for the invoice.
      if (Reflect.get(candidate, "paid") === true) continue;
      const transaction = Transaction.safeParse(candidate);
      const mintQuoteId = transaction.data?.mintQuote?.quote ?? transaction.data?.quote;
      if (!transaction.success || mintQuoteId === undefined || !isMintUrl(transaction.data.mintUrl)) {
        skipped += 1;
        continue;
      }
      const { mintUrl, amount, unit } = transaction.data;
      const key = `${mintUrl}\n${mintQuoteId}`;
      if (mintQuotes.has(key)) continue;
      if (mintQuotes.size >= MAX_MINT_QUOTES) {
        skipped += 1;
        continue;
      }
      mintQuotes.set(key, { mintUrl, mintQuoteId, amount, unit });
    }
  });

  return { kind: "read", groups: [...groups.values()], mintQuotes: [...mintQuotes.values()], skipped };
}
