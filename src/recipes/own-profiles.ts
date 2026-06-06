// Own-profiles recipe: metadata plus follower/following counts for a small set
// of the viewer's own accounts (capped server-side at 10).

export const OWN_PROFILES_QUERY = `
query OwnProfiles($pubkeys: [String!]!) {
  ownProfiles(pubkeys: $pubkeys) {
    pubkey
    name
    displayName
    picture
    about
    nip05
    lud16
    banner
    website
    followers
    follows
    createdAt
  }
}
`;

export function ownProfilesInput(pubkeys: string[]): { pubkeys: string[] } {
  return { pubkeys: pubkeys.slice(0, 10) };
}
