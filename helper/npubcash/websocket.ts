import { nip19 } from 'nostr-tools';
import { NsecSigner } from '../third-party/cashu-address-sdk-rn/signer';
import { createAuthTemplate } from '../third-party/cashu-address-sdk-rn/utils';
import { isProduction } from '../version';
import { Alert } from 'react-native';
import { nip98 } from 'nostr-tools';

export async function openNpubxWebSocket({
  nsec,
  onUpdate,
}: {
  nsec: string;
  onUpdate: (quoteId: string) => void;
}): Promise<WebSocket> {
  const sk = nip19.decode(nsec).data as Uint8Array;
  const signer = new NsecSigner(sk);
  const protocol = 'wss';
  const ws = new WebSocket(`${protocol}://npubx.cash/api/v2/ws/quote`);
  console.log('npubx ws', ws);

  ws.onmessage = async (event) => {
    console.log('npubx ws message', event);
    try {
      const msg = JSON.parse(event.data);
      console.log('npubx ws message', msg);

      if (msg.type === 'challenge') {
        const token = await nip98.getToken(
          msg.payload.url,
          'GET',
          (e) => signer.signEvent(e),
          true
        );
        console.log('npubx ws token', token);

        // Send the raw token, not the unpacked event
        ws.send(JSON.stringify({ type: 'challenge-response', payload: token }));
      } else if (msg.type === 'update') {
        // {"payload": {"quoteId": "4W-NPWd1glZWs2UHrtXTndNvwgbhu7Dqcgl-17YO"}, "type": "update"}
        Alert.alert('Update', msg.payload.quoteId);
      } else if (msg.type === 'challenge-success') {
        console.log('WebSocket authentication successful');
      } else if (msg.type === 'error') {
        console.error('WebSocket error:', msg.payload);
      }
    } catch (err) {
      console.error('npubx ws error', err);
    }
  };

  return ws;
}
