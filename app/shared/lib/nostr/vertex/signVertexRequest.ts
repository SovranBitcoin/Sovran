import { NDKEvent, type default as NDK } from '@nostr-dev-kit/ndk-mobile';
import { err, ok, ResultAsync, type Result } from 'neverthrow';
import type { facade } from 'nostr';
import { useSettingsStore } from '@/shared/stores/global/settingsStore';

export function vertexAutomationDisabled(): boolean {
  return useSettingsStore.getState().mockMode || !!process.env.EXPO_PUBLIC_E2E_STATE_MIRROR;
}

type SignError = { type: 'no-signer' | 'disabled' | 'sign-failed' };
/** Same NDK event/signing path as publishEvent; never reads private material. */
export async function signVertexRequest(
  unsigned: facade.UnsignedVertexRequest,
  ndk?: NDK
): Promise<Result<facade.SignedVertexRequest, SignError>> {
  if (vertexAutomationDisabled()) return err({ type: 'disabled' });
  const signer = ndk?.signer;
  if (!ndk || !signer) return err({ type: 'no-signer' });
  const event = new NDKEvent(ndk);
  event.kind = unsigned.kind;
  event.created_at = unsigned.created_at;
  event.tags = unsigned.tags;
  event.content = unsigned.content;
  const result = await ResultAsync.fromPromise(event.sign(signer), (): SignError => ({
    type: 'sign-failed',
  }));
  if (result.isErr()) return err(result.error);
  const raw = event.rawEvent();
  if (!raw.sig || !raw.id || raw.kind == null) return err({ type: 'sign-failed' });
  return ok({ ...raw, sig: raw.sig, id: raw.id, kind: raw.kind });
}
