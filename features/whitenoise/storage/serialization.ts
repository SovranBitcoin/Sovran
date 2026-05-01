import { base64 } from '@scure/base';

const BYTES_TAG = '__u8b64__';
const BIGINT_TAG = '__bigint__';

type BytesEnvelope = { [BYTES_TAG]: string };
type BigIntEnvelope = { [BIGINT_TAG]: string };

function isBytesEnvelope(value: unknown): value is BytesEnvelope {
  return (
    typeof value === 'object' &&
    value !== null &&
    BYTES_TAG in value &&
    typeof (value as BytesEnvelope)[BYTES_TAG] === 'string'
  );
}

function isBigIntEnvelope(value: unknown): value is BigIntEnvelope {
  return (
    typeof value === 'object' &&
    value !== null &&
    BIGINT_TAG in value &&
    typeof (value as BigIntEnvelope)[BIGINT_TAG] === 'string'
  );
}

// MLS / ts-mls types put `bigint` on u64 fields (lifetimes, capabilities,
// epoch counters). JSON.stringify throws "Do not know how to serialize a
// BigInt" without a replacer; envelope it as a tagged string.
function replaceValue(_key: string, value: unknown): unknown {
  if (value instanceof Uint8Array) {
    return { [BYTES_TAG]: base64.encode(value) };
  }
  if (typeof value === 'bigint') {
    return { [BIGINT_TAG]: value.toString() };
  }
  return value;
}

function reviveValue(_key: string, value: unknown): unknown {
  if (isBytesEnvelope(value)) {
    return base64.decode(value[BYTES_TAG]);
  }
  if (isBigIntEnvelope(value)) {
    return BigInt(value[BIGINT_TAG]);
  }
  return value;
}

export function stringifyWithBytes(value: unknown): string {
  return JSON.stringify(value, replaceValue);
}

export function parseWithBytes<T>(text: string): T {
  return JSON.parse(text, reviveValue) as T;
}
