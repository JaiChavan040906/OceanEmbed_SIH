import { useState, useRef, useEffect } from 'react';
import { useOceanStore } from '../store/oceanStore';
import { fetchChat } from '../api/client';
import { FiMessageCircle, FiX, FiSend, FiTrash2 } from 'react-icons/fi';

export default function ChatDrawer() {
  const {
    chatOpen, setChatOpen,
    chatHistory, addChatMessage, clearChat,
    coords, dateTime, persona,
  } = useOceanStore();

  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const messagesRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    if (messagesRef.current) {
      messagesRef.current.scrollTop = messagesRef.current.scrollHeight;
    }
  }, [chatHistory, sending]);

  const handleSend = async () => {
    const q = input.trim();
    if (!q || sending) return;

    setInput('');
    addChatMessage('user', q);
    setSending(true);

    try {
      const resp = await fetchChat(
        q,
        dateTime || undefined,
        coords.lat,
        coords.lon,
        persona,
        chatHistory.slice(-8),
      );
      addChatMessage('assistant', resp.answer);
    } catch (err) {
      addChatMessage('assistant', `Sorry, I couldn't process your question. ${err instanceof Error ? err.message : ''}`);
    } finally {
      setSending(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <>
      {/* Toggle button */}
      {!chatOpen && (
        <button
          className="chat-toggle"
          id="chat-toggle"
          onClick={() => setChatOpen(true)}
          title="Open AI Chat"
        >
          <FiMessageCircle />
        </button>
      )}

      {/* Drawer */}
      <div className={`chat-drawer ${chatOpen ? 'chat-drawer--open' : ''}`} id="chat-drawer">
        {/* Header */}
        <div className="chat-drawer__header">
          <div>
            <div className="chat-drawer__title">AI Ocean Analyst</div>
            <div style={{ fontSize: 10, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
              Context-aware • {persona}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            <button
              className="btn btn--icon"
              onClick={clearChat}
              title="Clear history"
              style={{ width: 28, height: 28, fontSize: 13 }}
            >
              <FiTrash2 />
            </button>
            <button
              className="btn btn--icon"
              onClick={() => setChatOpen(false)}
              title="Close"
              style={{ width: 28, height: 28, fontSize: 13 }}
            >
              <FiX />
            </button>
          </div>
        </div>

        {/* Messages */}
        <div className="chat-drawer__messages" ref={messagesRef}>
          {chatHistory.length === 0 && (
            <div style={{
              textAlign: 'center', padding: '40px 20px',
              color: 'var(--text-muted)', fontSize: 12,
            }}>
              <FiMessageCircle size={28} style={{ marginBottom: 12, opacity: 0.3 }} />
              <div style={{ marginBottom: 8, fontWeight: 500 }}>Ask anything about the ocean state</div>
              <div style={{ fontSize: 11, lineHeight: 1.6 }}>
                Your current pixel context ({coords.lat.toFixed(1)}°N, {coords.lon.toFixed(1)}°E)
                will be included automatically.
              </div>
              <div style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 6 }}>
                {[
                  'Why is the thermocline shallow here?',
                  'Is this area safe for fishing?',
                  'Explain the heatwave risk',
                ].map((q) => (
                  <button
                    key={q}
                    className="btn btn--ghost"
                    style={{ fontSize: 11, justifyContent: 'flex-start', padding: '6px 10px', textAlign: 'left' }}
                    onClick={() => {
                      setInput(q);
                    }}
                  >
                    "{q}"
                  </button>
                ))}
              </div>
            </div>
          )}

          {chatHistory.map((msg, i) => (
            <div key={i} className={`chat-bubble chat-bubble--${msg.role}`}>
              {msg.content}
            </div>
          ))}

          {sending && (
            <div className="typing-indicator">
              <div className="typing-indicator__dot" />
              <div className="typing-indicator__dot" />
              <div className="typing-indicator__dot" />
            </div>
          )}
        </div>

        {/* Input */}
        <div className="chat-drawer__input-row">
          <input
            type="text"
            className="chat-drawer__input"
            id="chat-input"
            placeholder="Ask about this ocean pixel…"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={sending}
          />
          <button
            className="chat-drawer__send"
            id="chat-send"
            onClick={handleSend}
            disabled={sending || !input.trim()}
          >
            <FiSend />
          </button>
        </div>
      </div>
    </>
  );
}
