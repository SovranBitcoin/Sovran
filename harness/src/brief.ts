import { join, resolve } from 'node:path';
import { mkdirSync, readFileSync } from 'node:fs';
import { z } from 'zod';
import { digest, fileEvidence } from './workspace';
import { assessmentFor, type Role, type Task } from './workflow';
import { projects } from './references';
import { assessmentArtifacts, obligations, proposals } from './evidence';

const duties: Record<Role, string> = {
  research: 'Find the existing owners and reusable code with jg, falling back to exact source search if retrieval is incomplete. Read primary docs and pinned related Cashu implementations. Explain uncertainty, acceptance tests and missing context before intake is sealed. Do not edit source.',
  implementation: 'Implement only the sealed outcomes. Reuse Coco and cashu-ts public APIs; search existing imports/functions before adding code. Prefer deletion when it simplifies callers. Use the supplied skills. Preserve saved fields, old fixtures and migration evidence. Update affected docs and put out-of-scope work in the existing follow-up ledger. Commit only task files in logical steps and audit each behavior commit. Change only historyPolicy.paths and leave no untracked files; edit a manifest or lockfile only for an exact allowedDependencies entry. Do not push or create a PR.',
  review: 'Independently inspect the source diff and requirements against the supplied conventions and relevant skill procedures, including platform flow structure and test-library version. Actually read every supplied test output and log; open screenshots and videos and identify the frames inspected. Assess persistence state combinations, performance measurements and missing platforms. Check docs against behavior, reuse and dependency choices. Tests passing alone cannot certify all historic upgrades. Do not edit source or publish.',
  adversary: 'Try concrete counterexamples: stale identity, retries, interrupted migration, delayed effects, partial storage, duplicate sends, stale test evidence and scope creep. Inspect the original evidence and code yourself. Report reproductions and bounded conclusions, not another reviewer verdict. Do not edit source or publish.',
  audit: 'Read the final saved-check retrieval and changed source, then judge each applicable rule. JevLint completed means retrieval completed, never that code passed. Verify fixes, dependency allowances, docs, structured follow-ups and every requirement at this exact source. Any required missing evidence is inconclusive. Do not edit source or publish.',
  diversityReview: 'Independently review the full requirements, source and raw test evidence using a model that has not authored this task. Challenge the design and test validity. Do not rely on other reviewers agreeing. Do not edit source or publish.',
};

/**
 * Several tasks run on one Mac at once. Workers that booted shared simulators,
 * opened Simulator.app or started windowed emulators took each other's
 * devices and the owner's screen, and filled the disk and swap.
 */
const devices = 'To see the app, play a story from app/: `bun run e2e:story e2e/stories/library/<story>.json --look` plays on this checkout\'s own simulator, made on first use and reused, with no window (about 12 s a story); `--platform android` plays on a disposable windowless emulator. Never open Simulator.app, boot or use a simulator or emulator you did not get this way, run `expo run:*` or `bun run ios|android`, or start Metro on port 8081. Builds and multi-story runs wait for one lease shared by every checkout on this Mac; do not work around it. If native work refuses for lack of disk, return inconclusive naming that: never delete files to make room.';

