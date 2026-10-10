# 22. Official CDK bindings stay release-gated

Date: 2026-10-03
Status: Accepted

Cashu uses cashu-ts until official CDK bindings are released and deliberately
integrated. The source-controlled backend gate in
[outputDataCreator.ts](../../shared/lib/cashu/outputDataCreator.ts) defaults to
cashu-ts and rejects CDK selection while its adapter is unavailable. Environment
variables and Recovery settings cannot enable it.

Coco's existing `OutputDataCreator` parameter is the future integration point.
Enabling CDK requires selecting and pinning the official package, adapting its
released API to that contract, checking protocol compatibility, and verifying
native linking on both platforms before changing the gate. Do not assume the
unreleased package's name or API, or substitute unofficial bindings.

No CDK dependency or native loader ships while the gate is closed. Recovery has
no crypto benchmark controls or instrumentation. Existing installed binaries
require a new native build to remove previously linked code.
