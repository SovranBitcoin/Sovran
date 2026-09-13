import NDK, { NDKEvent } from '@nostr-dev-kit/ndk-mobile';
import { Result, ResultAsync, err, ok, type Result as ResultType } from 'neverthrow';
import { parseProfileMetadata } from 'nostr';
import { withSkippedPersistWrites } from '@/shared/lib/cashu/profileScopedStorage';
import { nostrLog } from '@/shared/lib/logger';
import { buildNostrDataLayer } from '@/shared/lib/nostr/buildNostrDataLayer';
import { publishEvent } from '@/shared/lib/nostr/publish/publishEvent';
import type { PublishError, PublishResult } from '@/shared/lib/nostr/publish/types';
import { getOwnWriteRelays } from '@/shared/lib/nostr/outbox/relayListStore';
import { resolveWriteRelays } from '@/shared/lib/nostr/outbox/resolveWriteRelays';
import { useProfileStore } from '@/shared/stores/global/profileStore';
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
  if (patch.picture === null) delete content.picture;
  else if (patch.picture !== undefined) content.picture = patch.picture;
  return content;
}
export const nextProfileCreatedAt = (
  baseCreatedAt = 0,
  nowSeconds = Math.floor(Date.now() / 1000)
) => Math.max(nowSeconds, baseCreatedAt + 1);

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

/** Relay-direct merge base, bounded even if NDK never completes its fetch. */
export async function loadOwnProfileMetadata(
  ndk: NDK,
  pubkey: string
): Promise<OwnProfileSnapshot | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const remote = await Promise.race([
    ResultAsync.fromPromise(
      Promise.resolve().then(() => ndk.fetchEvent({ kinds: [0], authors: [pubkey] })),
      () => null
    ).match(
      (event) => (event?.pubkey === pubkey ? parseOwnProfileSnapshot(event) : null),
      () => null
    ),
    new Promise<null>((resolve) => {
      timer = setTimeout(() => resolve(null), 3000);
    }),
  ]);
  clearTimeout(timer);
  const latest =
    useProfileStore.getState().getActiveProfile()?.pubkey === pubkey
      ? useOwnProfileMetadataStore.getState().latest
      : null;
  return remote && (!latest || remote.createdAt > latest.createdAt) ? remote : latest;
}

export type OwnProfilePublishError =
  | (PublishError & { cause?: unknown })
  | { type: 'profile-changed' | 'unexpected'; cause?: unknown };
const inFlight = new Map<string, ResultAsync<PublishResult, OwnProfilePublishError>>();

export function publishOwnProfileMetadata({
  ndk,
  pubkey,
  accountIndex,
  patch,
}: {
  ndk: NDK;
  pubkey: string;
  accountIndex: number;
  patch: OwnProfilePatch;
}): ResultAsync<PublishResult, OwnProfilePublishError> {
  const existing = inFlight.get(pubkey);
  if (existing) return existing;
  let eventId: string | undefined;
  let changed = false;
  const isOwner = () =>
    !changed && useProfileStore.getState().getActiveProfile()?.pubkey === pubkey;
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
    const base = await loadOwnProfileMetadata(ndk, pubkey);
    if (!isOwner()) return err({ type: 'profile-changed' });
    const event = new NDKEvent(ndk);
    event.kind = 0;
    event.pubkey = pubkey;
    event.created_at = nextProfileCreatedAt(base?.createdAt);
    const content = applyProfilePatch(base?.content ?? {}, patch);
    event.content = JSON.stringify(content);
    event.tags = [];
    const signed = await ResultAsync.fromPromise(
      event.sign(signer),
      (cause): OwnProfilePublishError => ({ type: 'sign-failed', cause })
    );
    if (signed.isErr()) return err(signed.error);
    if (!isOwner() || event.pubkey !== pubkey || ndk.signer !== signer)
      return err({ type: 'profile-changed' });
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
    const result = await publishEvent({
      ndk,
      event,
      relays: resolveWriteRelays({ ownWriteRelays: getOwnWriteRelays() }),
      resolveOn: 'optimistic',
    });
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
