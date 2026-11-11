import { registerAccountScoped } from '@/shared/lib/account/accountRegistry';
import { verifyNip05 } from 'wallet';
import NDK, { NDKEvent, NDKSubscriptionCacheUsage } from '@nostr-dev-kit/ndk-mobile';
import { Result, ResultAsync, err, ok, type Result as ResultType } from 'neverthrow';
import { parseProfileMetadata, supersedes } from 'nostr';
import { withSkippedPersistWrites } from '@/shared/lib/cashu/profileScopedStorage';
import { nostrLog } from '@/shared/lib/logger';
import { buildNostrDataLayer } from '@/shared/lib/nostr/buildNostrDataLayer';
import type { PublishError, PublishResult } from '@/shared/lib/nostr/publish/types';
import {
  MAX_FUTURE_SEC,
  nextReplaceableCreatedAt,
  publishToRelaysRead,
  readForEdit,
} from '@/shared/lib/nostr/ownReplaceableEvent';
import { activePubkey, useProfileStore } from '@/shared/stores/global/profileStore';
import {
  OwnProfileSnapshotSchema,
  useOwnProfileMetadataStore,
  type OwnProfileSnapshot,
  type OwnProfilePatch,
} from '@/shared/stores/profile/ownProfileMetadataStore';

export function applyProfilePatch(
  base: Record<string, unknown>,
  patch: OwnProfilePatch
): Record<string, unknown> {
  const content = { ...base };
  if (patch.name !== undefined) {
    content.display_name = patch.name;
    if (!Object.hasOwn(base, 'name') || base.name === base.display_name) content.name = patch.name;
  }
  for (const field of ['picture', 'lud16', 'nip05', 'about'] as const) {
    const value = patch[field];
    if (value === null) delete content[field];
    else if (value !== undefined) content[field] = value;
  }
  return content;
}
/** Which of two kind-0 snapshots stands, by the rule relays apply. */
const standsOver = (a: OwnProfileSnapshot, b: OwnProfileSnapshot) =>
  supersedes(
    { created_at: a.createdAt, id: a.eventId },
    { created_at: b.createdAt, id: b.eventId }
  );

export function parseOwnProfileSnapshot(event: {
  content: string;
  created_at?: number;
  id: string;
}): OwnProfileSnapshot | null {
  const json = Result.fromThrowable((): unknown => JSON.parse(event.content))();
  if (json.isErr()) return null;
  const parsed = OwnProfileSnapshotSchema.safeParse({
    content: json.value,
    createdAt: event.created_at,
    eventId: event.id,
  });
  return parsed.success ? parsed.data : null;
}

/** Replace the confirmed full kind-0, including fields intentionally removed. */
export function ingestOwnProfileMetadata(
  snapshot: OwnProfileSnapshot,
  pubkey: string,
  accountIndex: number
): void {
  const profile = useProfileStore.getState().getActiveProfile();
  if (profile?.pubkey !== pubkey || profile.accountIndex !== accountIndex) return;
  const store = useOwnProfileMetadataStore.getState();
  if (store.latest && snapshot.createdAt < store.latest.createdAt) return;
  if (store.latest?.eventId === snapshot.eventId) {
    store.clearOptimistic(snapshot.eventId);
    return;
  }
  const metadata = parseProfileMetadata(JSON.stringify(snapshot.content)) ?? {};
  useProfileStore
    .getState()
    .updateProfileMetadata(accountIndex, metadata.displayName ?? metadata.name, metadata.picture);
  const cache = buildNostrDataLayer()?.cache;
  // The cache's ordinary ingestion is additive and preserves undefined fields.
  // A full confirmed own kind-0 must also remove the old avatar/name fields.
  cache?.profiles.delete(pubkey);
  cache?.ingestProfileMetadata({ [pubkey]: metadata }, Date.now(), 'relay');
  store.setLatest(snapshot);
  store.clearOptimistic(snapshot.eventId);
}

export type OwnProfileLoadResult =
  { status: 'found'; snapshot: OwnProfileSnapshot } | { status: 'absent' | 'unavailable' };

/**
 * The profile for the editor's fields, from the pool within three seconds.
 * Only actual relay EOSE can establish absence; SDK timeouts cannot. A save
 * does not build on this alone: it reads the account's relays in full first.
 */
