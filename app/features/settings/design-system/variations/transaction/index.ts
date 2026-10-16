import type { TransactionCase } from '../transactionCases';
import type { Variant } from '../types';
import { T01 } from './T01';
import { T02 } from './T02';
import { T03 } from './T03';
import { T04 } from './T04';
import { T05 } from './T05';
import { T06 } from './T06';
import { T07 } from './T07';
import { T08 } from './T08';
import { T09 } from './T09';
import { T10 } from './T10';
import { T11 } from './T11';
import { T12 } from './T12';
import { T13 } from './T13';
import { T14 } from './T14';
import { T15 } from './T15';

export const TRANSACTION_VARIANTS: readonly Variant<TransactionCase>[] = [
  T01,
  T02,
  T03,
  T04,
  T05,
  T06,
  T07,
  T08,
  T09,
  T10,
  T11,
  T12,
  T13,
  T14,
  T15,
];
