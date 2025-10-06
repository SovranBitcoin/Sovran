import { TextMessage, PaymentMessage, CashuTokenMessage } from './components';
import { useNostr } from 'helper/redux/nostr';
import { useCashuUtilities } from 'hooks/coco';
import { useTheme } from 'providers/ThemeProvider';
import { TimelineItemType } from '.';

interface TimelineItemProps {
  item: TimelineItemType;
}

const TimelineItem = ({ item }: TimelineItemProps) => {
  const { isValidEcashToken } = useCashuUtilities();
  const { currentProfile } = useNostr();
  const { getPrimaryColor } = useTheme();

  // Determine item type
  const isMessage = 'content' in item && !!item.content;
  const isTransaction = 'unit' in item && !!item.unit;

  const isTokenMessage = isMessage && isValidEcashToken(item.content);

  // Determine if message is received
  const isMessageReceived =
    isMessage && (item.receiver === currentProfile?.pubkey || item.id === -1);
  const isTransactionReceived =
    isTransaction &&
    (('nostr' in item && item.nostr?.pubkey === currentProfile?.pubkey) ||
      (item.receiver && item.receiver === currentProfile?.pubkey));

  if (isTokenMessage) {
    return <CashuTokenMessage token={item.content} isReceived={isMessageReceived} />;
  }

  if (isMessage) {
    return <TextMessage message={item as any} isReceived={isMessageReceived} />;
  }

  if (isTransaction) {
    return <PaymentMessage transaction={item as any} isReceived={isTransactionReceived} />;
  }

  return null;
};

export default TimelineItem;
