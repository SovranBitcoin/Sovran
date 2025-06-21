import { View } from 'components/common/Themed';
import Icon from 'assets/icons';
import CachedImage from 'components/common/Image';
import { useSelector } from 'react-redux';
import { memoizedGetTheme } from 'helper/redux/settings';
import { greys } from 'helper/colors';
import { memoizedGetNostrProfile } from 'helper/redux/nostr';

export default function TransactionIcon({ transaction }: any): React.ReactNode {
  const theme = useSelector(memoizedGetTheme);
  const nostrData = useSelector(memoizedGetNostrProfile({ nostrPubkey: transaction.nostrPubkey }));

  const StatusIndicator = ({ size, type }: { size: number; type: string }) => (
    <View
      className={type === 'small' ? 'absolute -bottom-2 -right-2 z-10 rounded-full' : ''}
      style={
        type === 'small'
          ? {
              backgroundColor: greys(theme)[1500],
              borderRadius: 100,
              height: size + 6,
              width: size + 6,
              padding: 3,
              borderColor: greys(theme)[1300],
            }
          : {}
      }>
      {transaction.isP2PK ? (
        <Icon name="solar:key-bold" color={greys(theme)[100]} size={size} />
      ) : transaction.fromNIP05 ? (
        <Icon name="mdi:at" color={greys(theme)[100]} size={size} />
      ) : transaction.isCancel ? (
        <Icon name="mdi:cancel" color={greys(theme)[100]} size={size} />
      ) : (
        <Icon
          name={
            transaction.isReceive
              ? 'fluent:arrow-download-16-filled'
              : 'fluent:arrow-upload-16-filled'
          }
          color={greys(theme)[100]}
          size={size}
        />
      )}
    </View>
  );

  return (
    <View className="relative h-7 w-7 bg-transparent">
      <StatusIndicator
        size={nostrData?.profile?.picture ? 10 : 28}
        type={nostrData?.profile?.picture ? 'small' : 'large'}
      />
      {nostrData?.profile?.picture && (
        <CachedImage
          style={{
            width: 28,
            height: 28,
            borderRadius: 1000,
            borderColor: greys(theme)[1500],
            borderWidth: 1,
          }}
          source={{ uri: nostrData?.profile?.picture }}
        />
      )}
    </View>
  );
}
