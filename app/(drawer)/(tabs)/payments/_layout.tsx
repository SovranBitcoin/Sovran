import { IconSymbol } from '@/components/ui/icon-symbol';
import { useThemeColor } from '@/hooks/useThemeColor';
import { Stack } from 'expo-router';
import { Pressable, Platform, useWindowDimensions, TextInput } from 'react-native';
import { DrawerActions, useNavigation } from '@react-navigation/native';
import { Host, TextField, VStack as SwiftUIVStack } from '@expo/ui/swift-ui';
import { foregroundStyle, frame, padding, glassEffect } from '@expo/ui/swift-ui/modifiers';
import { createContext, useContext, useState, useCallback, useRef } from 'react';
import opacity from 'hex-color-opacity';
import { View } from 'components/ui/View/View';
import { buildExpoRouterHeaderOptions } from '@/components/navigation/expoRouter55';

// Search context for sharing state between layout and index
interface PaymentsSearchContextValue {
  searchQuery: string;
  isSearching: boolean;
  onSearchChange: (query: string) => void;
  onClearSearch: () => void;
}

const PaymentsSearchContext = createContext<PaymentsSearchContextValue | null>(null);

export const usePaymentsSearch = () => {
  const context = useContext(PaymentsSearchContext);
  if (!context) {
    throw new Error('usePaymentsSearch must be used within PaymentsLayout');
  }
  return context;
};

// Native search header component for iOS
function NativeSearchHeader({ width, clearKey }: { width: number; clearKey: number }) {
  const foreground = useThemeColor('foreground');
  const { onSearchChange } = usePaymentsSearch();

  return (
    <View style={{ alignItems: 'center' }}>
      <Host style={{ zIndex: 10, height: 44, width }} matchContents={false}>
        <SwiftUIVStack
          modifiers={[
            padding({ horizontal: 12, vertical: 8 }),
            frame({ width, height: 44, alignment: 'center' }),
            glassEffect(),
          ]}>
          <TextField
            key={clearKey}
            defaultValue=""
            placeholder="Search contacts..."
            onChangeText={onSearchChange}
            keyboardType="web-search"
            autocorrection={false}
            modifiers={[
              foregroundStyle(foreground),
              frame({ maxWidth: Infinity, height: 28, alignment: 'leading' }),
            ]}
          />
        </SwiftUIVStack>
      </Host>
    </View>
  );
}

// Fallback search header for Android - uses uncontrolled pattern for better responsiveness
function FallbackSearchHeader({ clearKey }: { clearKey: number }) {
  const [foreground, surfaceSecondary] = useThemeColor([
    'foreground',
    'surface-secondary',
  ] as const);
  const { onSearchChange } = usePaymentsSearch();
  const inputRef = useRef<TextInput>(null);

  return (
    <View
      style={{
        flex: 1,
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: surfaceSecondary,
        borderRadius: 12,
        paddingHorizontal: 12,
        paddingVertical: 8,
        marginRight: 8,
      }}>
      <TextInput
        key={clearKey}
        ref={inputRef}
        defaultValue=""
        onChangeText={onSearchChange}
        placeholder="Search contacts..."
        placeholderTextColor={opacity(foreground, 0.33)}
        style={{
          flex: 1,
          color: foreground,
          fontSize: 16,
          fontFamily: 'OverpassRegular',
        }}
        keyboardType="web-search"
        autoCorrect={false}
      />
    </View>
  );
}

export default function PaymentsLayout() {
  const iconColor = useThemeColor('foreground');
  const navigation = useNavigation();
  // Search state
  const [searchQuery, setSearchQuery] = useState('');
  // Key to force TextField re-render only when clearing (not on each keystroke)
  const [clearKey, setClearKey] = useState(0);

  const openDrawer = () => {
    navigation.dispatch(DrawerActions.openDrawer());
  };

  const handleSearchChange = useCallback((query: string) => {
    setSearchQuery(query);
  }, []);

  const handleClearSearch = useCallback(() => {
    setSearchQuery('');
    // Increment key to force TextField to re-render with empty value
    setClearKey((prev) => prev + 1);
  }, []);

  const isSearching = searchQuery.trim().length > 0;

  // Use responsive window dimensions for proper layout across device sizes
  const { width: windowWidth } = useWindowDimensions();

  // Calculate width for header - match WalletHeaderTitle calculation
  // 124px for left/right button areas + 24px padding
  const headerWidth = windowWidth - 124 - 24;

  const contextValue: PaymentsSearchContextValue = {
    searchQuery,
    isSearching,
    onSearchChange: handleSearchChange,
    onClearSearch: handleClearSearch,
  };

  return (
    <PaymentsSearchContext.Provider value={contextValue}>
      <Stack
        screenOptions={{
          contentStyle: {
            backgroundColor: 'transparent',
          },
        }}>
        <Stack.Screen
          name="index"
          options={buildExpoRouterHeaderOptions({
            iconColor,
            headerLeftIcon: 'line.3.horizontal',
            onHeaderLeftPress: openDrawer,
            headerRight: () => (
              <Pressable onPress={handleClearSearch} style={{ padding: 8 }}>
                <IconSymbol name="xmark" size={20} color={iconColor} />
              </Pressable>
            ),
            options: {
              headerTransparent: true,
              headerTitle: () =>
                Platform.OS === 'ios' ? (
                  <NativeSearchHeader width={headerWidth} clearKey={clearKey} />
                ) : (
                  <FallbackSearchHeader clearKey={clearKey} />
                ),
            },
          })}
        />
      </Stack>
    </PaymentsSearchContext.Provider>
  );
}
