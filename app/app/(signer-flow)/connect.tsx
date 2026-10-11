/**
 * @fileoverview Deep-link target for nostrconnect:// system URLs
 *
 * `+native-intent.tsx` holds a `nostrconnect://…` link in memory and sends
 * the app to `/(signer-flow)/connect?ticket=…`. This route redeems the ticket,
 * bounds the link's length (it came from outside the app), then hands it to
 * the shared `openPairingFromUri` dispatch, which opens the 'signer-connect'
 * sheet above this minimal hub-style backdrop. An invalid link → error toast +
 * redirect to the signer hub. A ticket with nothing behind it (already used,
 * or the route was reached some other way) → the signer hub, quietly. The
 * link embeds the pairing bearer secret, so it is never a route param and
 * never logged.
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
import { takePairingUri } from '@/features/nostrSigner/lib/pendingPairingUri';
import { guardedRouter as router } from '@/shared/hooks/useGuardedRouter';
import { useRouteParams } from '@/shared/lib/nav/useRouteParams';
import { popup } from '@/shared/lib/popup';
import { E2EActionMenuProbe } from '@/shared/lib/popup/E2EActionMenuProbe';
import { Screen } from '@/shared/ui/composed/Screen';
import { View } from '@/shared/ui/primitives/View/View';

const BACKDROP_STYLE = { flex: 1 } as const;

const ParamsSchema = z.object({
  ticket: z.string().regex(/^\d{1,9}$/),
});

function toastAndGoToHub(body: string): void {
  popup({ message: PAIRING_ERROR_TITLE, text: body, type: 'error' });
  router.replace('/(signer-flow)' as never);
}

export default function SignerConnectRoute() {
  const onInvalid = useCallback(() => toastAndGoToHub(PAIRING_ERROR_INVALID_LINK), []);
  const params = useRouteParams(ParamsSchema, { where: 'signer-flow.connect', onInvalid });
  const ticket = params?.ticket;
  const openedRef = useRef(false);

  useEffect(() => {
    if (ticket === undefined || openedRef.current) return;
    openedRef.current = true;
    const uri = takePairingUri(ticket);
    if (uri === null) {
      router.replace('/(signer-flow)' as never);
      return;
    }
    if (uri.length > MAX_NOSTRCONNECT_URI_LENGTH) {
      toastAndGoToHub(PAIRING_ERROR_INVALID_LINK);
      return;
    }
    const opened = openPairingFromUri(uri);
    if (opened.isErr()) {
      toastAndGoToHub(
        opened.error.type === 'bunker-unsupported'
          ? PAIRING_ERROR_BUNKER
          : PAIRING_ERROR_INVALID_LINK
      );
    }
  }, [ticket]);

  return (
    <Screen name="SignerConnectRoute" scroll="none">
      {/* The 'signer-connect' sheet is FWO/AX-invisible; simulator plans
          observe it via this root-tree marker (same seam as SignerHubScreen). */}
      <E2EActionMenuProbe />
      <View style={BACKDROP_STYLE} />
    </Screen>
  );
}
