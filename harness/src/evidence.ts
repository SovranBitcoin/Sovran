import { z } from 'zod';
import { digest } from './workspace';
import type { Task } from './workflow';

const text = z.string().trim().min(1);
const citations = z.array(text).min(1);
// Optional assessment extensions preserve the exact shape of historical journal inputs.
export const resolutionProposal = z.object({
  obligation: text, outcome: z.enum(['fixed', 'refuted']), explanation: text,
  hypothesis: text, experiment: text, disconfirmingEvidence: text,
  evidence: citations, regressionEvidence: citations,
});
export const resolutionReview = z.object({
  obligation: text, proposal: z.string().regex(/^[a-f0-9]{64}$/),
  decision: z.enum(['accept', 'reject', 'inconclusive']), explanation: text, evidence: citations,
});

/** Immutable origins, not a second mutable finding ledger. Failed runs survive later passes. */
export function obligations(t: Task) {
  return [
    ...t.assessments.flatMap(a => a.result.findings.filter(f => f.severity === 'blocking').map(f => ({
      id: `${a.artifact.path}#${f.id}`, source: a.source, evidence: f.evidence,
      detail: f.detail, origin: a.artifact,
    }))),
    ...t.assessments.filter(a => a.result.verdict !== 'pass' && !a.result.findings.some(f => f.severity === 'blocking')).map(a => ({
      id: `${a.artifact.path}#verdict`, source: a.source, evidence: `artifact:${a.artifact.path}`,
      detail: a.result.summary, origin: a.artifact,
    })),
    ...[...t.history, ...t.receipts].filter(r => r.outcome !== 'pass').map(r => {
      const origin = r.artifacts[0];
      if (!origin) throw new Error('Failed execution has no evidence');
      return { id: `check:${origin.path}`, source: r.source,
        evidence: `artifact:${origin.path}`, detail: `${r.id}: ${r.summary}`, origin };
    }),
  ];
}

export function proposals(t: Task) {
  return t.assessments.filter(a => a.role === 'implementation' && a.source === t.source && a.generation === t.generation)
    .flatMap(a => (a.result.resolutionProposals ?? []).map(proposal => ({
      ...proposal, digest: digest(JSON.stringify({ artifact: a.artifact, proposal })),
      artifact: a.artifact, worker: a.worker,
    })));
}

export function unresolved(t: Task) {
  const offered = proposals(t);
  const audits = t.assessments.filter(a => a.role === 'audit' && a.source === t.source &&
    a.generation === t.generation && a.result.verdict === 'pass');
  return obligations(t).filter(o => !audits.some(a => a.result.resolutionReviews?.some(r =>
    r.obligation === o.id && r.decision === 'accept' && offered.some(p =>
      p.obligation === o.id && p.digest === r.proposal && p.worker !== a.worker))));
}

export function validateResolutions(t: Task, role: string, worker: string,
  result: Task['assessments'][number]['result'], inspect: (reference: string) => void) {
  const known = obligations(t);
  const offered = proposals(t);
  for (const item of [...known.map(o => o.origin), ...offered.map(p => p.artifact)]) inspect(`artifact:${item.path}`);
  const proposed = result.resolutionProposals ?? [];
  const reviewed = result.resolutionReviews ?? [];
  if (proposed.length && role !== 'implementation') throw new Error('Only implementation proposes resolutions');
  if (reviewed.length && role !== 'audit') throw new Error('Only the independent final audit reconciles resolutions');
  for (const entries of [proposed, reviewed]) {
    if (new Set(entries.map(e => e.obligation)).size !== entries.length) throw new Error('Duplicate obligation resolution');
    for (const entry of entries) {
      if (!known.some(o => o.id === entry.obligation)) throw new Error('Unknown obligation');
      for (const ref of entry.evidence) inspect(ref);
    }
  }
  for (const p of proposed) for (const ref of p.regressionEvidence) inspect(ref);
  for (const r of reviewed) {
    const p = offered.find(p => p.obligation === r.obligation && p.digest === r.proposal);
    if (!p || p.worker === worker) throw new Error('Resolution requires an independent review of the current proposal');
  }
  if (role === 'audit' && result.verdict === 'pass') {
    const missing = known.filter(o => !reviewed.some(r => r.obligation === o.id && r.decision === 'accept'));
    if (missing.length) throw new Error(`Unresolved obligations: ${missing.map(o => o.id).join(', ')}`);
  }
}

/** The brief and acceptance gate must use the same evidence set. */
// Evidence elsewhere is cited as artifact:<file>, so a worker may name an inspected
// artifact either way. The packet hash must still match exactly.
export function inspected(result: Task['assessments'][number]['result'], item: { path: string; sha256: string }) {
  return result.inspections.some(i => (i.path === item.path || i.path === `artifact:${item.path}`) && i.sha256 === item.sha256);
}

export function assessmentArtifacts(t: Task, role: string) {
  const receipts = ['implementation', 'audit'].includes(role) ? [...t.history, ...t.receipts] : t.receipts;
  const artifacts = [...receipts.flatMap(r => r.artifacts), ...(['implementation', 'audit'].includes(role) ? t.ciObservations ?? [] : []), ...(t.historyEvidence ? [t.historyEvidence] : []), ...(role === 'audit'
    ? [...obligations(t).map(o => o.origin), ...proposals(t).map(p => p.artifact)] : [])];
  return [...new Map(artifacts.map(a => [a.path, a])).values()];
}
