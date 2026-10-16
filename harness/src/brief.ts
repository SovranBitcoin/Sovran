import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import { z } from 'zod';
import { digest, fileEvidence } from './workspace';
import { assessment, type Role, type Task } from './workflow';
import { projects } from './references';
import { assessmentArtifacts, obligations, proposals } from './evidence';

const duties: Record<Role, string> = {
  research: 'Find the existing owners and reusable code with jg, falling back to exact source search if retrieval is incomplete. Read primary docs and pinned related Cashu implementations. Explain uncertainty, acceptance tests and missing context before intake is sealed. Do not edit source.',
  implementation: 'Implement only the sealed outcomes. Reuse Coco and cashu-ts public APIs; search existing imports/functions before adding code. Prefer deletion when it simplifies callers. Use the supplied skills. Preserve saved fields, old fixtures and migration evidence. Update affected docs and put out-of-scope work in the existing follow-up ledger. Commit only task files in logical steps and audit each behavior commit. Do not push or create a PR.',
  review: 'Independently inspect the source diff and requirements against the supplied conventions and relevant skill procedures, including platform flow structure and test-library version. Actually read every supplied test output and log; open screenshots and videos and identify the frames inspected. Assess persistence state combinations, performance measurements and missing platforms. Check docs against behavior, reuse and dependency choices. Tests passing alone cannot certify all historic upgrades. Do not edit source or publish.',
  adversary: 'Try concrete counterexamples: stale identity, retries, interrupted migration, delayed effects, partial storage, duplicate sends, stale test evidence and scope creep. Inspect the original evidence and code yourself. Report reproductions and bounded conclusions, not another reviewer verdict. Do not edit source or publish.',
  audit: 'Read the final saved-check retrieval and changed source, then judge each applicable rule. JevLint completed means retrieval completed, never that code passed. Verify fixes, dependency allowances, docs, structured follow-ups and every requirement at this exact source. Any required missing evidence is inconclusive. Do not edit source or publish.',
  diversityReview: 'Independently review the full requirements, source and raw test evidence using a model that has not authored this task. Challenge the design and test validity. Do not rely on other reviewers agreeing. Do not edit source or publish.',
};

