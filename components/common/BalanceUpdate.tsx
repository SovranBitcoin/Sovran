import { Text, View } from 'components/common/Themed';
import Icon from 'assets/icons';
import { useSelector } from 'react-redux'; // Import useDispatch from react-redux
import { useNostr } from 'helper/redux/nostr';
import { greens, greys, shades } from 'helper/colors';
import opacity from 'hex-color-opacity';
import { useEsims } from 'helper/redux/esim';

import CachedImage from 'components/common/Image';
import { memoizedGetTheme } from 'helper/redux/settings';
import { AmountFormatter } from 'components/common/AmountFormatter';

export function BalanceUpdate({ transactionType, amount, unit, pubkey, request, transaction }) {
  const theme = useSelector(memoizedGetTheme);
  const { search, profiles } = useNostr();
  const profilePicture =
    search?.find((s) => s.pubkey === pubkey)?.profile?.picture ||
    profiles?.find((s) => s.pubkey === pubkey)?.picture ||
    search?.find((s) => s.pubkey === pubkey)?.profile?.image ||
    profiles?.find((s) => s.pubkey === pubkey)?.image ||
    search?.find((s) => s.pubkey === pubkey)?.profile?.picture;
  const { esims } = useEsims();

  return (
    <View
      style={{
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        padding: 16,
        paddingLeft: 8,
        backgroundColor: 'transparent',
      }}>
      <View
        style={{
          backgroundColor: 'transparent',
        }}>
        <View
          style={{
            flexDirection: 'row',
            backgroundColor: 'transparent',
            alignItems: 'center',
          }}>
          {transactionType === 'send' ? (
            <Text
              size={32}
              weight="bold"
              style={{
                color: shades[300],
                marginRight: 0,
                marginLeft: 8,
              }}>
              -
            </Text>
          ) : (
            transactionType === 'receive' && (
              <Text
                weight="bold"
                size={24}
                style={{
                  color: greens[300],
                  textShadowColor: opacity(greys(theme)[0], 0.5),
                  textShadowOffset: { width: 0, height: 0 },
                  textShadowRadius: 1,
                  marginRight: 0,
                  marginLeft: 8,
                }}>
                +
              </Text>
            )
          )}
          <AmountFormatter
            amount={amount}
            unit={unit}
            size={28}
            weight="heavy"
            color={transactionType === 'receive' ? greens[300] : shades[300]}
          />
        </View>
        <Text
          size={18}
          style={{
            color: greys(theme)[100],
            marginLeft: 30,
            fontFamily: 'OverpassBold',
            backgroundColor: 'transparent',
          }}>
          {amount < 0 ? '-' : ''}
        </Text>
      </View>
      <View
        style={{
          padding: 16,
          backgroundColor: 'transparent',
          transform: [{ scale: 1.25 }],
        }}>
        {profilePicture ? (
          <View
            style={{
              position: 'relative',
              width: 28,
              height: 28,
              backgroundColor: 'transparent',
            }}>
            <View
              style={{
                position: 'absolute',
                bottom: -4,
                right: -4,
                zIndex: 100,
                backgroundColor: greys(theme)[1800],
                borderRadius: 100,
                height: 16,
                width: 16,
                padding: 3,
                borderColor: greys(theme)[1300],
                borderWidth: 0.2,
              }}>
              {transactionType === 'receive' ? (
                <Icon name="fluent:arrow-download-16-filled" color={greys(theme)[100]} size={10} />
              ) : transaction?.isCancel ? (
                <Icon name="mdi:cancel" color={greys(theme)[100]} size={10} />
              ) : (
                <Icon name="fluent:arrow-upload-16-filled" color={greys(theme)[100]} size={10} />
              )}
            </View>
            <CachedImage
              style={{
                width: 28,
                height: 28,
                borderRadius: 1000,
                borderColor: greys(theme)[1300],
                borderWidth: 0.2,
              }}
              source={{
                uri: profilePicture,
              }}
            />
          </View>
        ) : transactionType === 'receive' ? (
          <View
            style={{
              position: 'relative',
              width: 28,
              height: 28,
              backgroundColor: 'transparent',
            }}>
            <Icon name="fluent:arrow-download-16-filled" color={greys(theme)[100]} />
          </View>
        ) : esims
            .map((e) => e.request)
            .filter((a) => a)
            .includes(request) ? (
          <View
            style={{
              position: 'relative',
              width: 28,
              height: 28,
              backgroundColor: 'transparent',
            }}>
            <View
              style={{
                position: 'absolute',
                bottom: -4,
                right: -4,
                zIndex: 100,
                backgroundColor: greys(theme)[1800],
                borderRadius: 100,
                height: 16,
                width: 16,
                padding: 3,
                borderColor: greys(theme)[1300],
                borderWidth: 0.2,
              }}>
              {transaction?.isCancel ? (
                <Icon name="mdi:cancel" color={greys(theme)[100]} />
              ) : (
                <Icon name="fluent:arrow-upload-16-filled" color={greys(theme)[100]} />
              )}
            </View>
            <Icon name="fluent:sim-24-filled" color={greys(theme)[100]} />
          </View>
        ) : (
          <View
            style={{
              position: 'relative',
              width: 28,
              height: 28,
              backgroundColor: 'transparent',
            }}>
            {transaction?.isCancel ? (
              <Icon name="mdi:cancel" color={greys(theme)[100]} />
            ) : (
              <Icon name="fluent:arrow-upload-16-filled" color={greys(theme)[100]} />
            )}
          </View>
        )}
      </View>
    </View>
  );
}
