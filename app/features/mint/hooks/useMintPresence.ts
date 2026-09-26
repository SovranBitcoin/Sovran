import { useEffect, useRef, useState } from 'react';

import { probeMints, type MintStatus } from '@/shared/lib/cashu/mintHealth';
import { normalizeMintUrlKey } from '@/shared/lib/url';

/** Batches probe results into one commit, as the provider list does: a sweep
 *  of forty answers costs a handful of renders instead of forty. */
const COMMIT_MS = 120;

/**
 * This phone's own liveness verdict for a set of mints, keyed by normalized
 * mint URL, filled in as the sweep answers. Feed it the rows on screen (the
 * selector's list, the discovery list's visible window); rows not yet probed
 * are simply absent, which the face draws as no dot.
 *
 * Re-sweeps when the set changes; already-fresh answers report at once from
 * the probe cache, so scrolling a long list only ever pays for new rows.
 */
export function useMintPresence(
  mintUrls: readonly string[],
  enabled = true
): Record<string, MintStatus> {
  const [presence, setPresence] = useState<Record<string, MintStatus>>({});
  const pendingRef = useRef<Record<string, MintStatus>>({});
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Only real mint URLs; skeleton rows carry synthetic keys. The sweep needs
  // the URLs themselves (the probe dials them), while the effect keys on the
  // normalized set so a re-render with the same mints does not re-sweep.
  const probeUrls = mintUrls.filter((url) => url.startsWith('https://'));
  const probeKey = probeUrls.map(normalizeMintUrlKey).sort().join('\u0000');
  const urlsRef = useRef(probeUrls);
  urlsRef.current = probeUrls;

  useEffect(() => {
    if (!enabled || probeKey.length === 0) return;
    const controller = new AbortController();
    const urls = urlsRef.current;
    const flush = () => {
      timerRef.current = null;
      const batch = pendingRef.current;
      pendingRef.current = {};
      setPresence((prev) => {
        let changed = false;
        const next = { ...prev };
        for (const [key, status] of Object.entries(batch)) {
          if (next[key] !== status) {
            next[key] = status;
            changed = true;
          }
        }
        return changed ? next : prev;
      });
    };
    void probeMints(urls, {
      signal: controller.signal,
      onResult: (probe) => {
        pendingRef.current[probe.key] = probe.status;
        if (timerRef.current === null) timerRef.current = setTimeout(flush, COMMIT_MS);
      },
    });
    return () => {
      controller.abort();
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      // Answers that landed before the abort still count.
      if (Object.keys(pendingRef.current).length > 0) flush();
    };
  }, [probeKey, enabled]);

  return presence;
}
