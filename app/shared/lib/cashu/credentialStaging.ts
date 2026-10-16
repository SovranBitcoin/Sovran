/**
 * The credentials the next wallet will be opened with.
 *
 * Two providers stage them at different moments: the key provider stages the
 * account and the wallet phrase, the wallet provider stages the signer key.
 * The wallet manager captures them all at once when it starts opening a wallet.
 * Its on-demand signer lookup, used by background sync, still reads the live
 * values.
 *
 * The complication is overlap. A provider can unmount, and its wallet start
 * closing, while the next provider is already staging credentials for another
 * account. The closing wallet must clear what it leaves behind without wiping
 * what the next one has just staged, and the next one must not inherit a
 * credential it did not stage. So every credential carries a revision, and a
 * clear only touches credentials whose revision has not moved since the
 * snapshot the caller took.
 */
interface StagedCredentials {
  accountIndex: number;
  /** An imported key rather than one derived from the root phrase. */
  isImported: boolean;
  /** Null means: derive it from the root phrase and the account. */
  cashuMnemonic: string | null;
  /** Null means: no signer key was handed over; derive or load it on demand. */
  signerKey: Uint8Array | null;
}

/** One counter per credential that can be replaced on its own. */
interface StagingRevisions {
  account: number;
  cashuMnemonic: number;
  signerKey: number;
}

export function createCredentialStaging() {
  const staged: StagedCredentials = {
    accountIndex: 0,
    isImported: false,
    cashuMnemonic: null,
    signerKey: null,
  };
  const revisions: StagingRevisions = { account: 0, cashuMnemonic: 0, signerKey: 0 };

  return {
    stageAccount(accountIndex: number, isImported: boolean): void {
      staged.accountIndex = accountIndex;
      staged.isImported = isImported;
      revisions.account += 1;
    },
    stageWalletPhrase(cashuMnemonic: string): void {
      staged.cashuMnemonic = cashuMnemonic;
      revisions.cashuMnemonic += 1;
    },
    /** Keeps its own copy, so the caller's buffer can be zeroed. */
    stageSigner(signerKey: Uint8Array): void {
      staged.signerKey = new Uint8Array(signerKey);
      revisions.signerKey += 1;
    },

    /** What is staged right now. Read live: a later stage replaces it. */
    get accountIndex(): number {
      return staged.accountIndex;
    },
    get isImported(): boolean {
      return staged.isImported;
    },
    get cashuMnemonic(): string | null {
      return staged.cashuMnemonic;
    },
    get signerKey(): Uint8Array | null {
      return staged.signerKey;
    },

    /**
     * Everything one wallet is opened with, taken at a single moment. The
     * signer key is copied; later stages do not change what was captured.
     */
    capture(): StagedCredentials {
      return {
        ...staged,
        signerKey: staged.signerKey ? new Uint8Array(staged.signerKey) : null,
      };
    },

    /** Take this before work that will clear credentials when it finishes. */
    revisions(): StagingRevisions {
      return { ...revisions };
    },

    /**
     * Clear the phrase, the signer key and the imported flag. With `since`,
     * leave any of them that has been staged again after that snapshot. The
     * account index is never cleared: it names a database, not a secret.
     */
    clearUnchangedSince(since?: StagingRevisions): void {
      if (!since || since.signerKey === revisions.signerKey) staged.signerKey = null;
      if (!since || since.cashuMnemonic === revisions.cashuMnemonic) staged.cashuMnemonic = null;
      if (!since || since.account === revisions.account) staged.isImported = false;
    },
  };
}
