import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import { z } from 'zod';
import { digest, fileEvidence } from './workspace';
import { assessment, type Role, type Task } from './workflow';

const duties: Record<Role, string> = {
  research: 'Find the existing owners and reusable code with jg, falling back to exact source search if retrieval is incomplete. Read primary docs and pinned related Cashu implementations. Explain uncertainty, acceptance tests and missing context before intake is sealed. Do not edit source.',
  implementation: 'Implement only the sealed outcomes. Reuse Coco and cashu-ts public APIs; search existing imports/functions before adding code. Prefer deletion when it simplifies callers. Use the supplied skills. Preserve saved fields, old fixtures and migration evidence. Update affected docs and put out-of-scope work in the existing follow-up ledger. Commit only task files in logical steps and audit each behavior commit. Do not push or create a PR.',
  review: 'Independently inspect the source diff and requirements. Actually read every supplied test output and log; open screenshots and videos and identify the frames inspected. Assess persistence state combinations, performance measurements and missing platforms. Check docs against behavior, reuse and dependency choices. Tests passing alone cannot certify all historic upgrades. Do not edit source or publish.',
  adversary: 'Try concrete counterexamples: stale identity, retries, interrupted migration, delayed effects, partial storage, duplicate sends, stale test evidence and scope creep. Inspect the original evidence and code yourself. Report reproductions and bounded conclusions, not another reviewer verdict. Do not edit source or publish.',
  audit: 'Read the final saved-check retrieval and changed source, then judge each applicable rule. JevLint completed means retrieval completed, never that code passed. Verify fixes, dependency allowances, docs, structured follow-ups and every requirement at this exact source. Any required missing evidence is inconclusive. Do not edit source or publish.',
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
  const artifacts = (t.ticket.role === 'implementation' ? t.history : t.receipts).flatMap(r => r.artifacts).map(item => {
    if (fileEvidence(join(stateDir, t.id), item.path).sha256 !== item.sha256) throw new Error('Evidence changed');
    return { ...item, absolutePath: join(stateDir, t.id, item.path) };
  });
  const research = t.assessments.filter(a => a.role === 'research' && a.result.verdict === 'pass').map(a => {
    if (fileEvidence(join(stateDir, t.id), a.artifact.path).sha256 !== a.artifact.sha256)
      throw new Error('Research evidence changed');
    return { source: a.source, artifact: a.artifact, result: a.result };
  });
  const packet = {
    task: t.id, ticket: t.ticket.id, policy: t.policy, source: t.source,
    root: t.root, base: t.base, role: t.ticket.role, target: t.ticket.target,
    instructions: `${duties[t.ticket.role]} No user questions after sealing. No nested delegation. If blocked, return inconclusive with the missing prerequisite. Host access is trusted; role text does not restrict tools. Return assessment JSON matching harness/src/workflow.ts. Include a specific inspection for every supplied artifact, with its hash. Do not invent evidence.`,
    contract: t.contract, context, artifacts, research, repairReason: t.reason,
    researchScope: 'Research describes its recorded source, not the current candidate. Recheck claims against changed code. It is context, never implementation or test proof. Reviewers must reach their own conclusions.',
    assessmentSchema: z.toJSONSchema(assessment),
    referenceFormat: 'observations.evidence and findings.evidence must be a repository-relative file path or artifact:<saved artifact filename>. Put explanations and line/frame details in observation/detail, never in the path. Copy hashes from the packet; do not guess them.',
    referenceSnapshot: join(stateDir, t.id, '0-references.json'),
    relatedProjects: ['cashubtc/nuts', 'cashubtc/coco', 'cashubtc/cashu-ts', 'cashubtc/nutshell', 'cashubtc/cdk', 'cashubtc/cashu.me', 'cashubtc/macadamia', 'cashubtc/minibits_wallet', 'cashubtc/wallet'],
    repairFindings: t.ticket.role === 'implementation' ? t.assessments.flatMap(a => a.result.findings) : [],
  };
  const sha256 = digest(JSON.stringify(packet));
  return { marker: `SOVRAN_TASK=${t.id} TICKET=${t.ticket.id} POLICY=${t.policy} BRIEF=${sha256}`, sha256, packet };
}
