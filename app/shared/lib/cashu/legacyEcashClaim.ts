import AsyncStorage from '@react-native-async-storage/async-storage';
import { Amount } from '@cashu/cashu-ts';
import {
  normalizeMintUrl,
  ProofValidationError,
  UnknownMintError,
  type Manager,
} from '@cashu/coco-core';
import { z } from 'zod';
import {
  LegacyClaimFault,
  legacyEcashVerdict,
  readLegacyEcash,
  runLegacyEcashClaim,
  type LegacyClaimPorts,
  type LegacyEcashGroup,
  type LegacyEcashRead,
} from 'wallet';

import { legacyEcashMint } from '@/shared/lib/cashu/legacyEcashMint';
import { getStoredProofsBySecrets } from '@/shared/lib/cashu/managerInternals';
import { cashuLog } from '@/shared/lib/logger';
import { hydrationSettled } from '@/shared/lib/persist/hydrationOutcome';
import { REDUX_ERA_ROW } from '@/shared/lib/nostr/reduxEraRoot';
import { retrieveMnemonic } from '@/shared/lib/nostr/secureStorage';
import {
  legacyEcashRecordsSaved,
  useLegacyEcashStore,
} from '@/shared/stores/global/legacyEcashStore';
import { useProfileStore } from '@/shared/stores/global/profileStore';

/**
 * Claims the ecash of the redux-era row into the open wallet, then removes the
 * row once nothing in it is owed to the person any more. See ADR 0032.
 *
 * Runs after the wallet's own recovery sweeps, in the background. A launch
 * with no row makes no request and touches nothing.
 */

type ReadRow = Extract<LegacyEcashRead, { kind: 'read' }>;

/**
 * The account an old profile's ecash is claimed into.
 *
 * Old profiles each stored their own phrase, so "profile 2 is account 2" is
 * not certain. A profile whose public key is an account on this phone goes to
 * that account, which is also where releases 0.0.58 to 0.1.1 imported it.
 * Anything else goes to account 0, or to the lowest account when account 0
 * was removed. That is safe because these are bearer proofs: they are swapped
 * for new ones the receiving wallet derives, and every account on the phone
 * belongs to the same person.
 *
 * Worked out from the profile list on every run, never from what an earlier
 * run stored, so a group cannot be left waiting for an account that is gone.
 */
function targetAccount(group: LegacyEcashGroup): number {
  const { profiles } = useProfileStore.getState();
  const match = profiles.find((profile) => profile.pubkey === group.profilePubkeyHex);
  if (match) return match.accountIndex;
  return profiles.reduce((lowest, profile) => Math.min(lowest, profile.accountIndex), Infinity);
}

function walletPort(manager: Manager): LegacyClaimPorts['wallet'] {
  const receive = manager.ops.receive;
  return {
    isTrusted: (mintUrl) => manager.mint.isTrustedMint(normalizeMintUrl(mintUrl)),

    async heldSecrets(mintUrl, proofSecrets) {
      if (proofSecrets.length === 0) return new Set();
      const stored = await getStoredProofsBySecrets(
        manager,
        normalizeMintUrl(mintUrl),
        proofSecrets
      );
      // A copy the wallet has marked spent is not money it holds; the mint decides that one.
      return new Set(
        stored.filter((proof) => proof.state !== 'spent').map((proof) => proof.secret)
      );
    },

    async prepareReceive(mintUrl, unit, proofs) {
      try {
        const prepared = await receive.prepare({
          token: {
            mint: normalizeMintUrl(mintUrl),
            unit,
            // The DLEQ and witness the old app stored are left behind: the mint
            // checks its own signature, and a stale one would only fail the receive.
            proofs: proofs.map(({ id, amount, secret, C }) => ({
              id,
              secret,
              C,
              amount: Amount.from(amount),
            })),
          },
        });
        return prepared.id;
      } catch (error) {
        if (error instanceof ProofValidationError) {
          throw new LegacyClaimFault('wallet-refused', { cause: error });
        }
        // Trust was withdrawn between the check and the receive. Asked again next launch.
        if (error instanceof UnknownMintError)
          throw new LegacyClaimFault('transient', { cause: error });
        throw error;
      }
    },

    async executeReceive(operationId) {
      await receive.execute(operationId);
    },

    async receiveState(operationId) {
      let operation = await receive.get(operationId);
      // Coco finishes or rolls back an interrupted receive when asked to look at it.
      if (operation?.state === 'executing') operation = await receive.refresh(operationId);
      if (!operation) return 'missing';
      if (operation.state === 'finalized' || operation.state === 'executing')
        return operation.state;
      return operation.state === 'rolled_back' ? 'rolled-back' : 'prepared';
    },

    cancelReceive: (operationId) => receive.cancel(operationId, 'Old ecash claim restarted'),
  };
}

const RowWithNostr = z.object({ nostr: z.string() });
const NostrSlice = z.object({
  currentProfile: z.unknown().optional(),
  profiles: z.array(z.unknown()),
});

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/**
 * Every phrase the row holds, exactly as stored, or null when that cannot be
 * told. Old profiles each carried their own, so one row can hold several.
 */
function reduxEraPhrases(raw: string): string[] | null {
  const row = RowWithNostr.safeParse(parseJson(raw));
  if (!row.success) return null;
  const nostr = NostrSlice.safeParse(parseJson(row.data.nostr));
  if (!nostr.success) return null;
  const phrases = new Set<string>();
  for (const profile of [nostr.data.currentProfile, ...nostr.data.profiles]) {
    if (typeof profile !== 'object' || profile === null) continue;
    const mnemonic: unknown = Reflect.get(profile, 'mnemonic');
    if (mnemonic === undefined || mnemonic === null || mnemonic === '') continue;
    // Something is stored where a phrase goes and it is not text.
    if (typeof mnemonic !== 'string') return null;
    phrases.add(mnemonic);
  }
  return [...phrases];
}

