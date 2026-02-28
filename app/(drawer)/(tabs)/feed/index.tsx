import { View } from 'react-native';
import { HomeFeed } from 'components/blocks/HomeFeed';
import { useTheme } from 'providers/ThemeProvider';

export default function FeedScreen() {
  const { getPrimaryColor } = useTheme();
  return (
    <View style={{ flex: 1, backgroundColor: getPrimaryColor('900') }}>
      <HomeFeed />
    </View>
  );
}
