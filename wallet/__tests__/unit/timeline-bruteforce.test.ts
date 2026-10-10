// The walk itself lives in ./timelineBruteForce. This file runs it with the
// reclaim path switched on, so it reaches the "you can take this back"
// branches; timeline-bruteforce-shipped.test.ts runs it as the wallet ships.
import { vi } from 'vitest';

vi.mock('../../src/p2pk/reclaimGate', () => ({ P2PK_RECLAIM_ENABLED: true }));

import { defineTimelineBruteForce } from './timelineBruteForce';

defineTimelineBruteForce('reclaim on');
