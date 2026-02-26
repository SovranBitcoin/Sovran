/**
 * NFC APDU and NDEF constants for Type 4 Tag / IsoDep communication.
 */

/** APDU: Select NDEF Tag Application AID */
export const SELECT_AID = [
  0x00, 0xa4, 0x04, 0x00, 0x07, 0xd2, 0x76, 0x00, 0x00, 0x85, 0x01, 0x01, 0x00,
];

/** APDU: Select NDEF file (E104) */
export const SELECT_NDEF = [0x00, 0xa4, 0x00, 0x0c, 0x02, 0xe1, 0x04];

/** Build READ BINARY APDU (offset, length). */
export const readBinary = (offset: number, length: number): number[] => [
  0x00,
  0xb0,
  (offset >> 8) & 0xff,
  offset & 0xff,
  length,
];

/** Build UPDATE BINARY APDU (offset, data). */
export const updateBinary = (offset: number, data: number[]): number[] => [
  0x00,
  0xd6,
  (offset >> 8) & 0xff,
  offset & 0xff,
  data.length,
  ...data,
];

export const STATUS_OK = '9000';

export const STATUS_CODES: Record<string, string> = {
  '9000': 'Success',
  '6f00': 'No precise diagnosis (command failed)',
  '6a80': 'Incorrect parameters in data field',
  '6a81': 'Function not supported',
  '6a82': 'File not found',
  '6a83': 'Record not found',
  '6a84': 'Not enough memory space',
  '6a86': 'Incorrect P1-P2 parameters',
  '6a87': 'Lc inconsistent with TLV structure',
  '6b00': 'Wrong parameters P1-P2',
  '6c00': 'Wrong length Le',
  '6700': 'Wrong length',
  '6982': 'Security status not satisfied',
  '6985': 'Conditions of use not satisfied',
  '6d00': 'INS not supported',
  '6e00': 'CLA not supported',
};

export const MAX_CHUNK_SIZE = 240;
export const SHORT_RECORD_FLAG = 0x10;
