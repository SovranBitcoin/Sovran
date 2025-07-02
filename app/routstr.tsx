import React, { useEffect, useState } from 'react';
import { StyleSheet, FlatList, Alert } from 'react-native';
import Container from 'components/layout/Container';
import { View } from 'components/common/View';
import { Text } from 'components/common/Text';
import TextInput from 'components/common/TextInput';
import { Button } from 'components/common/Button';
import Icon from 'assets/icons';
import { useSelector } from 'react-redux';
import { memoizedGetTheme } from 'helper/redux/settings';
import { useTypedNavigation } from 'helper/navigation';
import { memoizedGetBalance } from 'helper/redux/cashu';
import { useRoutstr } from 'helper/redux/routstr';
import { SheetManager } from 'react-native-actions-sheet';
import { greys } from 'helper/colors';

const MIN_BALANCE = 1000;

export default function RoutstrChat() {
  const theme = useSelector(memoizedGetTheme);
  const styles = createStyles(theme);
  const balance = useSelector(memoizedGetBalance('sat'));
  const navigation = useTypedNavigation();
  const {
    token,
    balance: routstrBalance,
    currentSession,
    sessions,
    createSession,
    addMessage,
    setCurrentSession,
    lastToken,
  } = useRoutstr();
  const [input, setInput] = useState('');

  useEffect(() => {
    if (!currentSession) {
      const id = Date.now().toString();
      createSession(id);
    }
  }, []);

  const openSessionSheet = () => {
    SheetManager.show('routstr-session', {
      payload: { sessions, current: currentSession?.id },
    });
  };

  const handleNewSession = () => {
    const id = Date.now().toString();
    createSession(id);
  };

  const handleSend = async () => {
    if (!token) {
      Alert.alert('No token found');
      return;
    }
    if (routstrBalance < MIN_BALANCE) {
      Alert.alert('Balance too low, please topup');
      return;
    }
    if (!currentSession) return;
    addMessage(currentSession.id, { role: 'user', content: input });
    setInput('');
    try {
      const res = await fetch('https://api.routstr.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'gpt-4',
          messages: [...currentSession.messages, { role: 'user', content: input }],
        }),
      });
      const data = await res.json();
      const reply = data?.choices?.[0]?.message;
      if (reply) {
        addMessage(currentSession.id, reply);
      }
    } catch (e) {
      Alert.alert('Error', 'Failed to fetch response');
    }
  };

  const renderItem = ({ item }) => (
    <View style={styles.messageItem}>
      <Text>
        {item.role === 'user' ? 'You' : 'AI'}: {item.content}
      </Text>
    </View>
  );

  return (
    <Container>
      <View style={styles.header}>
        <Button
          variant="secondary"
          icon={<Icon name="mdi:menu" />}
          onPress={openSessionSheet}
          style={styles.iconButton}
        />
        <Button
          variant="secondary"
          icon={<Icon name="mdi:plus" />}
          onPress={handleNewSession}
          style={styles.iconButton}
        />
      </View>
      <Text style={styles.balance} onPress={() => navigation.navigate('routstr/balance')}>
        Balance: {routstrBalance} sats
      </Text>
      <FlatList
        data={currentSession?.messages || []}
        renderItem={renderItem}
        keyExtractor={(_, i) => i.toString()}
        style={styles.list}
      />
      <View style={styles.inputRow}>
        <TextInput style={styles.input} value={input} onChangeText={setInput} />
        <Button variant="primary" onPress={handleSend} text="Send" style={{ marginLeft: 8 }} />
      </View>
    </Container>
  );
}

const createStyles = (theme: string) =>
  StyleSheet.create({
    header: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginTop: 16,
    },
    iconButton: { width: 48, height: 48 },
    balance: { marginVertical: 8, color: greys(theme)[0] },
    list: { flex: 1 },
    inputRow: { flexDirection: 'row', marginBottom: 16 },
    input: { flex: 1, padding: 8 },
    messageItem: { marginVertical: 4 },
  });
