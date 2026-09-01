/**
 * @fileoverview Standalone Share route wrapper.
 *
 * Deep-link params are validated at the route boundary by the shared
 * `shareRouteParamsSchema` — see there for why the allowlist matters.
 */

import { useCallback, useState } from 'react';
import { guardedRouter as router } from '@/shared/hooks/useGuardedRouter';

import { ShareScreen, SHARE_CONFIGS, ShareType } from '@/features/user';
import { shareRouteParamsSchema } from '@/features/user/lib/shareRouteParams';
import { FormSheetChrome } from '@/shared/ui/composed/FormSheetChrome';
import { useScreenOptions } from '@/shared/ui/composed/Screen';
import { ScreenHeaderAction } from '@/shared/ui/composed/ScreenHeaderAction';
import { withGlassHeaderItems } from '@/navigation/headerItems';
import { useRouteParams } from '@/shared/lib/nav/useRouteParams';

const ParamsSchema = shareRouteParamsSchema('profile');

function ShareRoute() {
  const parsed = useRouteParams(ParamsSchema, { where: 'app.share' });
  const type = (parsed?.type ?? 'profile') as ShareType;
  const [headerTitle, setHeaderTitle] = useState<string>(SHARE_CONFIGS[type]?.title ?? 'Share');

  const handleTitleChange = useCallback((title: string) => {
    setHeaderTitle(title);
  }, []);

  useScreenOptions(
    () =>
      withGlassHeaderItems({
        headerTitle,
        headerLeft: () => (
          <ScreenHeaderAction icon="material-symbols:close-rounded" onPress={() => router.back()} />
        ),
      }),
    [headerTitle]
  );

  if (!parsed) return null;

  return (
    <FormSheetChrome title={headerTitle}>
      <ShareScreen
        type={type}
        data={parsed.data}
        npub={parsed.npub}
        lud16={parsed.lud16}
        onTitleChange={handleTitleChange}
      />
    </FormSheetChrome>
  );
}

export default ShareRoute;
