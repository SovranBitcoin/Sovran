import type { LiveCocodMetadata } from '../funded-runtime/cocod-live';
import type { RunProof } from './events';
import type { GitInfo } from './git';

/** Durable source contract for every raw E2E run directory. */
export interface RunManifest {
  version: 1;
  runId: string;
  suite: string;
  driver: 'fake' | 'sim' | 'android';
  proof: RunProof;
  sourceFingerprint: string;
  recording: boolean;
  evidence?: 'full' | 'screenshots';
  startedAt: string;
  scenarios: string[];
  git?: GitInfo;
  filters: Record<string, unknown>;
  funded?: {
    acceptedTestFundLoss: true;
    cocod: LiveCocodMetadata;
  };
}
