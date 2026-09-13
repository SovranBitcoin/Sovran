import { formatRelative } from '@/shared/lib/date';

export type SendTransport = 'nip17' | 'nip04' | 'whitenoise' | 'bitchat';

export interface LastMessage {
  protocol: SendTransport;
  atSeconds: number;
  isOwn: boolean;
}

type SendOptionReason =
  | {
      code: 'LAST_RECEIVED_VIA' | 'LAST_SENT_VIA';
      params: { protocol: SendTransport; atSeconds: number };
    }
  | { code: 'MOST_COMPATIBLE' | 'BLE_OUT_OF_RANGE' | 'NEEDS_SETUP' };

export interface AnnotatedSendOption {
  transport: SendTransport;
  status: 'recommended' | 'available' | 'disabled';
  reason: SendOptionReason | null;
}

interface RecommendationContext {
  lastMessage?: LastMessage;
  whitenoiseReady: boolean;
  bitchatReachable: boolean;
  nowMs: number;
}

interface RecommendationRule {
  applies: (transport: SendTransport, context: RecommendationContext) => boolean;
  status: AnnotatedSendOption['status'];
  reason: (transport: SendTransport, context: RecommendationContext) => SendOptionReason | null;
}

// Received evidence comes first; with the single latest-message record, sent
// evidence applies only when that latest message is our own.
const HISTORY_RULES: RecommendationRule[] = [
  {
    applies: (transport, { lastMessage }) =>
      lastMessage?.protocol === transport && !lastMessage.isOwn,
    status: 'recommended',
    reason: (protocol, { lastMessage }) =>
      lastMessage
        ? { code: 'LAST_RECEIVED_VIA', params: { protocol, atSeconds: lastMessage.atSeconds } }
        : null,
  },
  {
    applies: (transport, { lastMessage }) =>
      lastMessage?.protocol === transport && lastMessage.isOwn,
    status: 'recommended',
    reason: (protocol, { lastMessage }) =>
      lastMessage
        ? { code: 'LAST_SENT_VIA', params: { protocol, atSeconds: lastMessage.atSeconds } }
        : null,
  },
];

const RULES_BY_TRANSPORT = {
  nip17: [...HISTORY_RULES],
  nip04: [...HISTORY_RULES],
  whitenoise: [
    {
      applies: (_transport, { whitenoiseReady }) => !whitenoiseReady,
      status: 'available',
      reason: () => ({ code: 'NEEDS_SETUP' }),
    },
    ...HISTORY_RULES,
  ],
  bitchat: [
    {
      applies: (_transport, { bitchatReachable }) => !bitchatReachable,
      status: 'disabled',
      reason: () => ({ code: 'BLE_OUT_OF_RANGE' }),
    },
    ...HISTORY_RULES,
  ],
} as const satisfies Record<SendTransport, RecommendationRule[]>;

const STATUS_ORDER = { recommended: 0, available: 1, disabled: 2 };

/** The menu always supplies NIP-17 as its compatible fallback. */
export function annotateSendMessageOptions({
  options,
  ...context
}: RecommendationContext & { options: readonly SendTransport[] }): AnnotatedSendOption[] {
  const annotated = [...new Set(options)].map((transport): AnnotatedSendOption => {
    const rules: readonly RecommendationRule[] = RULES_BY_TRANSPORT[transport];
    const rule = rules.find((candidate) => candidate.applies(transport, context));
    return {
      transport,
      status: rule?.status ?? 'available',
      reason: rule?.reason(transport, context) ?? null,
    };
  });
  if (!annotated.some((option) => option.status === 'recommended')) {
    const fallback =
      annotated.find((option) => option.transport === 'nip17') ??
      annotated.find(
        (option) => option.status === 'available' && option.reason?.code !== 'NEEDS_SETUP'
      );
    if (fallback) {
      fallback.status = 'recommended';
      fallback.reason = { code: 'MOST_COMPATIBLE' };
    }
  }
  return annotated.sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status]);
}

const TRANSPORT_LABELS: Record<SendTransport, string> = {
  nip17: 'NIP-17',
  nip04: 'NIP-04',
  whitenoise: 'White Noise',
  bitchat: 'BitChat',
};

export function formatSendOptionReason(reason: SendOptionReason | null, nowMs: number): string {
  if (!reason) return '';
  switch (reason.code) {
    case 'LAST_RECEIVED_VIA':
      return `They last messaged you via ${TRANSPORT_LABELS[reason.params.protocol]} · ${formatRelative(reason.params.atSeconds * 1000, 'compact', nowMs)}`;
    case 'LAST_SENT_VIA':
      return `You last messaged them via ${TRANSPORT_LABELS[reason.params.protocol]} · ${formatRelative(reason.params.atSeconds * 1000, 'compact', nowMs)}`;
    case 'MOST_COMPATIBLE':
      return 'Most compatible option';
    case 'BLE_OUT_OF_RANGE':
      return 'No nearby BLE peer matches this contact';
    case 'NEEDS_SETUP':
      return 'Tap to set up MLS encrypted messaging';
  }
}
