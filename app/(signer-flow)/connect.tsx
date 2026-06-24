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

import { useEffect, useRef } from 'react';
import { z } from 'zod';

import {
  openPairingFromUri,
  PAIRING_ERROR_BUNKER,
  PAIRING_ERROR_INVALID_LINK,
  PAIRING_ERROR_TITLE,
} from '@/features/nostrSigner';
import { guardedRouter as router } from '@/shared/hooks/useGuardedRouter';
import { useRouteParams } from '@/shared/lib/nav/useRouteParams';
import { popup } from '@/shared/lib/popup';
import { Screen } from '@/shared/ui/composed/Screen';
import { View } from '@/shared/ui/primitives/View/View';

const MAX_URI_PARAM_LENGTH = 4096;

const BACKDROP_STYLE = { flex: 1 } as const;

const ParamsSchema = z.object({
  uri: z.string().min(1).max(MAX_URI_PARAM_LENGTH),
});

function toastAndGoToHub(body: string): void {
  popup({ message: PAIRING_ERROR_TITLE, text: body, type: 'error' });
  router.replace('/(signer-flow)' as never);
}

const onInvalid = () => toastAndGoToHub(PAIRING_ERROR_INVALID_LINK);

export default function SignerConnectRoute() {
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
      <View style={BACKDROP_STYLE} />
    </Screen>
  );
}