export async function loadOwnProfileMetadata(
  ndk: NDK,
  pubkey: string
): Promise<OwnProfileLoadResult> {
  const remote = await ResultAsync.fromPromise(
    new Promise<OwnProfileLoadResult>((resolve) => {
      const subscription = ndk.subscribe(
        { kinds: [0], authors: [pubkey] },
        { cacheUsage: NDKSubscriptionCacheUsage.ONLY_RELAY, closeOnEose: false },
        undefined,
        false
      );
      let snapshot: OwnProfileSnapshot | null = null;
      let sawEvent = false;
      let settled = false;
      const complete = () =>
        !!subscription.relayFilters?.size &&
        [...subscription.relayFilters.keys()].every((url) =>
          [...subscription.eosesSeen].some((relay) => relay.url === url)
        );
      const finish = (failed = false) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        subscription.stop();
        resolve(
          snapshot
            ? { status: 'found', snapshot }
            : {
                status: !failed && !sawEvent && complete() ? 'absent' : 'unavailable',
              }
        );
      };
      const timer = setTimeout(finish, 3000);
      subscription.on('event', (event: NDKEvent) => {
        if (settled) return;
        sawEvent = true;
        const parsed =
          event.pubkey === pubkey && event.kind === 0 ? parseOwnProfileSnapshot(event) : null;
        if (parsed && (!snapshot || standsOver(parsed, snapshot))) snapshot = parsed;
      });
      subscription.on('eose', () => {
        if (complete()) finish();
      });
      void ResultAsync.fromPromise(
        Promise.resolve().then(() => subscription.start()),
        () => null
      ).mapErr(() => finish(true));
    }),
    () => null
  ).unwrapOr({ status: 'unavailable' } as const);
  const latest = activePubkey() === pubkey ? useOwnProfileMetadataStore.getState().latest : null;
  if (latest && (remote.status !== 'found' || standsOver(latest, remote.snapshot)))
    return { status: 'found', snapshot: latest };
  return remote;
}

type OwnProfilePublishError =
  | (PublishError & { cause?: unknown })
  | {
      type: 'profile-changed' | 'base-unavailable' | 'unexpected' | 'nip05-unverified';
      cause?: unknown;
    };
const inFlight = new Map<string, ResultAsync<PublishResult, OwnProfilePublishError>>();

