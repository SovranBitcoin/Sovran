// Follow-status recipe: a single round-trip that returns the follow relationship
// between the viewer and each candidate (following / follows-you / mutual).

export type FollowStatusInput = {
  viewer: string;
  candidates: string[];
};

export type FollowRelationship = 'following' | 'follows_you' | 'mutual' | 'none';

export function followStatusInput(options: FollowStatusInput): FollowStatusInput {
  return {
    viewer: options.viewer,
    candidates: options.candidates.slice(0, 500),
  };
}
