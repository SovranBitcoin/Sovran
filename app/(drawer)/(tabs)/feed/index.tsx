import { View } from 'react-native';
import { HomeFeed } from 'components/blocks/HomeFeed';
import { useThemeColor } from '@/hooks/useThemeColor';

export default function FeedScreen() {
  const surface = useThemeColor('surface');
  return (
    <View style={{ flex: 1, backgroundColor: surface }}>
      <HomeFeed />
    </View>
  );
}
