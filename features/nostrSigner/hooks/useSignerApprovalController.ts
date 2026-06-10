/**
 * @fileoverview Signer approval controller — queue → sheet orchestration
 *
 * Mounted once inside NostrSignerProvider. Watches the runtime pending queue
 * and opens the 'signer-approval' custom sheet when a request needs a
 * verdict, respecting PopupHost lane semantics:
 *
 *   - never steals the lane: if ANY sheet is open (signer or not) it waits
 *     until the lane is free, then opens after a short settle delay so the
 *     previous sheet's exit animation finishes;
 *   - dismiss-without-verdict defers the batch: every still-pending request
 *     is parked (no auto-reopen) and a "Requests waiting" toast points at the
 *     Signer pages. A new incoming request un-parks the flow;
 *   - "View All" closes are deferrals too, but silent (the sheet sets the
 *     one-shot suppression flag before closing).
 *
 * Also owns the quiet auto-signed toast: a store subscription watches the
 * activity log for `auto_approved_grant` entries and shows the 2s
 * "Auto-signed for {app}" notice. Kept deliberately cheap — one id
 * comparison per activity write, no React state.
 */

import { useEffect, useRef } from 'react';

import {
  appDisplayName,
  autoSignedToastCopy,
  permissionEntryFor,
  requestsWaitingToastCopy,
} from '@/features/nostrSigner/components/permissionCatalog';
import { useNip46ActivityStore } from '@/features/nostrSigner/data/nip46ActivityStore';
import { useNip46ConnectionsStore } from '@/features/nostrSigner/data/nip46ConnectionsStore';
import { useNip46RequestsStore } from '@/features/nostrSigner/data/nip46RequestsStore';
import { consumeSignerDeferToastSuppression } from '@/features/nostrSigner/hooks/signerApprovalCoordination';
import { popup, showActionSheet } from '@/shared/lib/popup';
import { isCustomSheetPayload, usePopupStore } from '@/shared/stores/runtime/popupStore';

/** Settle delay between a sheet closing and the approval sheet opening. */
const APPROVAL_OPEN_DELAY_MS = 500;

/** "Quiet 2s" — the auto-signed notice must never demand attention. */
const AUTO_SIGNED_TOAST_MS = 2000;

// ── Pure decision helpers (unit-tested) ─────────────────────────

/** A request that is pending and not parked by a dismissal wants a prompt. */
export function hasOpenableRequest(
  pending: readonly { id: string }[],
  deferredIds: ReadonlySet<string>
): boolean {
  return pending.some((request) => !deferredIds.has(request.id));
}

/** Drop parked ids whose requests already left the queue (resolved/expired). */
export function pruneDeferredIds(
  deferredIds: ReadonlySet<string>,
  pending: readonly { id: string }[]
): Set<string> {
  const live = new Set(pending.map((request) => request.id));
  const next = new Set<string>();
  for (const id of deferredIds) {
    if (live.has(id)) next.add(id);
  }
  return next;
}

type SignerSheetCloseOutcome = 'none' | 'defer-silent' | 'defer-toast';

/** What a signer-approval close means for the remaining queue. */
export function signerSheetCloseOutcome(
  pendingCount: number,
  toastSuppressed: boolean
): SignerSheetCloseOutcome {
  if (pendingCount === 0) return 'none';
  return toastSuppressed ? 'defer-silent' : 'defer-toast';
}

// ── Controller hook ─────────────────────────────────────────────

export function useSignerApprovalController(): void {
  const pending = useNip46RequestsStore((s) => s.pending);
  const isOpen = usePopupStore((s) => s.isOpen);
  const current = usePopupStore((s) => s.current);

  const deferredIdsRef = useRef<Set<string>>(new Set());
  const wasSignerSheetOpenRef = useRef(false);

  const signerSheetOpen =
    isOpen && isCustomSheetPayload(current) && current.sheetId === 'signer-approval';

  // ── Close handling: dismiss-without-verdict defers the batch ──
  useEffect(() => {
    const wasOpen = wasSignerSheetOpenRef.current;
    wasSignerSheetOpenRef.current = signerSheetOpen;
    if (!wasOpen || signerSheetOpen) return;
    const live = useNip46RequestsStore.getState().pending;
    const suppressed = consumeSignerDeferToastSuppression();
    const outcome = signerSheetCloseOutcome(live.length, suppressed);
    if (outcome === 'none') return;
    for (const request of live) deferredIdsRef.current.add(request.id);
    if (outcome === 'defer-toast') {
      const copy = requestsWaitingToastCopy(live.length);
      popup({ message: copy.label, text: copy.description });
    }
  }, [signerSheetOpen]);

  // ── Open handling: prompt when the lane is free ───────────────
  useEffect(() => {
    deferredIdsRef.current = pruneDeferredIds(deferredIdsRef.current, pending);
    if (isOpen) return undefined; // never steal an open sheet — wait for close
    if (!hasOpenableRequest(pending, deferredIdsRef.current)) return undefined;
    const timer = setTimeout(() => {
      // Re-check against live state: another sheet may have grabbed the lane,
      // or the request may have expired during the settle delay.
      if (usePopupStore.getState().isOpen) return;
      const live = useNip46RequestsStore.getState().pending;
      if (!hasOpenableRequest(live, deferredIdsRef.current)) return;
      showActionSheet('signer-approval', {});
    }, APPROVAL_OPEN_DELAY_MS);
    return () => clearTimeout(timer);
  }, [isOpen, pending]);

  // ── Auto-signed toast (Always Allow grants) ───────────────────
  // The activity store is persisted (AsyncStorage) and rehydrates async. Seed
  // the baseline only AFTER hydration: otherwise persist's merge setState fires
  // the subscriber with the PREVIOUS session's newest entry, which can spuriously
  // toast "Auto-signed" on a cold start when nothing was signed.
  useEffect(() => {
    let hydrated = false;
    let lastSeenEntryId: string | null = null;
    const seed = (): void => {
      lastSeenEntryId = useNip46ActivityStore.getState().entries[0]?.id ?? null;
      hydrated = true;
    };
    const unsubscribe = useNip46ActivityStore.subscribe((state) => {
      if (!hydrated) return; // ignore the rehydration setState (and any pre-hydration write)
      const newest = state.entries[0];
      if (newest === undefined || newest.id === lastSeenEntryId) return;
      lastSeenEntryId = newest.id;
      if (newest.verdict !== 'auto_approved_grant') return;
      const connection = useNip46ConnectionsStore.getState().apps[newest.clientPubkey];
      const { headline } = permissionEntryFor({
        method: newest.method,
        ...(newest.kind !== undefined && { kind: newest.kind }),
      });
      const copy = autoSignedToastCopy(appDisplayName(connection), headline);
      popup({ message: copy.label, text: copy.description, duration: AUTO_SIGNED_TOAST_MS });
    });
    const unsubHydrate = useNip46ActivityStore.persist.onFinishHydration(seed);
    if (useNip46ActivityStore.persist.hasHydrated()) seed();
    return () => {
      unsubHydrate();
      unsubscribe();
    };
  }, []);
}
