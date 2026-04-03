import { useState } from 'react';
import Chat from './Chat';

interface ChatPanelProps {
  channel: string;
}

export default function ChatPanel({ channel }: ChatPanelProps) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <div className={`page-chat ${open ? 'chat-open' : ''}`}>
        <div className="chat-panel-header mobile-only">
          <span>채팅</span>
          <button onClick={() => setOpen(false)} className="btn-secondary btn-small">닫기</button>
        </div>
        <Chat channel={channel} />
      </div>
      <button className="chat-fab mobile-only" onClick={() => setOpen(!open)}>
        {open ? '✕' : '💬'}
      </button>
      {open && <div className="chat-backdrop mobile-only" onClick={() => setOpen(false)} />}
    </>
  );
}
