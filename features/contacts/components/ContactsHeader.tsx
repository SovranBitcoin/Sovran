import { Text, Pressable, StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';
import Animated, {
  useAnimatedStyle,
  withSpring,
  FadeIn,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { SearchHeader } from './search/SearchHeader';
import {
  SEARCH_BAR_HEIGHT,
  SEARCH_FILTERS_HEIGHT,
} from '../lib/constants/styles';
import { HEADER_SPRING_CONFIG } from '../lib/constants/animation-configs';
import { useThemeColor } from '@/shared/hooks/useThemeColor';

type ContactsHeaderProps = {
  isSearching: boolean;
  onSearchOpen: () => void;
  onSearchClose: () => void;
  onQueryChange?: (query: string) => void;
  onFilterChange?: (filter: string) => void;
};

export const ContactsHeader = ({
  isSearching,
  onSearchOpen,
  onSearchClose,
  onQueryChange,
  onFilterChange,
}: ContactsHeaderProps) => {
  const insets = useSafeAreaInsets();
  const [foreground, background] = useThemeColor(['foreground', 'background'] as const);

  const searchHeaderHeight = insets.top + 18 + SEARCH_BAR_HEIGHT + SEARCH_FILTERS_HEIGHT;
  const defaultHeaderHeight = insets.top + 50;

  const rContainerStyle = useAnimatedStyle(() => {
    return {
      height: withSpring(
        isSearching ? searchHeaderHeight : defaultHeaderHeight,
        HEADER_SPRING_CONFIG
      ),
    };
  });

  return (
    <Animated.View
      style={[
        styles.container,
        { paddingTop: insets.top + 12, backgroundColor: background },
        rContainerStyle,
      ]}>
      {isSearching ? (
        <SearchHeader
          onClose={onSearchClose}
          onQueryChange={onQueryChange}
          onFilterChange={onFilterChange}
        />
      ) : (
        <Animated.View
          entering={FadeIn.duration(150)}
          style={styles.defaultHeader}>
          <Text style={[styles.title, { color: foreground }]}>Contacts</Text>
          <Pressable onPress={onSearchOpen} hitSlop={8} style={styles.searchAction}>
            <Feather name="search" size={22} color={foreground} />
          </Pressable>
        </Animated.View>
      )}
    </Animated.View>
  );
};

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: 20,
  },
  defaultHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    fontSize: 22,
    fontWeight: '700',
  },
  searchAction: {
    position: 'absolute',
    right: 0,
  },
});
