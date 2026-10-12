import { expect, test } from 'bun:test';
import { keyPresses } from './keys';

test('a mint address is typed with the keys a US keyboard has for it', () => {
  expect(keyPresses('https://a.b/1?x=A_')).toEqual([
    { usage: 0x0b, shift: false }, // h
    { usage: 0x17, shift: false }, // t
    { usage: 0x17, shift: false }, // t
    { usage: 0x13, shift: false }, // p
    { usage: 0x16, shift: false }, // s
    { usage: 0x33, shift: true }, // :
    { usage: 0x38, shift: false }, // /
    { usage: 0x38, shift: false }, // /
    { usage: 0x04, shift: false }, // a
    { usage: 0x37, shift: false }, // .
    { usage: 0x05, shift: false }, // b
    { usage: 0x38, shift: false }, // /
    { usage: 0x1e, shift: false }, // 1
    { usage: 0x38, shift: true }, // ?
    { usage: 0x1b, shift: false }, // x
    { usage: 0x2e, shift: false }, // =
    { usage: 0x04, shift: true }, // A
    { usage: 0x2d, shift: true }, // _
  ]);
});

test('a hash is Shift and 3, not the key a US keyboard lacks', () => {
  expect(keyPresses('#')).toEqual([{ usage: 0x20, shift: true }]);
});

test('digits and a space', () => {
  expect(keyPresses('10 0').map((key) => key.usage)).toEqual([0x1e, 0x27, 0x2c, 0x27]);
});

test('a character with no key is refused by name', () => {
  expect(() => keyPresses('café')).toThrow(/No key types "é"/);
});
