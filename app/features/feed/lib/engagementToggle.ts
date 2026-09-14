/**
 * Converges one viewer action (a like or a repost on one note) to the
 * viewer's LATEST intent.
 *
 * A tap only flips the optimistic intent in the store, so the heart answers
 * instantly and can be flipped back while a publish is still in flight. This
 * loop owns the network side: it reads the current intent, publishes the
 * reaction or its kind:5 retraction to match, and re-reads — so like → unlike
 * during the like's publish ends as "like, then delete", and like → unlike →
 * like ends as a single like. It stops when the network matches the intent or
 * the intent is gone (the overlay was cleared).
 */

export type ReconcileToggleDeps = {
  /** Our own event for this action as the network last confirmed it, if any. */
  initialOwnEventId: string | undefined;
  /** The viewer's current intent; `undefined` once the overlay is gone. */
  readIntent: () => boolean | undefined;
  /** Publish the reaction/repost; resolves our new event's id. */
  activate: () => Promise<string>;
  /** Publish a kind:5 retraction of our event. */
  deactivate: (ownEventId: string) => Promise<void>;
  /** After each network step, with our event id as it now stands. */
  onProgress: (ownEventId: string | undefined) => void;
  /** The network matches the intent (runs synchronously after the last check). */
  onSettled: () => void;
  /** A step failed; `ownEventId` is what the network last confirmed. */
  onFailed: (ownEventId: string | undefined, error: unknown) => void;
};

export async function reconcileToggle(deps: ReconcileToggleDeps): Promise<void> {
  let ownEventId = deps.initialOwnEventId;
  try {
    for (;;) {
      const intent = deps.readIntent();
      const active = ownEventId !== undefined;
      if (intent === undefined || intent === active) break;
      if (intent) {
        ownEventId = await deps.activate();
      } else {
        await deps.deactivate(ownEventId as string);
        ownEventId = undefined;
      }
      deps.onProgress(ownEventId);
    }
  } catch (error) {
    deps.onFailed(ownEventId, error);
    return;
  }
  deps.onSettled();
}
