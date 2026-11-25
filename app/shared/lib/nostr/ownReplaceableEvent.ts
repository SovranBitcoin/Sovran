/**
 * Reading and replacing one of the account's own replaceable events (the
 * follow list, the mute list, the profile, the relay list) without losing
 * what another client wrote. One rule for all of them: read the newest signed
 * copy from every relay of the account (`readForEdit`), leaving out one that
 * has stopped answering; change it; date the change after the event it
 * replaces and sign it with the account's own signer (`signReplacement`);
 * send it to exactly the relays read (`publishToRelaysRead`). A read that
 * could not be completed is waiting, never a base to publish on. The account
 * and its signer are held fixed across each wait so a switch never writes to
 * the wrong account.
 */
import { errAsync } from 'neverthrow';
import { supersedes } from 'nostr';
import type { NostrClient, NostrSigner, RelaySubscriptionHandle } from 'nostr/client';
import { getEventHash, verifyEvent, type VerifiedEvent } from 'nostr-tools/pure';
import { nostrLog } from '@/shared/lib/logger';
import { publishEvent } from '@/shared/lib/nostr/publish';
import type { PublishOptions } from '@/shared/lib/nostr/publish/types';
import { getKnownOwnWriteRelays, getOwnWriteRelays } from './outbox/relayListStore';

const READ_TIMEOUT_MS = 12_000;

/** Signed by `pubkey`, of `kind`, with an id and signature that verify. */
export function validOwnEvent(event: VerifiedEvent, pubkey: string, kind: number): boolean {
  try {
    return (
      event.kind === kind &&
      event.pubkey === pubkey &&
      Number.isSafeInteger(event.created_at) &&
      event.created_at >= 0 &&
      event.id === getEventHash(event) &&
      verifyEvent(event)
    );
  } catch {
    return false;
  }
}

export async function matchingSigner(client: NostrClient, pubkey: string) {
  const signer = client.signer;
  if (!signer || signer.pubkey !== pubkey) throw new Error('Account signer is not ready');
  return signer;
}

/**
 * How far ahead of this device's clock an own event may be dated and still
 * be built on. One dated further ahead is not a base for an edit: ours would
 * be dated there too, and relays would keep it over every later one.
 */
export const MAX_FUTURE_SEC = 60;

/** Now, or one second past a later-dated base: relays keep the newer replaceable event. */
export const nextReplaceableCreatedAt = (base = 0, now = Math.floor(Date.now() / 1000)) =>
  Math.max(now, base + 1);

/** Sign an own event with its pinned signer; refuse it if the account or signer changed meanwhile. */
export async function signOwnEvent(
  client: NostrClient,
  signer: NostrSigner,
  scope: { check: () => void },
  fields: { kind: number; pubkey: string; created_at?: number; tags: string[][]; content: string }
): Promise<VerifiedEvent> {
  // Signing dates an event that was not dated.
  const event = signer.sign(fields);
  scope.check();
  if (event.pubkey !== fields.pubkey || client.signer !== signer)
    throw new Error('Account signer changed');
  return event;
}

/**
 * How a read ended. Only `complete` means every relay waited for answered, so
 * only then does a missing `newest` say the relays hold no such list.
 */
export type OwnEventReadOutcome = 'complete' | 'timed-out' | 'failed' | 'no-relays';

type OwnEventRead = {
  outcome: OwnEventReadOutcome;
  /** The newest valid event any relay returned, also when the read did not complete. */
  newest: VerifiedEvent | undefined;
  /**
   * The relays that answered: on `complete`, every relay asked except those
   * left out as silent. Only these may receive an event built on the read.
   */
  relays: string[];
  /** Every relay the read was for, those left out included. */
  asked: string[];
  /** The relays waited for that had not answered when the read ended. */
  silent: string[];
};

/**
 * A relay that did not answer this many reads in a row is left out of the
 * next reads for this session, until it answers one of them: a read then
 * counts as complete without it, and what is built on that read is never
 * sent to it. The cost, accepted by the owner: a newer list that only that
 * relay holds is overruled.
 */
export const SILENT_READS_BEFORE_LEFT_OUT = 3;

/** Logical ordering includes starts and answers, independent of clock precision. */
let readOrder = 0;
const silence = new Map<string, { reads: number; settledOrder: number }>();

