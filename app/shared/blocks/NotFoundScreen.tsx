/**
 * @fileoverview Catch-all screen for unresolved routes.
 *
 * Rendered by the expo-router `+not-found` route whenever navigation lands on
 * a path that matches no route file (e.g. a stale link, a renamed screen, or a
 * malformed deep link). Instead of leaving the user on a dead screen, it logs
 * the attempted path for observability and offers a one-tap return into the
 * app. Recovery uses `guardedRouter.replace` so the unresolved route never
 * sits in the back stack.
 *
 * Param-level failures are handled separately at the route boundary by
 * `useRouteParams` (Zod validate → `router.back()`); this screen covers the
 * orthogonal case of an unknown *path*.
 */

import { useEffect } from 'react';
import { StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { usePathname } from 'expo-router';

import Icon from 'assets/icons';
import { guardedRouter } from '@/shared/hooks/useGuardedRouter';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { log } from '@/shared/lib/logger';
import { iconSize, spacing } from '@/shared/styles/tokens';
import { Button } from '@/shared/ui/primitives/Button';
import { Text } from '@/shared/ui/primitives/Text';
import { View } from '@/shared/ui/primitives/View/View';
import { VStack } from '@/shared/ui/primitives/View/VStack';

/**
 * Canonical wallet route. The wallet lives in the `(tabs)/index` folder, which
 * expo-router collapses to an empty path segment, so the app root `/` is what
 * resolves to it (`/(drawer)/(tabs)/index` resolves to +not-found at runtime).
 */
const WALLET_ROUTE = '/' as const;

export function NotFoundScreen() {
  const pathname = usePathname();
  const insets = useSafeAreaInsets();
  const [surface, foreground, muted] = useThemeColor(['surface', 'foreground', 'muted'] as const);

  // Log the unresolved path once per mount so a recurring broken link surfaces
  // in diagnostics rather than failing silently.
  useEffect(() => {
    log.warn('nav.unknown_route', { path: pathname });
  }, [pathname]);

  return (
    <View
      style={[
        styles.container,
        { backgroundColor: surface, paddingTop: insets.top, paddingBottom: insets.bottom },
      ]}>
      <VStack align="center" justify="center" spacing={spacing.xl} style={styles.content}>
        <Icon name="mdi:alert-circle-outline" color={muted} size={iconSize['3xl']} />
        <VStack align="center" spacing={spacing.xs}>
          <Text size={20} bold style={{ color: foreground, textAlign: 'center' }}>
            This screen isn’t available
          </Text>
          <Text size={15} style={{ color: muted, textAlign: 'center' }}>
            The link you followed points somewhere that no longer exists.
          </Text>
        </VStack>
        <Button
          testID="not-found-go-wallet"
          text="Go to Wallet"
          variant="primary"
          onPress={() => guardedRouter.replace(WALLET_ROUTE)}
        />
      </VStack>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    flex: 1,
    paddingHorizontal: spacing['2xl'],
  },
});