/**
 * Removes the row when it is spent: every proof is in a wallet or was spent,
 * no old invoice has ecash waiting, and the only phrase in it is the one this
 * phone already keeps in SecureStore. Otherwise the row stays as it is.
 */
async function removeRowIfSpent(raw: string, read: ReadRow, isLive: () => boolean): Promise<void> {
  const store = useLegacyEcashStore.getState();
  const verdict = legacyEcashVerdict(read, store);
  if (!verdict.rowIsSpent) return;

  const phrases = reduxEraPhrases(raw);
  const stored = await retrieveMnemonic();
  if (!isLive()) return;
  const phraseIsKept =
    phrases !== null && phrases.length > 0 && phrases.every((phrase) => phrase === stored);
  if (!phraseIsKept) {
    cashuLog.info('cashu.legacy_ecash.row_kept_for_phrase', { phrases: phrases?.length ?? null });
    return;
  }

  await AsyncStorage.removeItem(REDUX_ERA_ROW);
  if (!isLive()) return;
  store.markRowRemoved({
    at: Date.now(),
    groups: read.groups.length,
    claimed: verdict.claimed,
    spent: verdict.spent,
    inWallet: verdict.inWallet,
  });
  cashuLog.info('cashu.legacy_ecash.row_removed', { groups: read.groups.length });
}

async function claimOnce(manager: Manager, isLive: () => boolean): Promise<void> {
  const raw = await AsyncStorage.getItem(REDUX_ERA_ROW);
  if (raw === null) return;
  const read = readLegacyEcash(raw);
  if (read.kind !== 'read') {
    cashuLog.warn('cashu.legacy_ecash.row_unreadable');
    return;
  }

  // Without the records there is no telling what was already tried, and
  // without the profiles no telling whose ecash this is.
  const loaded = await Promise.all([
    hydrationSettled(useLegacyEcashStore),
    hydrationSettled(useProfileStore),
  ]);
  if (loaded.includes(false) || !isLive()) return;

  const { profiles } = useProfileStore.getState();
  // No account is listed while an account change is half done. Wait for the next launch.
  if (profiles.length === 0) return;

  const write = async (apply: () => void) => {
    // Delete-all closes the wallet before it clears storage. A write after
    // that would put this store back on a phone that was just wiped.
    if (!isLive()) throw new Error('The wallet this claim started with is closed');
    apply();
    await legacyEcashRecordsSaved();
  };
  await runLegacyEcashClaim(read, {
    nowMs: Date.now(),
    accountIndex: useProfileStore.getState().activeAccountIndex,
    accounts: profiles.map((profile) => profile.accountIndex),
    targetAccount,
    isLive,
    records: {
      read: () => useLegacyEcashStore.getState(),
      writeGroup: (id, record) =>
        write(() => useLegacyEcashStore.getState().writeGroup(id, record)),
      writeQuote: (id, record) =>
        write(() => useLegacyEcashStore.getState().writeQuote(id, record)),
    },
    mint: legacyEcashMint,
    wallet: walletPort(manager),
  });
  if (!isLive()) return;

  const { groups } = useLegacyEcashStore.getState();
  cashuLog.info('cashu.legacy_ecash.pass_done', {
    groups: read.groups.length,
    skipped: read.skipped,
    mintQuotes: read.mintQuotes.length,
    settled: read.groups.filter((group) => groups[group.id]?.status === 'settled').length,
  });
  await removeRowIfSpent(raw, read, isLive);
}

interface Session {
  running: Promise<void> | null;
  /** A mint was trusted while a pass was running; one more pass follows it. */
  again: boolean;
}
const sessions = new WeakMap<Manager, Session>();

/**
 * One pass for the open wallet. Calls made while a pass is running share it,
 * so no two passes ever talk to a mint at once. Never rejects.
 */
export function claimLegacyEcash(manager: Manager, isLive: () => boolean): Promise<void> {
  let session = sessions.get(manager);
  if (!session) {
    session = { running: null, again: false };
    sessions.set(manager, session);
  }
  const current = session;
  if (current.running) {
    current.again = true;
    return current.running;
  }
  current.running = (async () => {
    try {
      do {
        current.again = false;
        await claimOnce(manager, isLive);
      } while (current.again && isLive());
    } catch (error) {
      cashuLog.error('cashu.legacy_ecash.pass_failed', { error });
    } finally {
      current.running = null;
    }
  })();
  return current.running;
}

/**
 * Runs the first pass, then one more whenever a mint becomes trusted, which is
 * how accepting the "trust this mint" prompt turns into a claim. The listeners
 * live as long as the wallet they are attached to. Never rejects.
 */
export async function startLegacyEcashClaim(
  manager: Manager,
  isLive: () => boolean
): Promise<void> {
  await claimLegacyEcash(manager, isLive);
  try {
    if (!isLive() || (await AsyncStorage.getItem(REDUX_ERA_ROW)) === null) return;
  } catch (error) {
    cashuLog.error('cashu.legacy_ecash.pass_failed', { error });
    return;
  }
  const listeners: (() => void)[] = [];
  const onTrustChanged = () => {
    if (!isLive()) {
      for (const stop of listeners.splice(0)) stop();
      return;
    }
    void claimLegacyEcash(manager, isLive);
  };
  listeners.push(
    manager.on('mint:added', onTrustChanged),
    manager.on('mint:trusted', onTrustChanged)
  );
}
