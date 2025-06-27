import 'react-native-get-random-values';
import React, { useState } from 'react';
import { Alert, StyleSheet, KeyboardAvoidingView, Platform, ScrollView } from 'react-native';
import { View } from 'components/common/View';
import { Text } from 'components/common/Text';
import Modal from 'components/layout/Modal';
import { greys } from 'helper/colors';
import { useNostr } from 'helper/redux/nostr';
import { Button } from 'components/common/Button';
import { useSelector } from 'react-redux';
import { getPublicKey, nip19 } from 'nostr-tools';
import CachedImage from 'components/common/Image';
import TextInput from 'components/common/TextInput';
import { memoizedGetTheme } from 'helper/redux/settings';
import { withSheetProvider } from 'components/hocs/withSheetProvider';

function ModalScreen() {
  const theme = useSelector(memoizedGetTheme);
  const styles = createStyles(theme);

  const { profiles, currentProfile, setProfiles } = useNostr();
  const [nsec, setNsec] = useState('');

  const handleSave = () => {
    if (!nsec) {
      Alert.alert('Error', 'Please enter a private key');
      return;
    }

    let { data: sk } = nip19.decode(nsec);
    const pk = getPublicKey(sk as Uint8Array);
    const npub = nip19.npubEncode(pk);

    // check npub matches currentProfile.npub
    if (npub !== currentProfile.npub) {
      Alert.alert('Error', 'Public key does not match');
      return;
    }

    // check pubkey matches currentProfile.pubkey
    if (pk !== currentProfile.pubkey) {
      Alert.alert('Error', 'Public key does not match');
      return;
    }

    setProfiles(
      profiles.map((p) => {
        if (p.pubkey === currentProfile.pubkey) {
          return {
            ...p,
            nsec,
          };
        }
        return p;
      })
    );
  };

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <ScrollView contentContainerStyle={{ flexGrow: 1 }}>
        <Modal
          title="Profile Settings"
          buttons={
            <>
              <Button variant="primary" text="Save" onPress={handleSave}></Button>
            </>
          }>
          <View
            style={{
              margin: 16,
              backgroundColor: 'transparent',
            }}>
            <View
              style={{
                backgroundColor: 'transparent',
              }}>
              <CachedImage
                source={{ uri: currentProfile.picture }}
                style={styles.modalProfilePicture}
              />
            </View>
            <Text
              style={{
                fontSize: 16,
                fontFamily: 'OverpassHeavy',
                marginLeft: 12,
              }}>
              NPUB
            </Text>
            <TextInput
              placeholder={''}
              editable={false}
              placeholderTextColor={theme.greys[1000]}
              value={currentProfile?.npub}
            />
            <Text
              style={{
                fontSize: 16,
                fontFamily: 'OverpassHeavy',
                marginLeft: 12,
              }}>
              Public key
            </Text>
            <TextInput
              placeholder={''}
              editable={false}
              placeholderTextColor={theme.greys[1000]}
              value={currentProfile?.pubkey}
            />
            <Text
              style={{
                fontSize: 16,
                fontFamily: 'OverpassHeavy',
                marginLeft: 12,
              }}>
              NSEC
            </Text>
            <TextInput
              placeholder={''}
              placeholderTextColor={theme.greys[1000]}
              editable={currentProfile?.nsec ? false : true}
              onChangeText={(text) => setNsec(text)}
              value={currentProfile?.nsec}
            />
            <View
              style={{
                backgroundColor: theme.shades[200],
                padding: 16,
                borderRadius: 16,
              }}>
              <Text
                style={{
                  fontSize: 16,
                  fontFamily: 'OverpassBold',
                }}>
                Add your nsec to enable useful features like:
              </Text>
              <Text
                style={{
                  fontSize: 16,
                  fontFamily: 'OverpassRegular',
                  marginLeft: 0,
                }}>
                • Sending and receiving messages
              </Text>
              <Text
                style={{
                  fontSize: 16,
                  fontFamily: 'OverpassRegular',
                  marginLeft: 0,
                }}>
                • Generating easy to use receive address
              </Text>
            </View>
          </View>
        </Modal>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const createStyles = (theme: any) =>
  StyleSheet.create({
    minus: {
      fontFamily: 'OverpassBold',
      fontSize: 32,
      color: '#9A4141',
      marginRight: 4,
    },
    plus: {
      fontFamily: 'OverpassBold',
      fontSize: 32,
      color: '#499A41',
      marginRight: 4,
    },
    container: {
      backgroundColor: theme.greys[2300],
    },
    title: {
      fontSize: 20,
      fontWeight: 'bold',
      color: theme.greys[1000],
    },
    separator: {
      marginVertical: 30,
      height: 1,
      width: '80%',
    },
    cornerBox: {
      position: 'absolute',
      borderRadius: 32,
      zIndex: 100,
      backgroundColor: 'transparent',
      overflow: 'hidden',
    },
    innerBorder: {
      position: 'absolute',
      borderWidth: 2,
      borderColor: theme.greys[0],
      borderRadius: 32,
      zIndex: 100,
      backgroundColor: 'transparent',
    },
    barCodeScanner: {
      position: 'absolute',
      width: '100%',
      height: '100%',
    },
    modalProfilePicture: {
      alignSelf: 'center',
      width: 64,
      height: 64,
      borderRadius: 32,
      marginBottom: 16,
      backgroundColor: theme.greys[0],
    },
  });

export default withSheetProvider(ModalScreen);
