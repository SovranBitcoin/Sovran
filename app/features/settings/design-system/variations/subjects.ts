import { TIMELINE_CASES } from './timelineCases';
import { TIMELINE_VARIANTS } from './timeline';
import { TRANSACTION_CASES } from './transactionCases';
import { TRANSACTION_VARIANTS } from './transaction';
import type { Subject } from './types';

/**
 * Every component currently being redesigned. `Subject<never>` erases the
 * case type so subjects of different shapes fit one list; the screen only
 * ever hands a subject's own cases back to its own variants.
 */
export const SUBJECTS = [
  {
    id: 'transaction-row',
    title: 'Transaction row',
    description: 'One payment in a list: who, how much, which way, and how it went.',
    arrangement: 'list',
    cases: TRANSACTION_CASES,
    variants: TRANSACTION_VARIANTS,
  } satisfies Subject<(typeof TRANSACTION_CASES)[number]['item']>,
  {
    id: 'timeline',
    title: 'Payment timeline',
    description: 'Where one payment stands, and how it got there.',
    arrangement: 'separate',
    cases: TIMELINE_CASES,
    variants: TIMELINE_VARIANTS,
  } satisfies Subject<(typeof TIMELINE_CASES)[number]['item']>,
] as const;

export type SubjectId = (typeof SUBJECTS)[number]['id'];
