/**
 * @fileoverview The Details modal: every fact about one payment, as a table.
 *
 * A route of its own, so it is a real modal with the app's own header: the
 * system page sheet on iPhone (close button, or pulled down to dismiss) and a
 * pushed page on Android (ADR 0025). Whoever opens it puts the rows in
 * `detailsSheetStore` first — see `DetailsSection`.
 */

import { useEffect } from 'react';

import { useScreenOptions } from '@/shared/ui/composed/Screen';
import { guardedRouter as router } from '@/shared/hooks/useGuardedRouter';
import { useDetailsSheetStore } from '@/shared/stores/runtime/detailsSheetStore';
import { DetailsSheetContent } from '@/shared/ui/composed/DetailsSheet';

function DetailsRoute() {
  const title = useDetailsSheetStore((state) => state.title);
  const items = useDetailsSheetStore((state) => state.items);
  const clear = useDetailsSheetStore((state) => state.clear);

  // The native header carries the title; a section may have named its own.
  useScreenOptions(() => ({ headerTitle: title }), [title]);

  // Leaving by any road (Done, a pull, the back button) ends what was shown.
  useEffect(() => clear, [clear]);

  return <DetailsSheetContent items={items} onClose={() => router.back()} />;
}

export default DetailsRoute;
