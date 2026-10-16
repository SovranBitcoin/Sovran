// The same walk with the reclaim gate as it ships (off): a timed lock then
// reads as one this wallet cannot take back.
import { defineTimelineBruteForce } from './timelineBruteForce';

defineTimelineBruteForce('as shipped');
