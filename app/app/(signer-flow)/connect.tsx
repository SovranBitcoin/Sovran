/**
 * @fileoverview Deep-link target for nostrconnect:// system URLs
 *
 * `+native-intent.tsx` rewrites `nostrconnect://…` to
 * `/(signer-flow)/connect?uri=…`. This route re-validates the param at the
 * route boundary (deep-link params are attacker-controllable per AUDIT.md
 * dim-5; bounded length), then hands the raw URI to the shared
 * `openPairingFromUri` dispatch, which opens the 'signer-connect' sheet above
 * this minimal hub-style backdrop. Invalid/absent uri → error toast +
 * redirect to the signer hub. The URI embeds the pairing bearer secret —
 * never log it.
 */

import { useCallback, useEffect, useRef } from 'react';
import { z } from 'zod';

import {
  openPairingFromUri,
  PAIRING_ERROR_BUNKER,
  PAIRING_ERROR_INVALID_LINK,
  PAIRING_ERROR_TITLE,
} from '@/features/nostrSigner';
import { MAX_NOSTRCONNECT_URI_LENGTH } from '@/features/nostrSigner/lib/nip46Uri';
import { guardedRouter as router } from '@/shared/hooks/useGuardedRouter';
import { useRouteParams } from '@/shared/lib/nav/useRouteParams';
import { popup } from '@/shared/lib/popup';
import { E2EActionMenuProbe } from '@/shared/lib/popup/E2EActionMenuProbe';
import { Screen } from '@/shared/ui/composed/Screen';
import { View } from '@/shared/ui/primitives/View/View';

const BACKDROP_STYLE = { flex: 1 } as const;

const ParamsSchema = z.object({
  uri: z.string().min(1).max(MAX_NOSTRCONNECT_URI_LENGTH),
});

function toastAndGoToHub(body: string): void {
  popup({ message: PAIRING_ERROR_TITLE, text: body, type: 'error' });
  router.replace('/(signer-flow)' as never);
}

export default function SignerConnectRoute() {
  const onInvalid = useCallback(() => toastAndGoToHub(PAIRING_ERROR_INVALID_LINK), []);
  const params = useRouteParams(ParamsSchema, { where: 'signer-flow.connect', onInvalid });
  const uri = params?.uri;
  const openedRef = useRef(false);

  useEffect(() => {
    if (uri === undefined || openedRef.current) return;
    openedRef.current = true;
    const opened = openPairingFromUri(uri);
    if (opened.isErr()) {
      toastAndGoToHub(
        opened.error.type === 'bunker-unsupported'
          ? PAIRING_ERROR_BUNKER
          : PAIRING_ERROR_INVALID_LINK
      );
    }
  }, [uri]);

  return (
    <Screen name="SignerConnectRoute" scroll="none">
      {/* The 'signer-connect' sheet is FWO/AX-invisible; simulator plans
          observe it via this root-tree marker (same seam as SignerHubScreen). */}
      <E2EActionMenuProbe />
      <View style={BACKDROP_STYLE} />
    </Screen>
  );
}
