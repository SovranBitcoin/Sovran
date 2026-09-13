import { getChatScrollReason, type ChatScrollState } from '@/features/ai/lib/chatScroll';

const settled: ChatScrollState = {
  conversationId: 'session-a',
  activeBranchKey: 'branch-a',
  composerHeightSettled: true,
};

describe('AI chat scroll triggers', () => {
  it('waits for composer measurement, including when switching conversations', () => {
    const unmeasured = { ...settled, composerHeightSettled: false };
    expect(getChatScrollReason(null, unmeasured)).toBeNull();
    expect(
      getChatScrollReason(unmeasured, { ...unmeasured, conversationId: 'session-b' })
    ).toBeNull();
  });

  it('scrolls once the composer is first measured', () => {
    expect(getChatScrollReason({ ...settled, composerHeightSettled: false }, settled)).toBe(
      'composer_measured'
    );
    expect(getChatScrollReason(null, settled)).toBe('composer_measured');
  });

  it('scrolls when opening another conversation', () => {
    expect(getChatScrollReason(settled, { ...settled, conversationId: 'session-b' })).toBe(
      'conversation_changed'
    );
  });

  it('scrolls when navigating to another branch', () => {
    expect(getChatScrollReason(settled, { ...settled, activeBranchKey: 'branch-b' })).toBe(
      'branch_changed'
    );
  });

  it('chooses one reason when conversation and branch change together', () => {
    expect(
      getChatScrollReason(settled, {
        ...settled,
        conversationId: 'session-b',
        activeBranchKey: 'branch-b',
      })
    ).toBe('conversation_changed');
  });

  it('does not repeat the trigger for unchanged state, streaming, or later measured heights', () => {
    expect(getChatScrollReason(settled, { ...settled })).toBeNull();
  });
});
