/**
 * Fail-closed accessibility policy for profile secret-value nodes.
 *
 * Native AX can retain off-screen descendants after navigation. The stable id
 * is useful to selectors and screenshot masking, but its authored label/value
 * may contain key material. Replace both fields by identity, before any AX
 * transport or artifact serialization; never depend on content recognition.
 */

const PROFILE_SECRET_AX_ID_PREFIX = 'profile-secret-value-';
export const PROFILE_SECRET_AX_REDACTED = '‹profile-secret:redacted›';

interface ProfileSecretAxFields {
  id?: string | null;
  label?: string | null;
  value?: string | null;
}

export const isProfileSecretAxId = (id: string | null | undefined): boolean =>
  id?.startsWith(PROFILE_SECRET_AX_ID_PREFIX) === true;

/** Preserve stable identity and semantic state while making secret-bearing
 * text impossible to serialize, even when the original fields are empty. */
export function redactProfileSecretAxFields<T extends ProfileSecretAxFields>(node: T): T {
  if (!isProfileSecretAxId(node.id)) return node;
  return {
    ...node,
    label: PROFILE_SECRET_AX_REDACTED,
    value: PROFILE_SECRET_AX_REDACTED,
  };
}

export const redactProfileSecretAxNodes = <T extends ProfileSecretAxFields>(
  nodes: readonly T[]
): T[] => nodes.map(redactProfileSecretAxFields);
