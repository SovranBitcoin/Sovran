import { Icon, Label, NativeTabs } from 'expo-router/unstable-native-tabs';
import { BackgroundProvider } from 'providers/BackgroundProvider';
import { DynamicColorIOS, Platform } from 'react-native';

import { Colors } from '@/constants/theme';

export default function TabLayout() {
  return (
    <BackgroundProvider>
      <NativeTabs
        labelStyle={{
          color: Platform.select({
            ios: DynamicColorIOS({
              dark: Colors.dark.text,
              light: Colors.light.text,
            }),
          }),
        }}
        tintColor={Platform.select({
          ios: DynamicColorIOS({
            dark: Colors.dark.tint,
            light: Colors.light.tint,
          }),
        })}
        disableTransparentOnScrollEdge>
        <NativeTabs.Trigger name="payments">
          <Icon
            sf={{
              default: 'arrow.up.arrow.down',
              selected: 'arrow.up.arrow.down',
            }}
          />
          <Label>Payments</Label>
        </NativeTabs.Trigger>

        <NativeTabs.Trigger name="index">
          <Icon
            sf={{
              default: 'wallet.bifold',
              selected: 'wallet.bifold',
            }}
          />
          <Label>Walet</Label>
        </NativeTabs.Trigger>

        <NativeTabs.Trigger name="explore">
          <Icon sf={{ default: 'paperplane', selected: 'paperplane.fill' }} />
          <Label>Explore</Label>
        </NativeTabs.Trigger>
      </NativeTabs>
    </BackgroundProvider>
  );
}
