import { Button } from 'components/common/Button';
import { Text, View } from 'components/common/Themed';
import { Platform, KeyboardAvoidingView, TouchableWithoutFeedback, Keyboard } from 'react-native';
import { Modal as RModal } from 'react-native';
import { useState } from 'react';
import { StyleSheet } from 'react-native';
import { greys, shades } from 'helper/colors';
import { useSelector } from 'react-redux';
import TextInput from '../common/TextInput';
import { memoizedGetTheme } from 'helper/redux/settings';

// Component for Edit Button
export const EditButton = ({
  label,
  description,
  placeholder,
  initialValue,
  onSuccess,
  onCancel,
  component,
}) => {
  const theme = useSelector(memoizedGetTheme);
  const styles = createStyles(theme);

  const [visible, setVisible] = useState(true);
  const [tempDisplayName, setTempDisplayName] = useState(initialValue);

  const handleSave = () => {
    onSuccess(tempDisplayName);
    setVisible(false);
  };

  return (
    <View style={{ backgroundColor: 'transparent' }}>
      {/* <Button
        text={""}
        icon={null}
        position="center"
        style={{}}
        variant="transparent"
        icon={<EditIcon color={shades[100]} />}
        text={initialValue}
        onPress={() => setVisible(true)}
      /> */}
      <RModal
        animationType="slide"
        transparent={true}
        visible={visible}
        onRequestClose={() => setVisible(false)}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={styles.centeredView}>
          <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
            <View style={styles.modalView}>
              <View style={styles.inputContainer}>
                {component ? (
                  component
                ) : (
                  <>
                    <Text style={styles.label}>{label}</Text>
                    <TextInput
                      placeholder={placeholder}
                      placeholderTextColor={greys(theme)[1000]}
                      onChangeText={setTempDisplayName}
                      value={tempDisplayName}
                    />
                    {description && (
                      <Text
                        style={{
                          textAlign: 'center',
                          fontSize: 14,
                          fontFamily: 'OverpassRegular',
                          color: greys(theme)[200],
                          marginBottom: 16,
                        }}>
                        {description}
                      </Text>
                    )}
                  </>
                )}
              </View>
              <View style={styles.buttonContainer}>
                <View style={{ flex: 1, backgroundColor: 'transparent' }}>
                  <Button
                    position="left"
                    variant="secondary"
                    text={"Don't trust"}
                    onPress={() => onCancel()}
                  />
                </View>
                <View style={{ flex: 1, backgroundColor: 'transparent' }}>
                  <Button position="right" variant="primary" text={'Trust'} onPress={handleSave} />
                </View>
              </View>
            </View>
          </TouchableWithoutFeedback>
        </KeyboardAvoidingView>
      </RModal>
    </View>
  );
};

const createStyles = (theme) =>
  StyleSheet.create({
    btcAmount: {
      fontFamily: 'OverpassHeavy',
      fontSize: 10,
      color: greys(theme)[200],
      textAlign: 'right',
      alignSelf: 'flex-end',
    },
    sender: {
      fontFamily: 'OverpassBold',
      fontSize: 14,
      color: greys(theme)[0],
    },
    date: {
      fontFamily: 'OverpassRegular',
      fontSize: 10,
      color: greys(theme)[200],
    },
    centeredView: {
      flex: 1,
      justifyContent: 'flex-end',
      marginTop: 22,
      backgroundColor: 'rgba(0, 0, 0, 0.5)',
    },
    modalView: {
      backgroundColor: 'black',
      borderRadius: 20,
      shadowColor: '#000',
      shadowOffset: {
        width: 0,
        height: 2,
      },
      shadowOpacity: 0.25,
      shadowRadius: 4,
      elevation: 5,
      backgroundColor: greys(theme)[1800],
      borderColor: greys(theme)[1300],
      borderWidth: 0.2,
      // padding: 16,
      paddingBottom: 32,
      paddingTop: 32,
    },
    inputContainer: {
      marginLeft: 4,
      marginRight: 4,
      backgroundColor: 'transparent',
    },
    label: {
      fontSize: 14,
      fontFamily: 'OverpassHeavy',
      color: greys(theme)[1000],
      marginLeft: 16,
      marginBottom: 8,
    },
    buttonContainer: {
      flexDirection: 'row',
      justifyContent: 'center',
      alignItems: 'center',
      marginTop: 8,
      backgroundColor: 'transparent',
    },
    header: {
      textAlign: 'center',
      fontSize: 20,
      fontFamily: 'OverpassHeavy',
      color: shades[300],
    },
    link: {
      backgroundColor: 'transparent',
      width: '100%',
    },
    utxoContainer: {
      flexDirection: 'row',
      borderColor: greys(theme)[1300],
      borderWidth: 0.2,
      borderRadius: 8,
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: 8,
    },
    checkboxContainer: {
      backgroundColor: 'transparent',
      borderRadius: 999999999,
      margin: 16,
    },
    checkbox: {
      backgroundColor: 'transparent',
      padding: 0,
      margin: 0,
    },
    utxoDetails: {
      flexDirection: 'column',
      flex: 1,
      padding: 8,
      backgroundColor: 'transparent',
    },
    utxoHeader: {
      backgroundColor: 'transparent',
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'flex-end',
    },
    utxoFooter: {
      backgroundColor: 'transparent',
      flexDirection: 'row',
      justifyContent: 'space-between',
    },
  });