export function brief(t: Task, stateDir: string) {
  if (!t.ticket) throw new Error('Issue a role ticket first');
  if (!t.referenceEvidence || fileEvidence(join(stateDir, t.id), t.referenceEvidence.path).sha256 !== t.referenceEvidence.sha256)
    throw new Error('Pinned reference snapshot is missing or changed');
  const contextFile = join(stateDir, t.id, '0-intake-context.json');
  const context = z.array(z.object({ path: z.string(), sha256: z.string(), content: z.string() }))
    .parse(JSON.parse(readFileSync(contextFile, 'utf8')));
  for (const item of t.context) {
    const snapshot = context.find(c => c.path === item.path);
    if (!snapshot || snapshot.sha256 !== item.sha256 || digest(snapshot.content) !== item.sha256)
      throw new Error('Sealed context snapshot is missing or changed');
  }
  const artifacts = assessmentArtifacts(t, t.ticket.role).map(item => {
    if (fileEvidence(join(stateDir, t.id), item.path).sha256 !== item.sha256) throw new Error('Evidence changed');
    return { ...item, absolutePath: join(stateDir, t.id, item.path) };
  });
  const research = t.assessments.filter(a => a.role === 'research' && a.result.verdict === 'pass').map(a => {
    if (fileEvidence(join(stateDir, t.id), a.artifact.path).sha256 !== a.artifact.sha256)
      throw new Error('Research evidence changed');
    return { source: a.source, artifact: a.artifact, result: a.result };
  });
  if (['implementation', 'audit'].includes(t.ticket.role)) {
    for (const item of [...obligations(t).map(o => o.origin), ...proposals(t).map(p => p.artifact)])
      if (fileEvidence(join(stateDir, t.id), item.path).sha256 !== item.sha256) throw new Error('Reconciliation evidence changed');
  }
  const packet = {
    task: t.id, ticket: t.ticket.id, policy: t.policy, source: t.source,
    root: t.root, base: t.base, role: t.ticket.role, target: t.ticket.target,
    instructions: `${duties[t.ticket.role]} No user questions after sealing. No nested delegation. If blocked, return inconclusive with the missing prerequisite. Host access is trusted; role text does not restrict tools. Return assessment JSON matching harness/src/workflow.ts. Include a specific inspection for every supplied artifact, with its hash. Do not invent evidence.`,
    contract: t.contract, context, artifacts, research, repairReason: t.ticket.role === 'implementation' ? t.reason : '',
    attempts: t.attempts.map(a => ({ ticket: a.ticket.id, role: a.ticket.role, target: a.ticket.target,
      worker: a.ticket.claim?.worker ?? null, generation: a.generation, sourceBefore: a.ticket.sourceAtIssue,
      sourceAfter: a.sourceAfter, availability: a.completion.kind === 'unavailable' || a.completion.kind === 'dispatch-rejected' ? a.completion.reason : null })),
    effortEvidence: 'Target options record requested effort. Runtime model identity comes from T3. Effective effort is unreported unless separately observed; never infer it from the request.',
    historyScope: t.historyEvidence ? 'The baseline-history artifact captures pre-edit source and bounded blame/changes. Research must record the reason and preservation plan for every planned path, distinguishing gaps from completed investigation. Search active and deleted follow-ups. In followups.explanation, give each relevant ID its relationship (required, prerequisite, outside scope, resolved, or suspected/verified recurrence), rationale and supporting evidence. Follow older commits and associated PR discussions; distinguish the final merged patch from earlier review comments. Audit must recheck actual changed paths and these relationships. Missing pages or unavailable PRs remain explicit gaps.' : 'Legacy contract: no executable pre-edit history coverage was sealed.',
    verificationScope: 'The sealed verificationPolicy maps requirements to named cases or explicitly bounded inspection. Independent review, final audit and additional GPT review must supply oracleReviews for Node requirements, citing test files and current candidate/baseline node-inspection artifacts. Judge assertions, fixtures, mocks, selectors, skips and test/runner changes against the requirement and history. Inspect negative-control copiedInputs: copying the fix into the baseline cannot establish a regression. Explain why the failing assertion reaches the intended old behavior; setup/import/hook failures do not qualify. Node reports are consistency evidence, not authentication of hostile test code; inspect unusual runner/IPC manipulation. An inspection-only requirement does not gain execution proof.',
    researchScope: 'Research describes its recorded source, not the current candidate. Recheck claims against changed code. It is context, never implementation or test proof. Reviewers must reach their own conclusions.',
    assessmentSchema: z.toJSONSchema(assessment),
    referenceFormat: 'observations.evidence and findings.evidence must be a repository-relative file path, artifact:<saved artifact filename>, or git:<full ancestor commit>:<relative file> for historical/deleted evidence. Put explanations and line/frame details in observation/detail, never in the path. Copy hashes from the packet; do not guess them.',
    referenceSnapshot: join(stateDir, t.id, '0-references.json'),
    relatedProjects: Object.values(projects),
    reconciliation: ['implementation', 'audit'].includes(t.ticket.role) ? {
      obligations: obligations(t), proposals: proposals(t),
      instructions: 'Implementation proposes fixed or refuted dispositions, with hypothesis, experiment, disconfirming evidence and regression evidence. Final audit independently accepts or rejects each exact proposal digest. No blocking obligation can be deferred. Initial review and adversary inspect blind; final audit reconciles every retained objection and failed run.',
    } : null,
  };
  const sha256 = digest(JSON.stringify(packet));
  return { marker: `SOVRAN_TASK=${t.id} TICKET=${t.ticket.id} POLICY=${t.policy} BRIEF=${sha256}`, sha256, packet };
}
