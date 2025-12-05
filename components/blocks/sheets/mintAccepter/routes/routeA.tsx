import React from 'react';

import { ButtonHandler } from 'components/ui/ButtonHandler';
import { StyledText, Text } from 'components/ui/Text';
import { View } from 'components/ui/View/View';
import { useTheme } from 'providers/ThemeProvider';
import { RouteScreenProps, useSheetPayload, useSheetRef } from 'react-native-actions-sheet';
import { useMintManagement } from 'hooks/coco/useMintManagement';
import { popup } from '@/helper/popup';
import { removeProtocol } from '@/helper/url';
import { Alert } from 'react-native';

// eslint-disable-next-line no-empty-pattern
function RouteA({}: RouteScreenProps<'mint-accepter', 'route-a'>) {
  const { getPrimaryColor } = useTheme();
  const ref = useSheetRef('mint-accepter');
  const payload = useSheetPayload('mint-accepter');
  const { addMint } = useMintManagement();

  return (
    <View className="mx-4 mb-0 overflow-hidden rounded-2xl bg-primary-800 p-4">
      <Text
        size={24}
        overpass
        heavy
        className="text-primary-0"
        style={{
          textAlign: 'center',
          marginBottom: 16,
        }}>
        Do you want to trust{' '}
        <View>
          <StyledText
            primary
            size={20}
            heavy
            overpass
            style={{
              marginBottom: -5.5,
            }}>
            {removeProtocol(payload.mint)}?
          </StyledText>
        </View>
      </Text>
      <ButtonHandler
        gradientColor={getPrimaryColor('800')}
        buttons={[
          {
            text: "Don't trust",
            variant: 'secondary',
            onPress: async () => {
              ref.current.hide({
                mint: [payload.mint],
                trusted: false,
              });
            },
          },
          {
            text: 'Trust',
            variant: 'primary',
            onPress: async () => {
              try {
                await addMint(payload.mint);
                ref.current.hide({
                  mint: [payload.mint],
                  trusted: true,
                });
              } catch (err) {
                Alert.alert('Error', err instanceof Error ? err.message : 'Failed to add mint');
                popup({
                  message: err instanceof Error ? err.message : 'Failed to add mint',
                  type: 'error',
                });
                ref.current.hide({
                  mint: [payload.mint],
                  trusted: false,
                  error: err instanceof Error ? err.message : 'Failed to add mint',
                });
              }
            },
          },
        ]}
        style={{ marginTop: 16 }}
      />
    </View>
  );
}

export default RouteA;
