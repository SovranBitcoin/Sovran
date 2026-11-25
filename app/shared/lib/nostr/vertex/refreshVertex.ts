import { registerAccountScoped } from '@/shared/lib/account/accountRegistry';
import type NDK from '@nostr-dev-kit/ndk-mobile';
import { verifyEvent } from 'nostr-tools/pure';
import { facade, type NaggProfilesEnvelope } from 'nostr';
import { ResultAsync } from 'neverthrow';
import { activePubkey } from '@/shared/stores/global/profileStore';
import { useSettingsStore } from '@/shared/stores/global/settingsStore';
import { getVertexBudgetStore } from '@/shared/stores/profile/vertexBudgetStore';
import { nostrLog } from '@/shared/lib/logger';
import { whenLoaded } from '@/shared/lib/persist/hydrationOutcome';
import { signVertexRequest, vertexAutomationDisabled } from './signVertexRequest';

// In-memory only: never persist lookup targets or query text. Bound by the daily cap.
const attempted = new Map<string, Set<string>>();
const enabled = () =>
  useSettingsStore.getState().vertexCreditsEnabled && !vertexAutomationDisabled();

export function isVertexProfileStale(fetchedAt?: number | null): boolean {
  return fetchedAt == null || fetchedAt * 1000 <= Date.now() - 7 * 86_400_000;
}

export type DirectVertexSender = (
  signed: facade.SignedVertexRequest,
  options?: { signal?: AbortSignal; timeoutMs?: number }
) => Promise<facade.DirectVertexResponse>;

/** Consent, hydration, identity, dedup and budget have one owner for both surfaces. */
export async function refreshVertex(
  input: Omit<facade.VertexRequestInput, 'kind'> & {
    kind: 'profile' | 'search';
    stale: boolean;
    ndk?: NDK;
    signal?: AbortSignal;
    /** Injectable transport for tests; defaults to direct `wss://relay.vertexlab.io`. */
    send?: DirectVertexSender;
  }
): Promise<NaggProfilesEnvelope | null> {
  if (!input.stale || !enabled() || input.signal?.aborted) return null;
  const owner = activePubkey();
  const signer = input.ndk?.signer;
  if (!owner || !signer) return null;
  const budget = getVertexBudgetStore(owner);
  // Bound the wait if storage fails; spending fails closed until hydration succeeds.
  await whenLoaded(budget, { timeoutMs: 2_000 });
  if (!budget.persist.hasHydrated()) return null;
  const identity = await ResultAsync.fromPromise(signer.user(), () => null);
  const stillCurrent = () =>
    activePubkey() === owner &&
    input.ndk?.signer === signer &&
    enabled() &&
    !input.signal?.aborted &&
    !(
      budget.getState().blockedUntilDay &&
      budget.getState().blockedUntilDay! > new Date().toISOString().slice(0, 10)
    );
  if (identity.isErr() || identity.value.pubkey !== owner || !stillCurrent()) return null;
  const day = new Date().toISOString().slice(0, 10);
  const scope = `${owner}:${day}`;
  for (const key of attempted.keys()) if (!key.endsWith(`:${day}`)) attempted.delete(key);
  const key =
    input.kind === 'search'
      ? `search:${input.query?.trim().toLowerCase()}`
      : `${input.kind}:${input.target ?? ''}`;
  const seen = attempted.get(scope) ?? new Set<string>();
  if (seen.has(key)) return null;
  if (!budget.getState().reserve()) return null;
  seen.add(key);
  attempted.set(scope, seen);
  const signed = await signVertexRequest(facade.buildVertexRequest(input), input.ndk);
  if (signed.isErr() || signed.value.pubkey !== owner || !stillCurrent()) return null;

  nostrLog.info('nostr.vertex.client_request', { kind: input.kind, reason: 'stale' });
  const send: DirectVertexSender =
    input.send ??
    ((signedEvent, opts) => facade.sendDirectVertexRequest(signedEvent, { ...opts, verifyEvent }));
  const response = await send(signed.value, { signal: input.signal, timeoutMs: 15_000 });
  if (!response.ok) {
    if (response.reason === 'insufficient_credits' && budget.getState().block()) {
      nostrLog.info('nostr.vertex.credits_exhausted');
    }
    return null;
  }
  if (!stillCurrent()) return null;
  return facade.directVertexToProfilesEnvelope(response, input.target);
}

registerAccountScoped(
  'nostr.vertex-attempted',
  () => {
    attempted.clear();
  },
  () => attempted.size === 0
);
