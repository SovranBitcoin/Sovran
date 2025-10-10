import { TextMessage, CashuTokenMessage } from './components';
import { useNostr } from 'redux/nostr';
import { isValidEcashToken } from '@/helper/coco/utils';
import { TimelineItemType } from 'app/userMessages';

interface TimelineItemProps {
  item: TimelineItemType;
}

const TimelineItem = ({ item }: TimelineItemProps) => {
  const { currentProfile } = useNostr();

  const isMessage = 'content' in item && !!item.content;

  const isTokenMessage = isMessage && isValidEcashToken(item.content);

  const isMessageReceived =
    isMessage && (item.receiver === currentProfile?.pubkey || item.id === '-1');

  if (isTokenMessage) {
    return <CashuTokenMessage token={item.content} isReceived={isMessageReceived} />;
  }

  if (isMessage) {
    return <TextMessage message={item as any} isReceived={isMessageReceived} />;
  }

  return null;
};

export default TimelineItem;
