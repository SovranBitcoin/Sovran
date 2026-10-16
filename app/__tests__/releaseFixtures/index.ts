import type { ReleaseFixture } from './format';
import { fixture as E01 } from './E01-0.0.1';
import { fixture as E02 } from './E02-0.0.11';
import { fixture as E03 } from './E03-0.0.13';
import { fixture as E04 } from './E04-0.0.17';
import { fixture as E05 } from './E05-0.0.21';
import { fixture as E06 } from './E06-0.0.22';
import { fixture as E07 } from './E07-0.0.45';
import { fixture as E08 } from './E08-0.0.50';
import { fixture as E09 } from './E09-0.0.51';
import { fixture as E10 } from './E10-0.0.52';
import { fixture as E11 } from './E11-0.0.53';
import { fixture as E12 } from './E12-0.0.57';
import { fixture as E13 } from './E13-0.0.60';
import { fixture as E14 } from './E14-0.0.61';
import { fixture as E15 } from './E15-0.0.62';
import { fixture as E16 } from './E16-0.0.63';
import { fixture as E17 } from './E17-0.1.0';
import { fixture as E18 } from './E18-0.1.1';
import { fixture as E19 } from './E19-0.1.2';
import { fixture as E20 } from './E20-0.1.4';

/** Every epoch, oldest first. The newest is the one this tree would ship as. */
export const RELEASE_FIXTURES: readonly ReleaseFixture[] = [
  E01,
  E02,
  E03,
  E04,
  E05,
  E06,
  E07,
  E08,
  E09,
  E10,
  E11,
  E12,
  E13,
  E14,
  E15,
  E16,
  E17,
  E18,
  E19,
  E20,
];

/**
 * Epochs of the persistence map that have no fixture yet. Empty is the only
 * state the completeness test accepts; a name here says so out loud.
 */
export const NOT_YET_AUTHORED: readonly string[] = [];
