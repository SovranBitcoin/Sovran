import { pickFinalizeMessage } from '@/features/ai/lib/finalize';

describe('pickFinalizeMessage (audit 34.json F-013)', () => {
  it('returns null when no chunks were received', () => {
    expect(pickFinalizeMessage({ fullContent: '', fullReasoning: '', chunkCount: 0 })).toBeNull();
  });

  it('persists the placeholder when neither content nor reasoning was emitted', () => {
    expect(pickFinalizeMessage({ fullContent: '', fullReasoning: '', chunkCount: 4 })).toEqual({
      content: '(No response received)',
    });
  });

  it('renders reasoning-only streams without the apologetic placeholder', () => {
    expect(
      pickFinalizeMessage({
        fullContent: '',
        fullReasoning: 'thinking through the answer',
        chunkCount: 6,
      })
    ).toEqual({ content: '', reasoningContent: 'thinking through the answer' });
  });

  it('passes content through and includes reasoning when both are present', () => {
    expect(
      pickFinalizeMessage({ fullContent: 'hello', fullReasoning: 'why', chunkCount: 2 })
    ).toEqual({ content: 'hello', reasoningContent: 'why' });
  });

  it('omits reasoningContent when reasoning is empty', () => {
    expect(pickFinalizeMessage({ fullContent: 'hello', fullReasoning: '', chunkCount: 1 })).toEqual(
      { content: 'hello', reasoningContent: undefined }
    );
  });
});
