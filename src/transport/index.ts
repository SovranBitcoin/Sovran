// ---------------------------------------------------------------------------
// Mesh transport — public surface
//
// Colada's half of Nut Drop. Ecash is sent by locking a token to the
// recipient's announced P2PK key and broadcasting it on the public mesh; the
// receiver classifies inbound public-mesh tokens and drains anything locked to
// it through the auto-redeem orchestrator. There is no in-band handshake.
// ---------------------------------------------------------------------------

export { normalizeMintUrl } from './plan';

export {
  classifyMeshToken,
  meshTokenDedupeKey,
  type ClassifiedMeshToken,
  type MeshTokenClass,
} from './classify';

export {
  classifyMeshRedeemError,
  createMeshRedeemOrchestrator,
  type MeshRedeemEntry,
  type MeshRedeemErrorKind,
  type MeshRedeemOrchestrator,
  type MeshRedeemOrchestratorConfig,
  type MeshRedeemQueuePort,
  type MeshRedeemStatus,
} from './redeemOrchestrator';
