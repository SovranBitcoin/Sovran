import { JSX, useMemo } from 'react';
import { View } from 'components/common/Themed';
import Icon from 'assets/icons';
import CachedImage from 'components/common/Image';
import { useSelector } from 'react-redux';
import { memoizedGetTheme } from 'helper/redux/settings';
import { greys } from 'helper/colors';
import { useNostr } from 'helper/redux/nostr';
import _ from 'lodash';
import { getDecodedToken } from '@cashu/cashu-ts';
import { convertNpub } from 'app/(drawer)/(tabs)/payments';

export default function TransactionIcon({ transaction }: any): JSX.Element {
  const theme = useSelector(memoizedGetTheme);
  const { search, profiles } = useNostr();

  const isReceive = transaction.transactionType === 'receive';
  const isSend = transaction.transactionType === 'send';

  const profilePicture = useMemo(() => {
    const getPicture = (arr?: any[]) => {
      const item = _.find(arr, {
        pubkey: transaction.nostrPubkey,
      });
      return (
        _.get(item, 'profile.picture') ||
        _.get(item, 'picture') ||
        _.get(item, 'profile.image') ||
        _.get(item, 'image')
      );
    };

    return getPicture(search) || getPicture(profiles);
  }, [search, profiles, transaction]);

  const StatusIndicator = () => (
    <View
      className="absolute -bottom-2 -right-2 z-10 rounded-full"
      style={{
        backgroundColor: greys(theme)[1500],
        borderRadius: 100,
        height: 16,
        width: 16,
        padding: 3,
        borderColor: greys(theme)[1300],
      }}>
      {transaction.isP2PK ? (
        <Icon name="solar:key-bold" color={greys(theme)[100]} size={10} />
      ) : transaction.fromNIP05 ? (
        <Icon name="mdi:at" color={greys(theme)[100]} size={10} />
      ) : transaction.isCancel ? (
        <Icon name="mdi:cancel" color={greys(theme)[100]} size={10} />
      ) : (
        <Icon
          name={isReceive ? 'fluent:arrow-download-16-filled' : 'fluent:arrow-upload-16-filled'}
          color={greys(theme)[100]}
          size={10}
        />
      )}
    </View>
  );

  if (profilePicture) {
    return (
      <View className="relative h-7 w-7 bg-transparent">
        <StatusIndicator />
        <CachedImage
          style={{
            width: 28,
            height: 28,
            borderRadius: 1000,
            borderColor: greys(theme)[1500],
            borderWidth: 1,
          }}
          source={{ uri: profilePicture }}
        />
      </View>
    );
  }

  if (isReceive) {
    return (
      <View className="relative h-7 w-7 bg-transparent">
        <Icon name="fluent:arrow-download-16-filled" color={greys(theme)[100]} />
      </View>
    );
  }

  if (transaction.isCancel) {
    return (
      <View className="relative h-7 w-7 bg-transparent">
        <Icon name="mdi:cancel" color={greys(theme)[100]} />
      </View>
    );
  }

  if (isSend) {
    return (
      <View className="relative h-7 w-7 bg-transparent">
        <Icon name="fluent:arrow-upload-16-filled" color={greys(theme)[100]} />
      </View>
    );
  }
}
