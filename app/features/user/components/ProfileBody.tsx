import type { ComponentProps } from 'react';
import { StyleSheet } from 'react-native';
import { UserFeed } from '@/features/feed';
import { hasFeature } from '@/shared/config/features';
import { List } from '@/shared/ui/composed/List';

type Props = ComponentProps<typeof UserFeed>;

/**
 * The scrolling body of a profile: the header, and beneath it the person's
 * posts when the build ships the feed (ADR 0021). Without the feed it is the
 * same list in header-only form, so nothing is fetched and the header keeps
 * its scroll-driven morph.
 */
export function ProfileBody(props: Props) {
  if (hasFeature('feed')) return <UserFeed {...props} />;
  return (
    <List
      screen
      data={[] as never[]}
      renderItem={() => null}
      ListHeaderComponent={props.ListHeaderComponent}
      style={styles.flexOne}
      showsVerticalScrollIndicator={false}
      onScroll={props.onScroll}
      scrollEventThrottle={16}
    />
  );
}

const styles = StyleSheet.create({
  flexOne: { flex: 1 },
});