export function publishOwnProfileMetadata({
  ndk,
  pubkey,
  accountIndex,
  patch,
  initialLoad,
}: {
  ndk: NDK;
  pubkey: string;
  accountIndex: number;
  patch: OwnProfilePatch;
  initialLoad: OwnProfileLoadResult;
}): ResultAsync<PublishResult, OwnProfilePublishError> {
  const existing = inFlight.get(pubkey);
  if (existing) return existing;
  let eventId: string | undefined;
  let changed = false;
  const isOwner = () =>
    !changed &&
    activePubkey() === pubkey &&
    useProfileStore.getState().getActiveProfile()?.accountIndex === accountIndex;
  const unsubscribe = useProfileStore.subscribe(() => {
    if (!isOwner()) {
      changed = true;
      if (eventId)
        withSkippedPersistWrites(() =>
          useOwnProfileMetadataStore.getState().clearOptimistic(eventId!)
        );
    }
  });
  const run = async (): Promise<ResultType<PublishResult, OwnProfilePublishError>> => {
    const signer = ndk.signer;
    if (!signer) return err({ type: 'no-signer' });
    const signerUser = await ResultAsync.fromPromise(
      signer.user(),
      (cause): OwnProfilePublishError => ({ type: 'sign-failed', cause })
    );
    if (signerUser.isErr()) return err(signerUser.error);
    if (!isOwner() || signerUser.value.pubkey !== pubkey || ndk.signer !== signer)
      return err({ type: 'profile-changed' });
    // Build only on a complete read of the account's relays (a relay silent
    // read after read left out), as for every own list; anything less waits.
    const read = await readForEdit(ndk, pubkey, 0);
    if (!isOwner() || ndk.signer !== signer) return err({ type: 'profile-changed' });
    if (read.status === 'waiting') return err({ type: 'base-unavailable' });
    const remote = read.newest ? parseOwnProfileSnapshot(read.newest) : null;
    if (read.newest && !remote) return err({ type: 'base-unavailable' });
    // The newest of what the relays read hold, what this device last confirmed
    // and what the editor opened on: the save never builds on an older one.
    const latest = useOwnProfileMetadataStore.getState().latest;
    const base = [remote, latest, initialLoad.status === 'found' ? initialLoad.snapshot : null]
      .filter((snapshot): snapshot is OwnProfileSnapshot => snapshot !== null)
      .reduce<OwnProfileSnapshot | null>(
        (newest, snapshot) => (!newest || standsOver(snapshot, newest) ? snapshot : newest),
        null
      );
    // Relay sync can learn a newer base while identity verification or signing
    // awaits. Stop this save and let a retry read and patch that base afresh.
    const baseIsCurrent = () => {
      const known = useOwnProfileMetadataStore.getState().latest;
      return !known || (base !== null && !standsOver(known, base));
    };
    const profile = useProfileStore.getState().getActiveProfile();
    if (
      !base &&
      (initialLoad.status !== 'absent' ||
        profile?.cachedDisplayName !== undefined ||
        profile?.cachedPicture !== undefined)
    )
      return err({ type: 'base-unavailable' });
    const event = new NDKEvent(ndk);
    event.kind = 0;
    event.pubkey = pubkey;
    const nowSeconds = Math.floor(Date.now() / 1000);
    event.created_at = nextReplaceableCreatedAt(base?.createdAt, nowSeconds);
    // A base dated ahead is still superseded by +1 (and logged): refusing it
    // would make every later edit unpublishable.
    if (base && base.createdAt > nowSeconds + MAX_FUTURE_SEC)
      nostrLog.warn('nostr.profile.publish.clock_skew', {
        deltaSeconds: base.createdAt - nowSeconds,
      });
    const content = applyProfilePatch(base?.content ?? {}, patch);
    // UI/cache status cannot authorize a changed identity. Verify the exact
    // claim and signing key afresh before creating any signed/public event.
    if (patch.nip05) {
      const verification = await verifyNip05(patch.nip05, pubkey);
      if (!isOwner() || ndk.signer !== signer) return err({ type: 'profile-changed' });
      if (verification.status !== 'verified') return err({ type: 'nip05-unverified' });
      content.nip05 = verification.identifier;
    }
    if (!baseIsCurrent()) return err({ type: 'base-unavailable' });
    event.content = JSON.stringify(content);
    event.tags = [];
    const signed = await ResultAsync.fromPromise(
      event.sign(signer),
      (cause): OwnProfilePublishError => ({ type: 'sign-failed', cause })
    );
    if (signed.isErr()) return err(signed.error);
    if (!isOwner() || event.pubkey !== pubkey || ndk.signer !== signer)
      return err({ type: 'profile-changed' });
    if (!baseIsCurrent()) return err({ type: 'base-unavailable' });
    eventId = event.id;
    useOwnProfileMetadataStore
      .getState()
      .setOptimistic({ ...patch, createdAt: event.created_at, eventId });
    nostrLog.info('nostr.profile.publish.start', {
      hasPicture: !!content.picture,
      nameChanged:
        patch.name !== undefined &&
        patch.name !== (base?.content.display_name ?? base?.content.name),
    });
    // Exactly the relays read: one that was not read may hold a newer profile.
    const result = await publishToRelaysRead(ndk, event, read.relays, 'optimistic');
    if (!isOwner() || ndk.signer !== signer) return err({ type: 'profile-changed' });
    if (result.isErr()) return err(result.error);
    if (isOwner())
      ingestOwnProfileMetadata(
        { content, createdAt: event.created_at, eventId },
        pubkey,
        accountIndex
      );
    nostrLog.info('nostr.profile.publish.ok', { accepted: result.value.accepted.length });
    return ok(result.value);
  };
  const result = ResultAsync.fromPromise(
    Promise.resolve().then(run),
    (cause): OwnProfilePublishError => ({ type: 'unexpected', cause })
  )
    .andThen((value) => value)
    .mapErr((error) => {
      nostrLog.warn('nostr.profile.publish.failed', { type: error.type });
      return error;
    });
  inFlight.set(pubkey, result);
  void result.then(() => {
    if (eventId && isOwner()) useOwnProfileMetadataStore.getState().clearOptimistic(eventId);
    unsubscribe();
    inFlight.delete(pubkey);
  });
  return result;
}

registerAccountScoped(
  'nostr.profile-publish-flights',
  () => {
    inFlight.clear();
  },
  () => inFlight.size === 0
);
