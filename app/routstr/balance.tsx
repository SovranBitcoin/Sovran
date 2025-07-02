import React, { useState } from 'react';
import { StyleSheet, Alert } from 'react-native';
import Container from 'components/layout/Container';
import { View } from 'components/common/View';
import { Text } from 'components/common/Text';
import TextInput from 'components/common/TextInput';
import { Button } from 'components/common/Button';
import { useSelector } from 'react-redux';
import { memoizedGetTheme } from 'helper/redux/settings';
import { greys } from 'helper/colors';
import { useRoutstr } from 'helper/redux/routstr';
import { sendEcash } from 'helper/cashu/pay';

export default function RoutstrBalance() {
  const theme = useSelector(memoizedGetTheme);
  const styles = createStyles(theme);
  const { token, balance, setBalance, setLastToken } = useRoutstr();
  const [amount, setAmount] = useState('');

  const fetchInfo = async () => {
    if (!token) return;
    const res = await fetch('https://api.routstr.com/v1/wallet/', {
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = await res.json();
    if (data?.balance !== undefined) {
      setBalance(data.balance);
    }
  };

  const handleTopup = async () => {
    try {
      const tx = await sendEcash({ amount: Number(amount), unit: 'sat' });
      setLastToken(tx.token);
      await fetch(
        `https://api.routstr.com/v1/wallet/topup?cashu_token=${encodeURIComponent(tx.token)}`,
        {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` },
        }
      );
      await fetchInfo();
      Alert.alert('Topup successful');
    } catch (e) {
      Alert.alert('Error', 'Topup failed');
    }
  };

  const handleRefund = async () => {
    try {
      const res = await fetch('https://api.routstr.com/v1/wallet/refund', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (data?.cashu_token) {
        setLastToken(data.cashu_token);
        setBalance(data.new_balance || 0);
        Alert.alert('Refund token received');
      }
    } catch (e) {
      Alert.alert('Error', 'Refund failed');
    }
  };

  return (
    <Container>
      <Text style={styles.balance}>Balance: {balance} sats</Text>
      <View style={styles.row}>
        <TextInput
          keyboardType="numeric"
          value={amount}
          onChangeText={setAmount}
          style={styles.input}
          placeholder="Amount"
        />
        <Button text="Topup" onPress={handleTopup} style={{ marginLeft: 8 }} />
      </View>
      <Button text="Refund" onPress={handleRefund} style={{ marginTop: 16 }} />
    </Container>
  );
}

const createStyles = (theme: string) =>
  StyleSheet.create({
    balance: { marginVertical: 16, color: greys(theme)[0] },
    row: { flexDirection: 'row', alignItems: 'center' },
    input: { flex: 1, padding: 8 },
  });
