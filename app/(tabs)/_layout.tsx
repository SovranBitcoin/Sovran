import { Icon, Label, NativeTabs } from 'expo-router/unstable-native-tabs';
import { DynamicColorIOS, Platform } from 'react-native';

import { Colors } from '@/constants/theme';

export default function TabLayout() {
  return (
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
      <NativeTabs.Trigger name="index">
        <Icon sf={{ default: 'house', selected: 'house.fill' }} />
        <Label>Home</Label>
      </NativeTabs.Trigger>

      <NativeTabs.Trigger name="payments">
        <Icon sf={{ default: 'creditcard', selected: 'creditcard.fill' }} />
        <Label>Payments</Label>
      </NativeTabs.Trigger>

      <NativeTabs.Trigger name="explore">
        <Icon sf={{ default: 'paperplane', selected: 'paperplane.fill' }} />
        <Label>Explore</Label>
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}
