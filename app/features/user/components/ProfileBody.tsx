import type { ReactElement } from 'react';
import { StyleSheet, type NativeScrollEvent, type NativeSyntheticEvent } from 'react-native';
import { List } from '@/shared/ui/composed/List';

type Props = {
  pubkey?: string;
  ListHeaderComponent?: ReactElement | null;
  onScroll?: (event: NativeSyntheticEvent<NativeScrollEvent>) => void;
  [key: string]: unknown;
};

/**
 * The scrolling body of a profile: header-only list so the profile header keeps
 * its scroll-driven morph without fetching any social posts.
 */
export function ProfileBody(props: Props) {
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
