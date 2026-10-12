// ---------------------------------------------------------------------------
// Which of two replaceable events stands (NIP-01)
//
// The newer one, and when both were made in the same second the one with the
// lower id. Without the second half, two devices that saw the same pair in a
// different order would each keep a different one.
// ---------------------------------------------------------------------------

type Replaceable = { created_at: number; id: string };

/** True when `candidate` replaces `current`. */
export function supersedes(candidate: Replaceable, current: Replaceable): boolean {
  return (
    candidate.created_at > current.created_at ||
    (candidate.created_at === current.created_at && candidate.id < current.id)
  );
}