export function brief(t: Task, stateDir: string) {
  if (!t.ticket) throw new Error('Issue a role ticket first');
  const taskDir = resolve(stateDir, t.id);
  if (!t.referenceEvidence || fileEvidence(taskDir, t.referenceEvidence.path).sha256 !== t.referenceEvidence.sha256)
    throw new Error('Pinned reference snapshot is missing or changed');
  mkdirSync(join(taskDir, 'results'), { recursive: true, mode: 0o700 });
  const contextFile = join(taskDir, '0-intake-context.json');
  const snapshots = z.array(z.object({ path: z.string(), sha256: z.string(), content: z.string() }))
    .parse(JSON.parse(readFileSync(contextFile, 'utf8')));
  const context = t.context.map(item => {
    const index = snapshots.findIndex(c => c.path === item.path);
    const snapshot = snapshots[index];
    if (!snapshot || snapshot.sha256 !== item.sha256 || digest(snapshot.content) !== item.sha256)
      throw new Error('Sealed context snapshot is missing or changed');
    // Authority and skill procedures stay inline. Large reference documents are
    // read from the same verified snapshot, never substituted with live files.
    if (/^(?:app\/)?docs\//.test(item.path) && !/(?:^|\/)(?:AGENTS|SKILL)\.md$/.test(item.path) && Buffer.byteLength(snapshot.content) > 8192)
      return { delivery: 'snapshot' as const, path: item.path, sha256: item.sha256,
        snapshot: { file: contextFile, pointer: `/${index}/content` } };
    return { delivery: 'inline' as const, ...snapshot };
  });
  const artifacts = assessmentArtifacts(t, t.ticket.role).map(item => {
    if (fileEvidence(taskDir, item.path).sha256 !== item.sha256) throw new Error('Evidence changed');
    return { ...item, absolutePath: join(taskDir, item.path) };
  });
  const research = t.assessments.filter(a => a.role === 'research' && a.result.verdict === 'pass').map(a => {
    if (fileEvidence(taskDir, a.artifact.path).sha256 !== a.artifact.sha256)
      throw new Error('Research evidence changed');
    return { source: a.source, artifact: a.artifact, result: a.result };
  });
  if (['implementation', 'audit'].includes(t.ticket.role)) {
    for (const item of [...obligations(t).map(o => o.origin), ...proposals(t).map(p => p.artifact)])
      if (fileEvidence(taskDir, item.path).sha256 !== item.sha256) throw new Error('Reconciliation evidence changed');
  }
  const packet = {
    task: t.id, ticket: t.ticket.id, policy: t.policy, source: t.source,
    root: t.root, base: t.base, role: t.ticket.role, target: t.ticket.target,
    instructions: `${duties[t.ticket.role]} No user questions after sealing. No nested delegation. If blocked, return inconclusive with the missing prerequisite.${t.ticket.role === 'implementation' ? '' : ' Leave the checkout unchanged: scratch work belongs in /tmp, since a changed source refuses the assessment.'} Host access is trusted; role text does not restrict tools. Return assessment JSON matching this packet's assessmentSchema, which omits parts other roles own. Include a specific inspection for every supplied artifact, with its hash. Do not invent evidence.`,
    contextInstructions: 'Inline context is supplied below. Before making a decision, read applicable snapshot references from their absolute JSON file at the given JSON Pointer. Verify the extracted content against its sha256. References contain the sealed original content, not the current checkout. Use the reference path to identify relevance; record missing or contradictory guidance instead of ignoring it. Do not load the entire snapshot into the prompt when extracting one reference.',
    contract: t.contract, context, artifacts, research, repairReason: t.ticket.role === 'implementation' ? t.reason : '',
    attempts: t.attempts.map(a => ({ ticket: a.ticket.id, role: a.ticket.role, target: a.ticket.target,
      worker: a.ticket.claim?.worker ?? null, generation: a.generation, sourceBefore: a.ticket.sourceAtIssue,
      sourceAfter: a.sourceAfter, availability: a.completion.kind === 'unavailable' || a.completion.kind === 'dispatch-rejected' ? a.completion.reason : null })),
    devices,
    resultFile: join(taskDir, 'results', `${t.ticket.id}.json`),
    resultInstructions: 'Before you finish, write your final assessment JSON to resultFile as well as returning it, so a result is not lost if the task host restarts. It is a copy for recovery, not a substitute for returning it.',
    effortEvidence: 'Target options record requested effort. Runtime model identity comes from T3. Effective effort is unreported unless separately observed; never infer it from the request.',
    historyScope: t.historyEvidence ? 'The baseline-history artifact captures pre-edit source and bounded blame/changes. Research must record the reason and preservation plan for every planned path, distinguishing gaps from completed investigation. Search active and deleted follow-ups. In followups.explanation, give each relevant ID its relationship (required, prerequisite, outside scope, resolved, or suspected/verified recurrence), rationale and supporting evidence. Follow older commits and associated PR discussions; distinguish the final merged patch from earlier review comments. Audit must recheck actual changed paths and these relationships. Missing pages or unavailable PRs remain explicit gaps.' : 'Legacy contract: no executable pre-edit history coverage was sealed.',
    verificationScope: 'The sealed verificationPolicy maps requirements to named cases or explicitly bounded inspection. Independent review, final audit and additional GPT review must supply oracleReviews for Node requirements, citing test files and current candidate/baseline node-inspection artifacts: evidence must list each sealed cases[].file exactly, and artifact:<path> of the *-node-inspection.json artifact from that check receipt (plus the harness:baseline:<check> one when regression is sealed). Judge assertions, fixtures, mocks, selectors, skips and test/runner changes against the requirement and history. Inspect negative-control copiedInputs: copying the fix into the baseline cannot establish a regression. Explain why the failing assertion reaches the intended old behavior; setup/import/hook failures do not qualify. Node reports are consistency evidence, not authentication of hostile test code; inspect unusual runner/IPC manipulation. An inspection-only requirement does not gain execution proof. Native requirements play sealed stories on fresh owned devices from bundled builds of this source: their oracleReviews cite each sealed story file and artifact:<path> of the current *-native-inspection.json. Judge whether each step\'s expectations prove the requirement, and look at every step picture and the video (sample frames with ffmpeg; the step pictures alone are not the video) for what the expectations cannot see: wrong look, clipping, overlap, flashes, a platform that differs.',
    researchScope: 'Research describes its recorded source, not the current candidate. Recheck claims against changed code. It is context, never implementation or test proof. Reviewers must reach their own conclusions.',
    assessmentSchema: z.toJSONSchema(assessmentFor(t.ticket.role)),
    referenceFormat: 'Every evidence or citation field (observations, findings, oracleReviews, historyReview, resolutionProposals, resolutionReviews) must be a repository-relative file path, artifact:<saved artifact filename>, or git:<full ancestor commit>:<relative file> for historical/deleted evidence. A repository path must be an existing file in the current source, not a directory. Put explanations and line/frame details in observation/detail, never in the path. An inspections.path for a supplied artifact is its packet path, with or without the artifact: prefix. Copy hashes from the packet; do not guess them.',
    referenceSnapshot: join(taskDir, '0-references.json'),
    relatedProjects: Object.values(projects),
    reconciliation: ['implementation', 'audit'].includes(t.ticket.role) ? {
      obligations: obligations(t), proposals: proposals(t),
      instructions: 'Implementation proposes fixed or refuted dispositions, with hypothesis, experiment, disconfirming evidence and regression evidence. Final audit independently accepts or rejects each exact proposal digest. No blocking obligation can be deferred. Initial review and adversary inspect blind; final audit reconciles every retained objection and failed run.',
    } : null,
  };
  const sha256 = digest(JSON.stringify(packet));
  return { marker: `SOVRAN_TASK=${t.id} TICKET=${t.ticket.id} POLICY=${t.policy} BRIEF=${sha256}`, sha256, packet };
}
