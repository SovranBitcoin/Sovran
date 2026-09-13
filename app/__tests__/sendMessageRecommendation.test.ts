import {
  annotateSendMessageOptions,
  formatSendOptionReason,
  type SendTransport,
} from '@/features/user/lib/sendMessageRecommendation';

jest.mock('@/shared/stores/global/settingsStore', () => ({
  useSettingsStore: { getState: () => ({ language: 'en' }) },
}));

const nowMs = Date.UTC(2026, 8, 13);
const atSeconds = nowMs / 1000 - 2 * 86400;
const options: SendTransport[] = ['nip17', 'nip04', 'whitenoise', 'bitchat'];
const context = { options, whitenoiseReady: true, bitchatReachable: true, nowMs };

it('recommends NIP-17 without history even when input order differs', () => {
  const result = annotateSendMessageOptions({ ...context, options: [...options].reverse() });
  expect(result[0]).toEqual({
    transport: 'nip17',
    status: 'recommended',
    reason: { code: 'MOST_COMPATIBLE' },
  });
  expect(options).toEqual(['nip17', 'nip04', 'whitenoise', 'bitchat']);
});

it('recommends the last received protocol with an explicit time and direction', () => {
  const [recommended] = annotateSendMessageOptions({
    ...context,
    lastMessage: { protocol: 'nip04', atSeconds, isOwn: false },
  });
  expect(recommended).toEqual({
    transport: 'nip04',
    status: 'recommended',
    reason: { code: 'LAST_RECEIVED_VIA', params: { protocol: 'nip04', atSeconds } },
  });
  expect(formatSendOptionReason(recommended.reason, nowMs)).toBe(
    'They last messaged you via NIP-04 · 2d ago'
  );
  expect(formatSendOptionReason(recommended.reason, nowMs + 86400000)).toBe(
    'They last messaged you via NIP-04 · 3d ago'
  );
});

it('keeps White Noise setup available and promotes NIP-17', () => {
  const result = annotateSendMessageOptions({
    ...context,
    whitenoiseReady: false,
    lastMessage: { protocol: 'whitenoise', atSeconds, isOwn: true },
  });
  expect(result[0]).toMatchObject({
    transport: 'nip17',
    status: 'recommended',
    reason: { code: 'MOST_COMPATIBLE' },
  });
  expect(result.find((option) => option.transport === 'whitenoise')).toEqual({
    transport: 'whitenoise',
    status: 'available',
    reason: { code: 'NEEDS_SETUP' },
  });
});

it('recommends ready White Noise with sent wording', () => {
  const [recommended] = annotateSendMessageOptions({
    ...context,
    lastMessage: { protocol: 'whitenoise', atSeconds, isOwn: true },
  });
  expect(recommended).toMatchObject({ transport: 'whitenoise', status: 'recommended' });
  expect(formatSendOptionReason(recommended.reason, nowMs)).toBe(
    'You last messaged them via White Noise · 2d ago'
  );
});

it.each([true, false])('never recommends unreachable BitChat (isOwn=%s)', (isOwn) => {
  const result = annotateSendMessageOptions({
    ...context,
    bitchatReachable: false,
    lastMessage: { protocol: 'bitchat', atSeconds, isOwn },
  });
  expect(result[0].transport).toBe('nip17');
  expect(result[result.length - 1]).toEqual({
    transport: 'bitchat',
    status: 'disabled',
    reason: { code: 'BLE_OUT_OF_RANGE' },
  });
});

it('falls back when the last transport is hidden by settings', () => {
  expect(
    annotateSendMessageOptions({
      ...context,
      options: ['nip04', 'nip17', 'bitchat'],
      lastMessage: { protocol: 'whitenoise', atSeconds, isOwn: false },
    })[0]
  ).toMatchObject({ transport: 'nip17', status: 'recommended' });
});

it('has exactly one recommendation across transport, direction and readiness combinations', () => {
  for (const protocol of options)
    for (const isOwn of [true, false]) {
      for (const whitenoiseReady of [true, false])
        for (const bitchatReachable of [true, false]) {
          const result = annotateSendMessageOptions({
            ...context,
            whitenoiseReady,
            bitchatReachable,
            lastMessage: { protocol, atSeconds, isOwn },
          });
          expect(result.filter((option) => option.status === 'recommended')).toHaveLength(1);
          expect(result[0].status).toBe('recommended');
        }
    }
});
