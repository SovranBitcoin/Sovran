import React from 'react';
import { Button } from 'components/common/Button';
import { Linking } from 'react-native';
import Icon from 'assets/icons';
import { useSelector } from 'react-redux';
import { memoizedGetTheme } from 'helper/redux/settings';
import { Card } from 'components/common/Card';
import Container from 'components/layout/Container';

export default function ModalScreen() {
  const theme = useSelector(memoizedGetTheme);

  return (
    <Container>
      <Card
        message="Sovran is currently in Beta, please use with caution and don't put on
          more sats than you are willing to lose. If you discover any bugs
          please report them so we can improve it!"
        theme={theme}
        variant="info"
      />

      <Button
        variant="secondary"
        onPress={() => {
          Linking.openURL('https://x.com/SovranBitcoin');
        }}
        text={'Follow us on X'}
        icon={<Icon name="lucide:twitter" />}
      />
    </Container>
  );
}
