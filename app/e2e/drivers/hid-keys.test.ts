import { describe, expect, it } from 'bun:test';

import { hidKeystrokeFor, hidKeystrokesFor, LEFT_SHIFT_USAGE } from './hid-keys';
import { typeKeystrokes } from './simctl';

describe('HID key mapping', () => {
  it('maps the testnut URL to plain and shifted usages', () => {
    const strokes = hidKeystrokesFor('https://testnut.cashu.space');
    expect(strokes).toHaveLength('https://testnut.cashu.space'.length);
    // h t t p s
    expect(strokes[0]).toEqual({ usage: 0x0b, shift: false });
    // ':' is shift+';' on the US layout
    expect(strokes[5]).toEqual({ usage: 0x33, shift: true });
    expect(strokes[6]).toEqual({ usage: 0x38, shift: false }); // '/'
    expect(strokes.filter(({ shift }) => shift)).toHaveLength(1);
  });

  it('maps letters, digits, and shifted symbols', () => {
    expect(hidKeystrokeFor('a')).toEqual({ usage: 0x04, shift: false });
    expect(hidKeystrokeFor('Z')).toEqual({ usage: 0x1d, shift: true });
    expect(hidKeystrokeFor('0')).toEqual({ usage: 0x27, shift: false });
    expect(hidKeystrokeFor('.')).toEqual({ usage: 0x37, shift: false });
    expect(hidKeystrokeFor('_')).toEqual({ usage: 0x2d, shift: true });
    expect(hidKeystrokeFor('?')).toEqual({ usage: 0x38, shift: true });
    expect(hidKeystrokeFor(' ')).toEqual({ usage: 0x2c, shift: false });
  });

  it('refuses characters outside the US layout instead of typing garbage', () => {
    expect(() => hidKeystrokeFor('é')).toThrow(/no US-layout HID mapping/);
    expect(() => hidKeystrokesFor('mint€url')).toThrow(/no US-layout HID mapping/);
  });
});

describe('typeKeystrokes framing', () => {
  it('sends one socket of type-4 packets with shift held around shifted keys', async () => {
    const sent: { type: string; usage: number }[] = [];
    let closed = 0;
    const socket = {
      binaryType: 'arraybuffer',
      onopen: null as (() => void) | null,
      onerror: null,
      onclose: null,
      send(packet: Uint8Array) {
        expect(packet[0]).toBe(4);
        sent.push(JSON.parse(new TextDecoder().decode(packet.slice(1))));
      },
      close() {
        closed++;
      },
    };
    queueMicrotask(() => socket.onopen?.());

    await typeKeystrokes(
      'ws://test',
      [
        { usage: 0x0b, shift: false },
        { usage: 0x33, shift: true },
      ],
      LEFT_SHIFT_USAGE,
      {
        createSocket: () => socket as never,
        wait: async () => {},
      }
    );

    expect(sent).toEqual([
      { type: 'down', usage: 0x0b },
      { type: 'up', usage: 0x0b },
      { type: 'down', usage: LEFT_SHIFT_USAGE },
      { type: 'down', usage: 0x33 },
      { type: 'up', usage: 0x33 },
      { type: 'up', usage: LEFT_SHIFT_USAGE },
    ]);
    expect(closed).toBe(1);
  });
});
