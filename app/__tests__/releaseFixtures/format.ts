/**
 * The shape of one release fixture, and the fixed identity every fixture uses.
 *
 * A fixture is what a used install of one epoch holds on disk, as data. The
 * runner (`../releaseFixtures.test.ts`) loads it into in-memory storage and
 * starts the current app over it. See `README.md` beside this file.
 */

/** `E1` … `E20`: the row of the epoch table in `docs/architecture/persistence/persistence-map.md`. */
type EpochId = `E${number}`;

/**
 * Something the user had that must still be there, read through the current
 * store. `store` is the current storage name; `path` walks the store's state.
 */
export interface SurvivingFact {
  /** Reads as the end of "keeps …". Unique within a fixture. */
  what: string;
  store: string;
  /** Account whose copy is read. Omit for a global store or the active account. */
  accountIndex?: number;
  path: readonly (string | number)[];
  equals: unknown;
}

/** A fact the current app is known to lose. The runner expects it to fail, and fails when it stops failing. */
interface KnownGap {
  /** The `what` of the fact, or one of the runner's named checks. */
  what: string;
  /** Row id in `docs/architecture/follow-ups.md`, or `accepted` with the reason in `why`. */
  followUp: string;
  why: string;
}

export interface ReleaseFixture {
  epoch: EpochId;
  /** Every app version with a store build that wrote this surface. */
  versions: readonly string[];
  /** The commit the shapes below were read from. */
  commit: string;
  /** One line: what changed on disk at this epoch. */
  surface: string;
  /**
   * AsyncStorage as the install left it. A string is stored as it is; any
   * other value is stored as its JSON text, which is what zustand's persist
   * and the app's own `JSON.stringify` calls wrote.
   */
  asyncStorage: Readonly<Record<string, unknown>>;
  /** SecureStore as the install left it. */
  secureStore: Readonly<Record<string, string>>;
  /** SQLite database files that exist. Jest cannot open them; the runner checks the names only. */
  sqliteDatabases: readonly string[];
  survives: {
    phrase: string;
    activeAccountIndex: number;
    /** Every account the install had, with the key each must still open. */
    accounts: readonly { accountIndex: number; pubkey: string; imported?: true }[];
    facts: readonly SurvivingFact[];
    /**
     * Keys the upgrade must leave on disk byte for byte: data with no reader
     * yet (the redux row, a retired store) that a later release may import.
     */
    keptAsyncStorage: readonly string[];
    keptSecureStore: readonly string[];
    /**
     * For an install whose ecash is in the redux row (0.0.1 to 0.0.40): what
     * the row holds per mint, summed over its proofs. The runner checks that
     * the current reader finds exactly this. Swapping it into the wallet
     * needs the mint, so that part is a device check.
     */
    reduxEcash?: readonly { mintUrl: string; amount: number }[];
  };
  /**
   * Stores whose row above holds nothing but the store's defaults, so there is
   * nothing to lose and nothing for the runner to miss. Every other row the
   * current app reads must come back holding something.
   */
  defaultRows: readonly string[];
  knownGaps: readonly KnownGap[];
}

/** Runner checks that are not a `SurvivingFact`, nameable in `knownGaps`. */
export const NAMED_CHECKS = {
  /** Every proof in the redux row (0.0.1 to 0.0.40) is found by the current reader. */
  reduxProofs: 'the ecash in the redux row',
} as const;

// ── The one identity ─────────────────────────────────────────────────────────
//
// The NIP-06 test vector. Account 0's key is published with it
// (https://github.com/nostr-protocol/nips/blob/master/06.md); the others were
// derived with @scure/bip32 at m/44'/1237'/<account>'/0/0, outside the app's
// code. The runner derives them again the same way and compares.

export const PHRASE =
  'leader monkey parrot ring guide accident before fence cannon height naive bean';

