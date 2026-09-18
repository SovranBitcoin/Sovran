export function formatCount(count: number): string {
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M`;
  if (count >= 1_000) return `${(count / 1_000).toFixed(1)}K`;
  return count.toString();
}

export function formatSats(sats: number): string {
  if (sats >= 100_000_000) return `${(sats / 100_000_000).toFixed(2)} BTC`;
  if (sats >= 1_000_000) return `${(sats / 1_000_000).toFixed(1)}M`;
  if (sats >= 1_000) return `${(sats / 1_000).toFixed(1)}K`;
  return sats.toString();
}

// Screen-reader labels for the post action buttons. Each branch is a whole
// sentence so the wording can be translated without gluing fragments.
export function replyActionLabel(replied: boolean, count: number): string {
  if (count === 1) return replied ? 'Replied. 1 reply.' : 'Reply. 1 reply.';
  return replied ? `Replied. ${count} replies.` : `Reply. ${count} replies.`;
}

export function repostActionLabel(reposted: boolean, count: number): string {
  if (count === 1) return reposted ? 'Reposted. 1 repost.' : 'Repost. 1 repost.';
  return reposted ? `Reposted. ${count} reposts.` : `Repost. ${count} reposts.`;
}

export function likeActionLabel(liked: boolean, count: number): string {
  if (count === 1) return liked ? 'Liked. 1 like.' : 'Like. 1 like.';
  return liked ? `Liked. ${count} likes.` : `Like. ${count} likes.`;
}

export function zapActionLabel(sats: number): string {
  return sats === 1 ? 'Zap. 1 sat zapped.' : `Zap. ${sats} sats zapped.`;
}