const silentReads = (url: string) => silence.get(url)?.reads ?? 0;
const isLeftOut = (url: string) => silentReads(url) >= SILENT_READS_BEFORE_LEFT_OUT;

/** The relay answered (also "I hold nothing"): it is read and written again. */
function heardFrom(url: string) {
  if (isLeftOut(url)) nostrLog.info('nostr.relays.answering_again', { relay: url });
  silence.set(url, { reads: 0, settledOrder: ++readOrder });
}

/**
 * A read that began at `startedOrder` ended without the relay's answer. One that
 * overlapped a read already counted adds nothing: reads at the same moment
 * are one outage, not several reads in a row.
 */
function notHeardFrom(url: string, startedOrder: number) {
  const last = silence.get(url);
  if (last && last.settledOrder > startedOrder) return;
  const reads = (last?.reads ?? 0) + 1;
  silence.set(url, { reads, settledOrder: ++readOrder });
  if (reads === SILENT_READS_BEFORE_LEFT_OUT)
    nostrLog.warn('nostr.relays.left_out', { relay: url, silentReads: reads });
}

/** This session's record of silent relays starts again (a new session, a test). */
export function forgetSilentRelays() {
  silence.clear();
}

/**
 * Whether reading again can complete where `read` did not: a relay it waited
 * for did not answer and has not yet been silent long enough to be left out.
 * Stop after the exclusion threshold plus one attempt even when alternating
 * answers keep resetting each relay: an edit must eventually return waiting.
 */
export function worthReadingAgain(read: OwnEventRead, attempts = 1): boolean {
  return (
    attempts < SILENT_READS_BEFORE_LEFT_OUT + 1 &&
    read.outcome === 'timed-out' &&
    read.silent.some((url) => silentReads(url) <= SILENT_READS_BEFORE_LEFT_OUT)
  );
}

/**
 * Newest valid own event of `kind` across `relays` (the write relays unless
 * named), waiting for each relay's answer. The device cache is never read.
 *
 * With `leaveOutSilent`, a relay left out as silent is still asked, as a
 * probe, but not waited for: its answer counts only if it comes before the
 * others', and any answer brings it back for the next read. When every relay
 * is silent there is nothing to read without them, so all are waited for.
 */
export async function readNewestOwnEvent(
  client: NostrClient,
  pubkey: string,
  kind: number,
  options: { relays?: readonly string[]; leaveOutSilent?: boolean } = {}
): Promise<OwnEventRead> {
  const relayUrls = [...new Set(options.relays ?? getOwnWriteRelays())];
  if (relayUrls.length === 0)
    return { outcome: 'no-relays', newest: undefined, relays: [], asked: [], silent: [] };
  const leftOut = options.leaveOutSilent ? relayUrls.filter(isLeftOut) : [];
  const probes = new Set(leftOut.length < relayUrls.length ? leftOut : []);
  if (probes.size > 0) nostrLog.info('nostr.own_event.read_without', { kind, relays: [...probes] });
  const startedOrder = ++readOrder;
  return new Promise<OwnEventRead>((resolve) => {
    let newest: VerifiedEvent | undefined;
    let settled = false;
    const answered = new Set<string>();
    const pending = new Set(relayUrls.filter((url) => !probes.has(url)));
    const waitedFor: RelaySubscriptionHandle[] = [];
    const probing = new Map<string, RelaySubscriptionHandle>();
    const offer = (event: VerifiedEvent) => {
      if (!newest || supersedes(event, newest)) newest = event;
    };
    const stopProbe = (url: string) => {
      probing.get(url)?.stop();
      probing.delete(url);
      if (probing.size === 0) clearTimeout(probeTimer);
    };
    const finish = (outcome: OwnEventReadOutcome) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      for (const subscription of waitedFor) subscription.stop();
      if (outcome === 'timed-out') for (const url of pending) notHeardFrom(url, startedOrder);
      resolve({
        outcome,
        newest,
        relays: relayUrls.filter((url) => answered.has(url)),
        asked: relayUrls,
        silent: outcome === 'timed-out' ? [...pending] : [],
      });
    };
    const timer = setTimeout(() => finish('timed-out'), READ_TIMEOUT_MS);
    // A probe is given as long as a read waits, also after the read is over.
    const probeTimer =
      probes.size > 0
        ? setTimeout(() => [...probing.keys()].forEach(stopProbe), READ_TIMEOUT_MS)
        : undefined;
    // Relays whose socket failed after the request was made: silent for this read.
    const dropped = new Set<string>();
    try {
      for (const url of relayUrls) {
        if (settled) break;
        const probe = probes.has(url);
        // A probe's events count only once it has answered in full.
        const held: VerifiedEvent[] = [];
        let subscribing = true;
        // One subscription per relay: a replaceable list can only be edited
        // safely on every relay's own EOSE.
        const subscription = client.subscribeRelay(url, [{ kinds: [kind], authors: [pubkey] }], {
          onEvent: (event) => {
            if (settled || !validOwnEvent(event, pubkey, kind)) return;
            if (probe) held.push(event);
            else offer(event);
          },
          onEose: () => {
            heardFrom(url);
            if (probe) stopProbe(url);
            if (settled) return;
            held.forEach(offer);
            answered.add(url);
            pending.delete(url);
            if (pending.size === 0) finish('complete');
          },
          onError: () => {
            if (probe) return stopProbe(url);
            if (settled) return;
            // The request could not be made at all: the read fails.
            if (subscribing) {
              notHeardFrom(url, startedOrder);
              return finish('failed');
            }
            // A dropped socket will not answer this read: once every relay
            // still waited for has dropped, end it as their silence would.
            dropped.add(url);
            if ([...pending].every((waiting) => dropped.has(waiting))) finish('timed-out');
          },
        });
        subscribing = false;
        if (settled && !probe) subscription.stop();
        else if (probe) probing.set(url, subscription);
        else waitedFor.push(subscription);
      }
    } catch {
      finish('failed');
    }
  });
}