/**
 * `sha256(phrase)`, first 16 hex characters: the tag this build's key caches
 * carry. 0.0.61 to 0.0.63 tagged theirs with another hash; those fixtures say which.
 */
export const PHRASE_HASH = '7f56506406dc6faf';

export const ACCOUNTS = [
  {
    pubkey: '17162c921dc4d2518f9a101db33695df1afb56ab82f5ff3e5da6eec3ca5cd917',
    privateKeyHex: '7f7ff03d123792d6ac594bfa67bf6d0c0ab55b6b1fdb6249303fe861f1ccba9a',
    npub: 'npub1zutzeysacnf9rru6zqwmxd54mud0k44tst6l70ja5mhv8jjumytsd2x7nu',
    nsec: 'nsec10allq0gjx7fddtzef0ax00mdps9t2kmtrldkyjfs8l5xruwvh2dq0lhhkp',
    cashuMnemonic:
      'bitter session sketch page tissue silent purity mix begin series arrow various pigeon destroy woman judge agree marine seek crush change alone liar tortoise',
  },
  {
    pubkey: 'd977a6cf0f831dc4720780b5f51460eaf6dca08e32d1f6e89b60344d63af4e04',
    privateKeyHex: '3790c23940f62b23754115ef70f16e63cca8e9015a532b8a891171ccdadcf910',
    npub: 'npub1m9m6dnc0svwugus8sz6l29rqatmdegywxtgld6ymvq6y6ca0fczq88tsjr',
    nsec: 'nsec1x7gvyw2q7c4jxa2pzhhhputwv0x236gptffjhz5fz9cuekkulygqd26n5g',
    cashuMnemonic:
      'omit minute century number region device breeze trophy enter phrase item harsh shove garbage embark audit law turtle scene lift segment renew sister useful',
  },
  {
    pubkey: '29a8e759db36dba3de9bd5048e75fbf8da58856111ea7f05a15786308d266184',
    privateKeyHex: '04be32a71784f303636b683399e92b3cc977bc2c393dcff2cb5b8e5b1c80a914',
    npub: 'npub19x5wwkwmxmd68h5m65zgua0mlrd93ptpz8487pdp27rrprfxvxzqrjhkrz',
    nsec: 'nsec1qjlr9fchsnesxcmtdqeen6ft8nyh00pv8y7ulukttw89k8yq4y2q5qzn0k',
    cashuMnemonic:
      'basket small rice will else caution body layer skate curious auction road possible avoid worth permit genuine skin seminar rubber narrow agent gasp matter',
  },
] as const;

/**
 * An account added by its own secret key, for the epochs that could import one
 * (0.0.62 on). The NIP-19 test vector; the public key was derived with
 * @noble/curves, outside the app's code.
 */
export const IMPORTED = {
  nsec: 'nsec1vl029mgpspedva04g90vltkh6fvh240zqtv9k0t9af8935ke9laqsnlfe5',
  pubkey: '7e7e9c42a91bfef19fa929e5fda1b72e0ebc1a4c1141673e2794234d86addf4e',
} as const;

// ── Row builders ─────────────────────────────────────────────────────────────

/** A zustand `persist` row. Stores written before a store declared a version carry 0. */
export function zustandRow(version: number, state: object): { state: object; version: number } {
  return { state, version };
}

/** The current key of one account's copy of a per-account store. */
export function accountKey(store: string, pubkey: string): string {
  return `${store}:profile:${pubkey}`;
}

/**
 * A redux-persist row: each reducer's state is its own JSON string, and
 * `_persist` carries the migration version (redux-persist `persistReducer`,
 * default `serialize`).
 */
export function reduxPersistRow(version: number, reducers: Record<string, unknown>): string {
  const row: Record<string, string> = {};
  for (const [name, state] of Object.entries(reducers)) row[name] = JSON.stringify(state);
  row._persist = JSON.stringify({ version, rehydrated: true });
  return JSON.stringify(row);
}
