import React, { useMemo } from 'react';
import Modal from 'components/layout/Modal';
import { View } from 'components/common/View';
import { greys } from 'helper/colors';
import { useSelector } from 'react-redux';
import { EventKind } from './Profile';
import { memoizedGetTheme } from 'helper/redux/settings';
import { useTypedRoute } from 'helper/navigation';
import { Post } from './ProfilePage/post';
import { useSubscribe } from '@nostr-dev-kit/ndk-mobile';
import { withSheetProvider } from 'components/hocs/withSheetProvider';

function ParentPosts({ parentPosts }) {
  return (
    <View>
      {parentPosts.map((e) => {
        return <Post key={e} post={e} isResponse />;
      })}
    </View>
  );
}

function Replies({ post }) {
  const filters = useMemo(
    () => [
      {
        '#e': [post?.id],
        kinds: [EventKind.TextNote],
      },
    ],
    [post]
  );

  const { events } = useSubscribe({ filters });

  return (
    <View>
      {events.map((e) => {
        return <Post key={e} post={e} parentPosts={[post]} isResponse />;
      })}
    </View>
  );
}

function ModalScreen() {
  const theme = useSelector(memoizedGetTheme);

  const { event, parentPosts } = useTypedRoute<'post'>();

  return (
    <Modal
      backgroundColor={greys(theme)[800]}
      title=""
      childrenStyles={{
        backgroundColor: greys(theme)[800],
      }}>
      {parentPosts && <ParentPosts parentPosts={parentPosts} />}
      <Post active post={event} parentPosts={parentPosts} />
      <Replies post={event} />
    </Modal>
  );
}

export default withSheetProvider(ModalScreen);
