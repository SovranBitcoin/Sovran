import { Stack, useNavigation } from 'expo-router';
import { DrawerActions } from 'expo-router/react-navigation';
import { MintSelector } from '@/features/wallet';
import { useWalletMintListRequest } from '@/features/wallet/hooks/useWalletMintListRequest';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { supportsLiquidGlass } from '@/shared/lib/version';
import { buildExpoRouterHeaderOptions } from '@/navigation/nativeTabs';
import { HeaderProfileButton } from '@/shared/blocks/HeaderProfileButton';
import { View } from '@/shared/ui/primitives/View/View';

// Measured on device (320pt window): UIKit places a fitting custom titleView
// at +2pt right of true center on iOS 26. The bias is additive, so it can't be
// fixed with width math; the title content is moved back by the same amount.
const liquidTitleBiasClass = supportsLiquidGlass() ? '-translate-x-0.5' : undefined;

export default function HomeLayout() {
  const handleRequestMintList = useWalletMintListRequest();
  const iconColor = useThemeColor('foreground');
  const navigation = useNavigation();
  const openDrawer = () => navigation.dispatch(DrawerActions.openDrawer());

  // Transparent header so the wallpaper shows through; the MintSelector is the
  // title. Search is its own tab (ADR 0035), so the header carries no search.
  const screenOptions = buildExpoRouterHeaderOptions({
    iconColor,
    headerLeft: () => <HeaderProfileButton onPress={openDrawer} />,
    options: {
      title: 'Wallet',
      // Without this, the native bar inherits the locked dark
      // `userInterfaceStyle` and renders the title white — invisible on
      // the light theme's `surface` background.
      headerTitleStyle: { color: iconColor },
      headerTintColor: iconColor,
      headerTransparent: true,
      headerShadowVisible: false,
      headerBlurEffect: 'none',
      headerStyle: { backgroundColor: 'transparent' },
      headerBackground: () => null,
      headerTitle: () => (
        <View className={liquidTitleBiasClass}>
          <MintSelector testID="wallet-mint-selector" onRequestMintList={handleRequestMintList} />
        </View>
      ),
    },
  });

  return (
    <Stack screenOptions={{ contentStyle: { backgroundColor: 'transparent' } }}>
      <Stack.Screen name="index" options={screenOptions} />
    </Stack>
  );
}
