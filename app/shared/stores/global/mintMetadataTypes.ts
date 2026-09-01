/**
 * @fileoverview The persisted per-mint metadata row.
 *
 * Leaf module: `features/mint/lib/auditInfo` derives one of these and the
 * store consumes that derivation, so the shape cannot live in the store
 * without the two importing each other.
 */
import type { GetInfoResponse } from '@cashu/cashu-ts';
import type { AuditMintResponse } from '@/shared/lib/apiClient';

export interface MintMetadataEntry {
  // identity (NUT-06 info + discover identity) — 24h
  /** Raw NUT-06 blob. Single owner now (was duplicated across info + audit caches). */
  info?: GetInfoResponse;
  /**
   * The NUT-06 `nuts` capability map, verbatim from nagg discover (auditor-
   * cached). A SUBSET of `info` — kept separately because discover refreshes
   * it in one bulk call while the full `info` still requires a per-mint
   * /v1/info fetch. Read via shared/lib/cashu/mintNuts.
   */
  nuts?: Record<string, unknown>;
  displayName?: string;
  iconUrl?: string;
  description?: string;
  supportedUnits?: string[];
  identityAt?: number;
  // reviews AGGREGATE only — rows are never persisted — 60m
  averageScore?: number | null;
  reviewCount?: number;
  favouriteCount?: number;
  reviewsAt?: number;
  // audit — raw blob (swap detail) + derived scalars — 60m
  auditData?: AuditMintResponse;
  auditScore?: number | null;
  auditState?: string;
  nMints?: number;
  nMelts?: number;
  nErrors?: number;
  auditAt?: number;
  // social / operator — 30m
  contactFollowers?: number;
  contactReputation?: number | null;
  operatorPubkey?: string;
  operatorNpub?: string;
  vertexRank?: number;
  socialAt?: number;
}
