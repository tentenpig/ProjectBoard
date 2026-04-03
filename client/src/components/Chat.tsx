import { useState, useEffect, useRef, useCallback } from 'react';
import { useSocket } from '../contexts/SocketContext';
import { useAuth } from '../contexts/AuthContext';

interface ChatMessage {
  nickname: string;
  text: string;
  timestamp: number;
  system?: boolean;
}

interface ChatProps {
  channel: string; // 'lobby' or roomId
}

export default function Chat({ channel }: ChatProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const socket = useSocket();
  const { user } = useAuth();
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const handleMessage = useCallback((msg: ChatMessage) => {
    setMessages((prev) => [...prev.slice(-100), msg]);
  }, []);

  useEffect(() => {
    if (!socket) return;

    const handleHistory = (history: ChatMessage[]) => {
      setMessages(history);
    };

    socket.on('chat:message', handleMessage);
    socket.on('chat:history', handleHistory);

    // Request chat history on mount / channel change
    socket.emit('chat:history', channel);

    return () => {
      socket.off('chat:message', handleMessage);
      socket.off('chat:history', handleHistory);
    };
  }, [socket, channel, handleMessage]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const sendMessage = (e: React.FormEvent) => {
    e.preventDefault();
    if (!socket || !input.trim()) return;
    socket.emit('chat:send', { channel, text: input.trim() });
    setInput('');
  };

  return (
    <div className="chat-container">
      <div className="chat-header">채팅</div>
      <div className="chat-messages">
        {messages.length === 0 && (
          <p className="chat-empty">메시지가 없습니다.</p>
        )}
        {messages.map((msg, i) => (
          <div key={i} className={`chat-msg ${msg.system ? 'chat-system' : ''} ${msg.nickname === user?.nickname ? 'chat-mine' : ''}`}>
            {msg.system ? (
              <span className="chat-text-system">{msg.text}</span>
            ) : (
              <>
                <span className="chat-nickname">{msg.nickname}</span>
                <span className="chat-text">{msg.text}</span>
              </>
            )}
          </div>
        ))}
        <div ref={messagesEndRef} />
      </div>
      <form className="chat-input" onSubmit={sendMessage}>
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="메시지 입력..."
          maxLength={200}
        />
        <button type="submit" className="btn-primary">전송</button>
      </form>
    </div>
  );
}
