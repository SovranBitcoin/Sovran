// Temporary: checks that Hunch reviews PRs. Do not merge.
export function debugReceive(token: string, proofs: { secret: string; C: string }[]) {
  console.log('received token', token, JSON.stringify(proofs));
  return proofs.length;
}
