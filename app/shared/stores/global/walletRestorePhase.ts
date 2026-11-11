/**
 * The wallet restore, decoded from the status the `wallet-lifecycle` record
 * saves, and the questions the app asks of it.
 *
 * Dependency-free on purpose: the prompt rules and the processors' wait read
 * it without loading the store.
 *
 * What is saved stays as older releases wrote it. Two of the six statuses have
 * no writer in this build and are still read, for installs that hold them:
 * `in-progress`, which an earlier build's recovery screen wrote when a run
 * started and never cleared, and `failed`, a run that failed (its error in
 * `lastRestoreError`), which the store's enum has accepted since it was added
 * though no writer of it is in this repository's history. Both send the
 * restore gate back to deciding from the keychain and the seed marker.
 */

/** Every status the record is saved with. Saved data: never rename or remove one. */
export const RESTORE_STATUSES = [
  'unknown',
  'not-needed',
  'pending',
  'in-progress',
  'complete',
  'failed',
] as const;

export type RestoreStatus = (typeof RESTORE_STATUSES)[number];

/** What the saved status means. No phase carries data: none is read. */
type RestorePhase =
  /** Not decided yet: nothing saved, or a status this build does not know. */
  | 'undecided'
  /** The gate found a phrase this install did not create, or a wallet database was lost. */
  | 'required'
  /** An earlier build's run that started and never recorded its end. */
  | 'interrupted'
  /** A run that failed. */
  | 'failed'
  /** Restored, or not needed because this install created the phrase. */
  | 'settled';

function restorePhase(status: RestoreStatus): RestorePhase {
  switch (status) {
    case 'unknown':
      return 'undecided';
    case 'pending':
      return 'required';
    case 'in-progress':
      return 'interrupted';
    case 'failed':
      return 'failed';
    case 'complete':
    case 'not-needed':
      return 'settled';
    default:
      return unknownStatus(status);
  }
}

/** Unreachable by type; at run time read as the schema reads an unknown status. */
function unknownStatus(_status: never): RestorePhase {
  return 'undecided';
}

/**
 * The questions the app asks, one row per phase. They are different questions
 * and their answers differ on purpose; where two readers of one phase could
 * be thought to ask the same thing, the column says which each asks.
 */
const ANSWERS: {
  [K in RestorePhase]: {
    /** The deterministic counters are known: minting and receiving may run. */
    safeToMint: boolean;
    /** The recovery screen holds the app for it (and nothing should ask again). */
    asked: boolean;
    /** The gate decides it afresh from the keychain and the seed marker. */
    needsDecision: boolean;
    /** A restore has been decided and not run: prompts wait for it. */
    pending: boolean;
  };
} = {
  undecided: { safeToMint: false, asked: false, needsDecision: true, pending: false },
  required: { safeToMint: false, asked: true, needsDecision: false, pending: true },
  interrupted: { safeToMint: false, asked: false, needsDecision: true, pending: false },
  failed: { safeToMint: false, asked: true, needsDecision: true, pending: false },
  settled: { safeToMint: true, asked: false, needsDecision: false, pending: false },
};

const answers = (status: RestoreStatus) => ANSWERS[restorePhase(status)];

/** Restored or not needed: the processors and every receive may run. */
export function isSafeToMint(status: RestoreStatus): boolean {
  return answers(status).safeToMint;
}

/**
 * The restore gate shows the recovery screen for it: required, or a failed
 * run. The prompt host holds its queue, and a lost wallet database does not
 * ask again over it.
 */
export function isRestoreAsked(status: RestoreStatus): boolean {
  return answers(status).asked;
}

/** The restore gate reads the keychain and decides afresh: nothing decided, or an older build's run. */
export function needsRestoreDecision(status: RestoreStatus): boolean {
  return answers(status).needsDecision;
}

/**
 * A restore is required and has not run. What the prompts wait for; unlike
 * `isRestoreAsked`, a failed run does not hold them (the host does).
 */
export function isRestorePending(status: RestoreStatus): boolean {
  return answers(status).pending;
}
