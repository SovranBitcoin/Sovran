// Own-profiles recipe: metadata plus follower/following counts for a small set
// of the viewer's own accounts (capped server-side at 10).

export function ownProfilesInput(pubkeys: string[]): { pubkeys: string[] } {
  return { pubkeys: pubkeys.slice(0, 10) };
}
