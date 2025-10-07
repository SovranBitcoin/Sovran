import React from 'react';

import { ButtonHandler } from 'components/ui/ButtonHandler';
import { StyledText, Text } from 'components/ui/Text';
import { View } from 'components/ui/View';
import { useTheme } from 'providers/ThemeProvider';
import { RouteScreenProps, useSheetPayload, useSheetRef } from 'react-native-actions-sheet';
import { useMintManagement } from 'hooks/coco/useMintManagement';
import { popup } from '@/helper/popup';

// eslint-disable-next-line no-empty-pattern
function RouteA({}: RouteScreenProps<'mint-accepter', 'route-a'>) {
  const { getPrimaryColor } = useTheme();
  const ref = useSheetRef('mint-accepter');
  const payload = useSheetPayload('mint-accepter');
  const { addMint } = useMintManagement();

  return (
    <View
      style={{
        marginHorizontal: 8,
        marginBottom: 0,
        borderRadius: 16,
        overflow: 'hidden',
        backgroundColor: getPrimaryColor('800'),
        padding: 8,
        paddingTop: 24,
      }}>
      <Text
        size={24}
        style={{
          fontSize: 20,
          fontFamily: 'OverpassHeavy',
          color: getPrimaryColor('0'),
          marginLeft: 16,
          textAlign: 'center',
          marginBottom: 16,
        }}>
        Do you want to trust{' '}
        <View>
          <StyledText
            primary
            style={{
              fontFamily: 'OverpassHeavy',
              fontSize: 20,
              marginBottom: -5.5,
            }}>
            {payload.mint.replace('https://', '').replace('http://', '')}
          </StyledText>
        </View>
        ?
      </Text>
      <ButtonHandler
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