/** The base an edit of an own event stands on, or why the edit waits. */
export type ReadForEdit =
  | { status: 'waiting'; reason: 'relay-list-unknown' | Exclude<OwnEventReadOutcome, 'complete'> }
  | { status: 'read'; newest: VerifiedEvent | undefined; relays: string[]; asked: string[] };

/**
 * Read the newest own event of `kind` to build an edit on: only once this
 * session knows the account's relays (`relays`, by default its known write
 * relays), and only from a complete read of them, a relay silent for
 * `SILENT_READS_BEFORE_LEFT_OUT` reads in a row left out. A silent relay is
 * read again at once until that is decided.
 */
export async function readForEdit(
  client: NostrClient,
  pubkey: string,
  kind: number,
  relays: readonly string[] | null = getKnownOwnWriteRelays(pubkey)
): Promise<ReadForEdit> {
  if (!relays) return { status: 'waiting', reason: 'relay-list-unknown' };
  let read: OwnEventRead;
  let attempts = 0;
  do {
    read = await readNewestOwnEvent(client, pubkey, kind, { relays, leaveOutSilent: true });
    attempts++;
  } while (worthReadingAgain(read, attempts));
  if (read.outcome !== 'complete') return { status: 'waiting', reason: read.outcome };
  return { status: 'read', newest: read.newest, relays: read.relays, asked: read.asked };
}

/**
 * Sign a replacement for the event dated `replaces`: dated now, or one second
 * past it when that is later (relays keep the newer one), signed by the
 * pinned signer and refused before and after signing if the account or the
 * signer changed.
 */
export function signReplacement(
  client: NostrClient,
  signer: NostrSigner,
  scope: { check: () => void },
  fields: { kind: number; pubkey: string; replaces?: number; tags: string[][]; content: string }
) {
  const { replaces, ...event } = fields;
  if (client.signer !== signer) return Promise.reject(new Error('Account signer changed'));
  return signOwnEvent(client, signer, scope, {
    ...event,
    created_at: nextReplaceableCreatedAt(replaces),
  });
}

/**
 * Send a replacement to exactly the relays its base was read from: a relay
 * that was not read may hold a newer copy, and this one would replace it
 * there. Never to no relay, which `publishEvent` would read as every relay in
 * the pool.
 */
export function publishToRelaysRead(
  client: NostrClient,
  event: VerifiedEvent,
  relays: readonly string[],
  resolveOn: PublishOptions['resolveOn'] = 'all-settled'
) {
  if (relays.length === 0) return errAsync({ type: 'no-relays' } as const);
  return publishEvent({ client, event, relays: [...relays], resolveOn });
}
