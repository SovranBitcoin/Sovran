import { TextMessage, CashuTokenMessage } from './components';
import { isValidEcashToken } from '@/helper/coco/utils';
import { TimelineItemType } from 'app/userMessages';
import { useNostrKeysContext } from 'providers/NostrKeysProvider';

interface TimelineItemProps {
  item: TimelineItemType;
}

const TimelineItem = ({ item }: TimelineItemProps) => {
  const { keys: nostrKeys } = useNostrKeysContext();

  const isMessage = 'content' in item && !!item.content;

  const isTokenMessage = isMessage && isValidEcashToken(item.content);

  const isMessageReceived = isMessage && (item.receiver === nostrKeys?.pubkey || item.id === '-1');

  if (isTokenMessage) {
    return <CashuTokenMessage token={item.content} isReceived={isMessageReceived} />;
  }

  if (isMessage) {
    return <TextMessage message={item as any} isReceived={isMessageReceived} />;
  }

  return null;
};

export default TimelineItem;
