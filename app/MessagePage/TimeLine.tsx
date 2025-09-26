import MessageComponent from './MessageComponent';
import TransactionComponent from './TransactionComponent';
import { useNostr } from 'helper/redux/nostr';
import CashuTokenComponent from './CashuTokenComponent';
import { isValidEcashToken } from 'helper/cashuClient';
import { Theme } from 'helper/colors';
import { TimelineItemType } from '.';

interface TimelineItemProps {
  theme: Theme;
  item: TimelineItemType;
}

const TimelineItem = ({ item, theme }: TimelineItemProps) => {
  const { currentProfile } = useNostr();

  // Determine item type
  const isMessage = !!item.content;
  const isTransaction = !!item.unit;

  const isTokenMessage = isMessage && isValidEcashToken(item.content);

  // Determine if message is received
  const isMessageReceived =
    isMessage && (item.receiver === currentProfile.pubkey || item.id === -1);
  const isTransactionReceived =
    isTransaction &&
    (item?.nostr?.pubkey === currentProfile.pubkey ||
      (item.receiver && item.receiver === currentProfile.pubkey));

  // Render appropriate component based on item type
  if (isMessage) {
    if (isTokenMessage) {
      return (
        <CashuTokenComponent token={item.content} theme={theme} isReceived={isMessageReceived} />
      );
    }
    return <MessageComponent message={item} theme={theme} isReceived={isMessageReceived} />;
  }

  if (isTransaction) {
    return (
      <TransactionComponent transaction={item} theme={theme} isReceived={isTransactionReceived} />
    );
  }

  return null;
};

export default TimelineItem;
