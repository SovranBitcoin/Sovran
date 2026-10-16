/** One step of a payment's progress. */
export interface TimelineStep {
  readonly title: string;
  readonly detail?: string;
  readonly state: 'done' | 'active' | 'todo' | 'failed';
  /** When it happened, already formatted; absent for steps not reached. */
  readonly time?: string;
}

/** What a payment timeline has to be able to say. Plain data, no wallet types. */
export interface TimelineCase {
  /** The one-line verdict: where this payment stands. */
  readonly headline: string;
  readonly tone: 'progress' | 'success' | 'problem' | 'neutral';
  readonly steps: readonly TimelineStep[];
}

export const TIMELINE_CASES: readonly { label: string; item: TimelineCase }[] = [
  {
    label: 'Ecash send, waiting to be claimed',
    item: {
      headline: 'Waiting for the recipient',
      tone: 'progress',
      steps: [
        { title: 'Created', state: 'done', time: '2:07:15 PM' },
        {
          title: 'Sent',
          detail: 'The token is with the recipient',
          state: 'active',
          time: '2:07:16 PM',
        },
        { title: 'Claimed', state: 'todo' },
      ],
    },
  },
  {
    label: 'Lightning receive, paid',
    item: {
      headline: 'Received',
      tone: 'success',
      steps: [
        { title: 'Invoice created', state: 'done', time: '11:40:02 AM' },
        { title: 'Payment received', state: 'done', time: '11:42:31 AM' },
        { title: 'Added to your balance', state: 'done', time: '11:42:33 AM' },
      ],
    },
  },
  {
    label: 'On-chain receive, 2 of 6 confirmations',
    item: {
      headline: 'Confirming',
      tone: 'progress',
      steps: [
        { title: 'Address created', state: 'done', time: 'Oct 6, 9:02 PM' },
        { title: 'Seen on the network', state: 'done', time: 'Oct 6, 9:31 PM' },
        {
          title: 'Confirming',
          detail: '2 of 6 confirmations, about 40 minutes left',
          state: 'active',
        },
        { title: 'Added to your balance', state: 'todo' },
      ],
    },
  },
  {
    label: 'Lightning send, failed',
    item: {
      headline: 'Not sent',
      tone: 'problem',
      steps: [
        { title: 'Ready to send', state: 'done', time: '8:14:50 AM' },
        { title: 'Sending', state: 'done', time: '8:14:52 AM' },
        {
          title: 'Failed',
          detail: 'No route to the recipient. Your money was not spent.',
          state: 'failed',
          time: '8:15:20 AM',
        },
      ],
    },
  },
  {
    label: 'Ecash send, cancelled and returned',
    item: {
      headline: 'Cancelled',
      tone: 'neutral',
      steps: [
        { title: 'Created', state: 'done', time: 'Oct 3, 4:23 PM' },
        {
          title: 'Cancelled',
          detail: 'The ecash is back in your wallet',
          state: 'done',
          time: 'Oct 3, 4:25 PM',
        },
      ],
    },
  },
  {
    label: 'Ecash receive, not yet started',
    item: {
      headline: 'Ready to redeem',
      tone: 'neutral',
      steps: [
        { title: 'Token opened', state: 'active' },
        { title: 'Redeeming', state: 'todo' },
        { title: 'Added to your balance', state: 'todo' },
      ],
    },
  },
];
