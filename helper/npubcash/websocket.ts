import { nip19 } from 'nostr-tools';
import { NsecSigner } from '../third-party/cashu-address-sdk-rn/signer';
import { createAuthTemplate } from '../third-party/cashu-address-sdk-rn/utils';
import { isProduction } from '../version';

export function openNpubxWebSocket({
  nsec,
  onUpdate,
}: {
  nsec: string;
  onUpdate: (quoteId: string) => void;
}): WebSocket {
  const sk = nip19.decode(nsec).data as Uint8Array;
  const signer = new NsecSigner(sk);
  const protocol = isProduction ? 'wss' : 'ws';
  const ws = new WebSocket(`${protocol}://npubx.cash/api/v2/ws/quote`);

  ws.onmessage = async (event) => {
    try {
      const msg = JSON.parse(event.data);
      if (msg.type === 'challenge') {
        const auth = createAuthTemplate(msg.payload.url, msg.payload.method);
        const signed = await signer.signEvent(auth);
        ws.send(
          JSON.stringify({ type: 'challenge-response', payload: signed })
        );
      } else if (msg.type === 'update') {
        onUpdate?.(msg.payload.quoteId);
      }
    } catch (err) {
      console.error('npubx ws error', err);
    }
  };

  return ws;
}
