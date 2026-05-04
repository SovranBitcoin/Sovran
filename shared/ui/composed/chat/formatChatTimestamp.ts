/**
 * Display formatter shared by every chat surface that renders a single
 * message bubble (BitChat geohash, BitChat DM, White Noise DM, Routstr
 * 1:1 messages). Input is **unix epoch milliseconds** to match
 * `ChatBubbleMessage.timestamp`; callers holding a Nostr `created_at`
 * (unix seconds) must convert at the seam so the unit divergence is
 * explicit instead of hidden inside the formatter.
 */
export function formatChatTimestamp(unixMs: number): string {
  const date = new Date(unixMs);
  const diffInHours = (Date.now() - date.getTime()) / (1000 * 60 * 60);
  if (diffInHours < 24) {
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }
  if (diffInHours < 48) return 'Yesterday';
  return date.toLocaleDateString();
}
