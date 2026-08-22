import { useCallback, useState } from 'react';
import { Stack } from 'expo-router';

import { ShareScreen, SHARE_CONFIGS, ShareType } from '@/features/user';
import { shareRouteParamsSchema } from '@/features/user/lib/shareRouteParams';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { useRouteParams } from '@/shared/lib/nav/useRouteParams';

const ParamsSchema = shareRouteParamsSchema('npub');

export default function ShareRoute() {
  const foreground = useThemeColor('foreground');
  const parsed = useRouteParams(ParamsSchema, { where: 'profile.share' });
  const type = (parsed?.type ?? 'npub') as ShareType;
  const [headerTitle, setHeaderTitle] = useState<string>(
    SHARE_CONFIGS[type]?.title ?? 'Share Profile'
  );
  const handleTitleChange = useCallback((title: string) => setHeaderTitle(title), []);

  if (!parsed) return null;

  return (
    <>
      <Stack.Screen
        options={{
          title: headerTitle,
          headerTitleStyle: { color: foreground },
        }}
      />
      <ShareScreen
        type={type}
        data={parsed.data}
        npub={parsed.npub}
        lud16={parsed.lud16}
        onTitleChange={handleTitleChange}
      />
    </>
  );
}
