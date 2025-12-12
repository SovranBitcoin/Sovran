/**
 * @fileoverview User Flow Share Screen
 *
 * Share user profile via QR code within the user flow.
 * Uses the ShareScreen component with npub type.
 */

import React, { useCallback, useState } from 'react';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useTheme } from 'providers/ThemeProvider';
import { withSheetProvider } from 'hocs/withSheetProvider';
import { ShareScreen, SHARE_CONFIGS, ShareType } from 'components/screens/ShareScreen';

function SharePage() {
  const { getPrimaryColor } = useTheme();
  const params = useLocalSearchParams<{
    type?: ShareType;
    data: string;
    npub?: string;
    lud16?: string;
  }>();

  const { type = 'npub', data, npub, lud16 } = params;

  // Dynamic title based on type and tab selection
  const [headerTitle, setHeaderTitle] = useState(SHARE_CONFIGS[type]?.title || 'Share Profile');

  const handleTitleChange = useCallback((title: string) => {
    setHeaderTitle(title);
  }, []);

  return (
    <>
      <Stack.Screen
        options={{
          title: headerTitle,
          headerTitleStyle: { color: getPrimaryColor('0') },
        }}
      />
      <ShareScreen
        type={type}
        data={data}
        npub={npub}
        lud16={lud16}
        onTitleChange={handleTitleChange}
      />
    </>
  );
}

export default withSheetProvider(SharePage);
