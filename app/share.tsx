import React, { useCallback, useState } from 'react';
import { TouchableOpacity } from 'react-native';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { withSheetProvider } from 'hocs/withSheetProvider';
import Icon from 'assets/icons';
import { useThemeColor } from '@/shared/hooks/useThemeColor';

import { ShareScreen, SHARE_CONFIGS, ShareType } from '@/features/user';

function ShareRoute() {
  const foreground = useThemeColor('foreground');
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

  const CloseButton = () => (
    <TouchableOpacity onPress={() => router.back()} style={{ padding: 8 }}>
      <Icon name="material-symbols:close-rounded" size={24} color={foreground} />
    </TouchableOpacity>
  );

  return (
    <>
      <Stack.Screen
        options={{
          headerTitle,
          headerTitleStyle: { color: foreground },
          headerTintColor: foreground,
          headerLeft: () => <CloseButton />,
        }}
      />
      <ShareScreen type={type} data={data ?? ''} npub={npub} onTitleChange={handleTitleChange} />
    </>
  );
}

export default withSheetProvider(ShareRoute);
