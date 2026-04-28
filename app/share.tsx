import React, { useCallback, useState } from 'react';
import { router, useLocalSearchParams } from 'expo-router';

import { ShareScreen, SHARE_CONFIGS, ShareType } from '@/features/user';
import { useScreenOptions } from '@/shared/ui/composed/Screen';
import { ScreenHeaderAction } from '@/shared/ui/composed/ScreenHeaderAction';

function ShareRoute() {
  const params = useLocalSearchParams<{
    type?: ShareType;
    data: string;
    npub?: string;
  }>();

  const { type = 'profile', data, npub } = params;
  const [headerTitle, setHeaderTitle] = useState<string>(SHARE_CONFIGS[type]?.title ?? 'Share');

  const handleTitleChange = useCallback((title: string) => {
    setHeaderTitle(title);
  }, []);

  useScreenOptions(
    () => ({
      headerTitle,
      headerLeft: () => (
        <ScreenHeaderAction icon="material-symbols:close-rounded" onPress={() => router.back()} />
      ),
    }),
    [headerTitle]
  );

  return (
    <ShareScreen type={type} data={data ?? ''} npub={npub} onTitleChange={handleTitleChange} />
  );
}

export default ShareRoute;
