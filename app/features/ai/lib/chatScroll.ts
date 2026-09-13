export interface ChatScrollState {
  conversationId: string | null;
  activeBranchKey: string;
  composerHeightSettled: boolean;
}

/** Streaming updates and later composer resizing must leave scroll ownership to MVCP. */
export function getChatScrollReason(prev: ChatScrollState | null, next: ChatScrollState) {
  if (!next.composerHeightSettled) return null;
  if (!prev?.composerHeightSettled) return 'composer_measured';
  if (prev.conversationId !== next.conversationId) return 'conversation_changed';
  if (prev.activeBranchKey !== next.activeBranchKey) return 'branch_changed';
  return null;
}
