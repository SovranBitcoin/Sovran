// ---------------------------------------------------------------------------
// Mesh transport — public surface
//
// Colada's half of the Nut Drop NUT-18-over-mesh exchange. The wallet app
// implements `MeshTransportAdapter` over its mesh bridge (bytes); everything
// semantic — send planning, request issuance, payment validation, delivery
// tracking, auto-redeem orchestration — lives here.
// ---------------------------------------------------------------------------

export type {
  MeshInboundEvent,
  MeshPaymentStatus,
  MeshPeerCapabilities,
  MeshRejectReason,
  MeshTransportAdapter,
  ParsedMeshPaymentRequest,
} from './types';

export {
  normalizeMintUrl,
  parseMeshPaymentRequest,
  planMeshSend,
  type MeshSendAbortReason,
  type MeshSendPlan,
  type MeshSolicitOutcome,
  type ParseMeshPaymentRequestResult,
  type PlanMeshSendInput,
} from './plan';

export {
  classifyMeshToken,
  meshTokenDedupeKey,
  type ClassifiedMeshToken,
  type MeshTokenClass,
} from './classify';

export {
  createMeshRequestResponder,
  type IssuedMeshRequest,
  type MeshRequestResponder,
  type MeshRequestResponderConfig,
} from './requestResponder';

export {
  validateInboundMeshPayment,
  type AcceptedMeshPayment,
  type ValidateInboundMeshPaymentResult,
} from './validateInboundPayment';

export {
  createMeshPaymentIntake,
  type MeshPaymentIntake,
  type MeshPaymentIntakeConfig,
  type MeshPaymentIntakeQueuePort,
} from './paymentIntake';

export {
  createMeshDeliveryTracker,
  type MeshDeliveryState,
  type MeshDeliveryTracker,
  type MeshDeliveryTrackerConfig,
  type MeshDeliveryUpdate,
} from './deliveryTracker';

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
