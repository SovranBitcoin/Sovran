import React from 'react';
import { View, TouchableOpacity } from 'react-native';
import { Text } from 'components/common/Text';
import { useSelector } from 'react-redux';
import { memoizedGetTheme } from 'helper/redux/settings';
import { greys } from 'helper/colors';
import { RouteScreenProps, useSheetPayload } from 'react-native-actions-sheet';
import { useRoutstr } from 'helper/redux/routstr';

const RouteA = ({ router }: RouteScreenProps<'routstr-session', 'route-a'>) => {
  const theme = useSelector(memoizedGetTheme);
  const styles = createStyles(theme);
  const payload = useSheetPayload('routstr-session');
  const { sessions, setCurrentSession, createSession } = useRoutstr();

  return (
    <View style={styles.container}>
      {sessions.map((s) => (
        <TouchableOpacity
          key={s.id}
          style={styles.item}
          onPress={() => {
            setCurrentSession(s.id);
            router?.goBack();
          }}>
          <Text style={styles.text}>{s.id}</Text>
        </TouchableOpacity>
      ))}
      <TouchableOpacity
        style={styles.item}
        onPress={() => {
          const id = Date.now().toString();
          createSession(id);
          router?.goBack();
        }}>
        <Text style={styles.text}>New Session</Text>
      </TouchableOpacity>
    </View>
  );
};

const createStyles = (theme: string) => ({
  container: { padding: 16 },
  item: {
    padding: 12,
    backgroundColor: greys(theme)[700],
    borderRadius: 8,
    marginBottom: 8,
  },
  text: { color: greys(theme)[0] },
});

export default RouteA;
