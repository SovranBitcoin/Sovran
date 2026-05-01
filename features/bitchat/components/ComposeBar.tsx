import React, { useCallback, useState } from 'react';
import { ChatComposer } from '@/shared/ui/composed/chat/ChatComposer';

interface ComposeBarProps {
  onSend: (content: string) => void;
  disabled?: boolean;
  /** Tag forwarded to ChatComposer's perf logs. Defaults to `bitchat-mesh`
   * since that's the only current call site, but the prop lets future
   * BLE-DM call sites differentiate without forking the component. */
  surface?: string;
}

export const ComposeBar = React.memo(function ComposeBar({
  onSend,
  disabled,
  surface = 'bitchat-mesh',
}: ComposeBarProps) {
  const [text, setText] = useState('');

  const handleSend = useCallback(() => {
    const trimmed = text.trim();
    if (!trimmed) return;
    onSend(trimmed);
    setText('');
  }, [text, onSend]);

  return (
    <ChatComposer
      value={text}
      onChangeText={setText}
      onSend={handleSend}
      disabled={disabled}
      placeholder="Message..."
      leadingIcon="mdi:bluetooth"
      surface={surface}
    />
  );
});
