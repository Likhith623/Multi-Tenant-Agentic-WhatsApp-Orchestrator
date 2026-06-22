'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { useTenant } from '@/context/TenantContext';
import { Session, Message, Tenant } from '@/types';
import DashboardLayout from '@/components/DashboardLayout';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatTime(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return 'Just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffMin < 1440) return `${Math.floor(diffMin / 60)}h ago`;
  return d.toLocaleDateString();
}

function formatChatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

// ─── Badge Component ──────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: Session['status'] }) {
  const map: Record<Session['status'], { cls: string; label: string }> = {
    AGENT_RESPONDING: { cls: 'badge-responding', label: 'AGENT_RESPONDING' },
    WAITING_FOR_BOT:  { cls: 'badge-waiting',    label: 'WAITING_FOR_BOT'  },
    RESOLVED:         { cls: 'badge-resolved',   label: 'RESOLVED'         },
    NEEDS_HUMAN:      { cls: 'badge-needs-human', label: 'NEEDS_HUMAN'     },
  };
  const { cls, label } = map[status] ?? map.WAITING_FOR_BOT;
  return (
    <span className={`inline-flex items-center px-2.5 py-1 rounded-lg text-[10px] font-bold uppercase tracking-wider ${cls}`}>
      {label}
    </span>
  );
}

// ─── Typing Indicator ─────────────────────────────────────────────────────────

function TypingIndicator() {
  return (
    <div className="flex items-end gap-3 max-w-[75%]">
      <div className="w-8 h-8 rounded-full bg-gradient-to-br from-indigo-500 to-indigo-700 flex-shrink-0 flex items-center justify-center text-white mb-5 shadow-lg border border-white/20">
        <span className="material-symbols-outlined text-[16px]">smart_toy</span>
      </div>
      <div className="silk-extruded px-4 py-3 rounded-2xl rounded-bl-sm flex items-center gap-2 h-[44px] mb-5 border-l-2 border-indigo-500">
        <svg className="w-5 h-5 text-indigo-500" viewBox="0 0 24 24">
          <circle className="typing-dot" cx="4"  cy="12" r="2.5" />
          <circle className="typing-dot" cx="12" cy="12" r="2.5" />
          <circle className="typing-dot" cx="20" cy="12" r="2.5" />
        </svg>
        <span className="text-[12px] text-slate-400 ml-1 font-mono font-medium">Bot typing...</span>
      </div>
    </div>
  );
}

// ─── Chat Bubble ─────────────────────────────────────────────────────────────

function ChatBubble({ msg }: { msg: Message }) {
  const isBot = msg.direction === 'outbound';

  if (!isBot) {
    return (
      <div className="flex items-end gap-3 max-w-[75%] ml-auto justify-end">
        <div className="flex flex-col gap-1 items-end w-full">
          <div className="bg-gradient-to-br from-indigo-500 to-indigo-700 text-white p-4 rounded-2xl rounded-br-sm shadow-lg border border-indigo-300/30">
            <p className="text-[14px] leading-relaxed">{msg.text_content}</p>
          </div>
          <span className="text-[10px] font-mono text-slate-400 mr-1">{formatChatTime(msg.timestamp)}</span>
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-end gap-3 max-w-[75%]">
      <div className="w-8 h-8 rounded-full bg-gradient-to-br from-indigo-500 to-indigo-700 flex-shrink-0 flex items-center justify-center text-white mb-5 shadow-lg border border-white/20">
        <span className="material-symbols-outlined text-[16px]">smart_toy</span>
      </div>
      <div className="flex flex-col gap-1 w-full">
        <div className="silk-extruded p-3.5 rounded-2xl rounded-bl-sm">
          {msg.content_type === 'image' && msg.media_url && (
            <div className="mb-2">
              <div className="rounded-xl overflow-hidden mb-2 border border-slate-200/50">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={msg.media_url} alt="Bot sent image" className="w-full max-h-56 object-cover" />
              </div>
              {msg.text_content && (
                <p className="text-[14px] text-slate-700 leading-relaxed">{msg.text_content}</p>
              )}
            </div>
          )}

          {msg.content_type === 'document' && (
            <div>
              {msg.text_content && (
                <p className="text-[14px] text-slate-700 leading-relaxed mb-3">{msg.text_content}</p>
              )}
              <a
                href={msg.media_url ?? '#'}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center p-2.5 silk-pressed rounded-xl group/pdf hover:bg-white/60 transition-all border border-white/50"
              >
                <div className="w-9 h-9 rounded-lg bg-red-50 text-red-500 flex items-center justify-center mr-3 border border-red-100/50">
                  <span className="material-symbols-outlined">picture_as_pdf</span>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[13px] text-slate-800 font-semibold truncate">Document</p>
                  <p className="text-[11px] font-mono text-slate-400 mt-0.5">PDF • Click to open</p>
                </div>
                <span className="material-symbols-outlined text-slate-400 text-[18px] group-hover/pdf:text-indigo-500 transition-colors">open_in_new</span>
              </a>
            </div>
          )}

          {msg.content_type === 'text' && (
            <p className="text-[14px] text-slate-700 leading-relaxed">{msg.text_content}</p>
          )}
        </div>
        <span className="text-[10px] font-mono text-slate-400 ml-1">Bot • {formatChatTime(msg.timestamp)}</span>
      </div>
    </div>
  );
}

// ─── Main Dashboard ───────────────────────────────────────────────────────────

export default function Dashboard() {
  const { activeTenantId, activeTenant, tenants } = useTenant();
  
  const [sessions, setSessions]             = useState<Session[]>([]);
  const [activeSession, setActiveSession]   = useState<Session | null>(null);
  const [messages, setMessages]             = useState<Message[]>([]);
  const [isResolving, setIsResolving]       = useState(false);

  const [chatInput, setChatInput] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [isTakingOver, setIsTakingOver] = useState(false);
  const [sessionSearch, setSessionSearch] = useState('');
  
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const chatCanvasRef = useRef<HTMLDivElement>(null);
  const typingDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Auto-scroll to latest message
  useEffect(() => {
    if (chatCanvasRef.current) {
      chatCanvasRef.current.scrollTo({
        top: chatCanvasRef.current.scrollHeight,
        behavior: 'smooth'
      });
    }
  }, [messages, activeSession?.status]);

  // ── Fetch Sessions for active tenant ────────────────────────────────────────
  const fetchSessions = useCallback(async (tenantId: string) => {
    const { data, error } = await supabase
      .from('sessions')
      .select('*')
      .eq('tenant_id', tenantId)
      .order('updated_at', { ascending: false });
    if (error) console.error('[sessions] Supabase error:', error);
    if (data) {
      setSessions(data);
      const savedSessionId = localStorage.getItem('activeSessionId');
      if (savedSessionId) {
        const sessionToRestore = data.find(s => s.id === savedSessionId);
        if (sessionToRestore) {
          setActiveSession(sessionToRestore);
        }
      }
    }
  }, []);

  useEffect(() => {
    if (!activeTenantId) return;
    fetchSessions(activeTenantId);
    
    // Only reset activeSession if the newly selected tenant doesn't contain the currently active session
    setActiveSession(prev => {
      if (prev && prev.tenant_id !== activeTenantId) return null;
      return prev;
    });
  }, [activeTenantId, fetchSessions]);

  // ── Real-time: sessions status updates ──────────────────────────────────────
  useEffect(() => {
    if (!activeTenantId) return;
    const channel = supabase
      .channel(`sessions-tenant-${activeTenantId}`)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'sessions',
        filter: `tenant_id=eq.${activeTenantId}`,
      }, (payload) => {
        if (payload.eventType === 'INSERT') {
          setSessions(prev => [payload.new as Session, ...prev]);
        } else if (payload.eventType === 'UPDATE') {
          const updated = payload.new as Session;
          setSessions(prev => {
            const filtered = prev.filter(s => s.id !== updated.id);
            return [updated, ...filtered].sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime());
          });
          setActiveSession(prev => prev?.id === updated.id ? { ...prev, ...updated } : prev);
        }
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [activeTenantId]);

  // ── Fetch Messages for active session ───────────────────────────────────────
  useEffect(() => {
    if (!activeSession) return;
    supabase
      .from('messages')
      .select('*')
      .eq('session_id', activeSession.id)
      .order('timestamp', { ascending: true })
      .then(({ data, error }) => {
        if (error) console.error('[messages] Supabase error:', error);
        if (data) setMessages(data);
      });
  }, [activeSession?.id]);

  // ── Real-time: new messages ──────────────────────────────────────────────────
  useEffect(() => {
    if (!activeSession) return;
    const sessionId = activeSession.id;
    const sessionStatus = activeSession.status;
    const customerPhone = activeSession.customer_phone;

    const channel = supabase
      .channel(`messages-session-${sessionId}`)
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'messages',
        filter: `session_id=eq.${sessionId}`,
      }, (payload) => {
        const newMsg = payload.new as Message;
        setMessages(prev => [...prev, newMsg]);

        // Auto blue-tick: when a new customer message arrives while the
        // human agent is already viewing this NEEDS_HUMAN session.
        if (newMsg.direction === 'inbound' && sessionStatus === 'NEEDS_HUMAN') {
          fetch(`/backend/api/sessions/${sessionId}/read`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ customer_phone: customerPhone }),
          }).catch(console.error);
        }
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [activeSession?.id, activeSession?.status, activeSession?.customer_phone]);


  // ── Resolve Session ──────────────────────────────────────────────────────────
  const handleResolveSession = async () => {
    if (!activeSession || activeSession.status === 'RESOLVED') return;
    if (!confirm(`Mark conversation with ${activeSession.customer_phone} as Resolved?\n\nThe bot will automatically start a fresh session the next time this customer messages.`)) return;

    setIsResolving(true);
    const { error } = await supabase
      .from('sessions')
      .update({ status: 'RESOLVED', updated_at: new Date().toISOString() })
      .eq('id', activeSession.id);

    setIsResolving(false);
    if (error) {
      alert('Failed to resolve session: ' + error.message);
    } else {
      // Optimistically update local state
      setActiveSession(prev => prev ? { ...prev, status: 'RESOLVED' } : prev);
    }
  };

  const handleTakeOver = async () => {
    if (!activeSession) return;
    try {
      setIsTakingOver(true);
      const res = await fetch('/backend/api/messages/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          session_id: activeSession.id,
          customer_phone: activeSession.customer_phone,
          text: "We are currently transferring you to a human agent.",
          override: true
        })
      });
      if (!res.ok) throw new Error("Takeover failed");
      setActiveSession({ ...activeSession, status: 'NEEDS_HUMAN' });
    } catch (error) {
      console.error(error);
      alert("Failed to take over session.");
    } finally {
      setIsTakingOver(false);
    }
  };

  const handleSendMessage = async () => {
    if (!activeSession || !chatInput.trim() || isSending) return;
    try {
      setIsSending(true);
      const textToSend = chatInput;
      setChatInput(''); // Optimistically clear input
      
      const res = await fetch('/backend/api/messages/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          session_id: activeSession.id,
          customer_phone: activeSession.customer_phone,
          text: textToSend,
          override: false
        })
      });
      
      if (!res.ok) {
        setChatInput(textToSend); // Revert input on fail
        throw new Error("Failed to send message");
      }
    } catch (error) {
      console.error(error);
      alert("Failed to send message.");
    } finally {
      setIsSending(false);
    }
  };

  const handleSelectSession = async (session: Session) => {
    setActiveSession(session);
    localStorage.setItem('activeSessionId', session.id);

    // Send blue ticks the moment the human agent opens a NEEDS_HUMAN session
    if (session.status === 'NEEDS_HUMAN') {
      try {
        await fetch(`/backend/api/sessions/${session.id}/read`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ customer_phone: session.customer_phone }),
        });
      } catch (err) {
        console.error('[read-receipt] Failed to send blue ticks:', err);
      }
    }
  };

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <DashboardLayout>
      <main className="flex-1 flex overflow-hidden pb-4 px-4 gap-4 max-w-[1440px] mx-auto w-full">
        {/* Session List Panel */}
        <div className="w-full md:w-[420px] flex-shrink-0 silk-card rounded-2xl flex flex-col overflow-hidden h-full z-10">
          <div className="p-5 border-b border-white/40 flex justify-between items-center bg-white/30 backdrop-blur-md">
            <h2 className="text-[20px] font-bold text-slate-800 tracking-tight">Active Sessions</h2>
            <span className="bg-indigo-500/10 text-indigo-600 px-3 py-1 rounded-full font-mono text-[12px] font-semibold border border-indigo-500/20">
              {sessions.length} Active
            </span>
          </div>
          <div className="px-5 py-3 border-b border-white/30 flex gap-6 overflow-x-auto no-scrollbar bg-white/20">
            <button className="text-[13px] text-indigo-600 border-b-2 border-indigo-500 pb-1 whitespace-nowrap font-semibold">All Chats</button>
            <button className="text-[13px] text-slate-400 pb-1 whitespace-nowrap hover:text-slate-700 transition-colors">
              Needs Human ({sessions.filter(s => s.status === 'NEEDS_HUMAN').length})
            </button>
            <button className="text-[13px] text-slate-400 pb-1 whitespace-nowrap hover:text-slate-700 transition-colors">
              Resolved ({sessions.filter(s => s.status === 'RESOLVED').length})
            </button>
          </div>
          {/* Search bar */}
          <div className="px-3 pt-3 pb-1">
            <div className="relative">
              <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm">search</span>
              <input
                type="text"
                value={sessionSearch}
                onChange={e => setSessionSearch(e.target.value)}
                placeholder="Search by phone number…"
                className="w-full pl-9 pr-4 py-2 silk-pressed rounded-xl text-[13px] placeholder:text-slate-300 focus:outline-none border border-white/40"
              />
              {sessionSearch && (
                <button onClick={() => setSessionSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
                  <span className="material-symbols-outlined text-[16px]">close</span>
                </button>
              )}
            </div>
          </div>
          <div className="flex-1 overflow-y-auto p-3 space-y-2">
            {sessions.filter(s => s.customer_phone.includes(sessionSearch.trim())).length === 0 && (
              <div className="flex flex-col items-center justify-center h-40 text-slate-400">
                <span className="material-symbols-outlined text-[40px] mb-2">forum</span>
                <p className="text-[13px]">{sessionSearch ? 'No matching sessions' : 'No sessions yet'}</p>
              </div>
            )}
            {sessions.filter(s => s.customer_phone.includes(sessionSearch.trim())).map(session => {
              const isActive = activeSession?.id === session.id;
              return (
                <div
                  key={session.id}
                  onClick={() => { void handleSelectSession(session); }}
                  className={`p-4 rounded-xl cursor-pointer relative transition-all ${isActive ? 'silk-extruded shadow-md border-indigo-300/30' : 'silk-pressed hover:bg-white/40 border border-transparent hover:border-white/50'}`}
                >
                  {isActive && <div className="absolute left-0 top-3 bottom-3 w-1 bg-gradient-to-b from-indigo-500 to-violet-500 rounded-r-full" />}
                  <div className={`flex justify-between items-start mb-1.5 ${isActive ? 'pl-2' : ''}`}>
                    <span className={`text-[15px] font-bold ${isActive ? 'text-indigo-600' : 'text-slate-700'}`}>
                      {session.customer_phone}
                    </span>
                    <span className={`font-mono text-[11px] ${isActive ? 'text-indigo-500 font-semibold' : 'text-slate-400'}`}>
                      {formatTime(session.updated_at)}
                    </span>
                  </div>
                  <div className={`flex items-center justify-between ${isActive ? 'pl-2' : ''}`}>
                    <StatusBadge status={session.status} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Chat Window Panel */}
        <div className="hidden md:flex flex-1 silk-card rounded-2xl flex-col h-full relative overflow-hidden z-0">
          {!activeSession ? (
            <div className="flex-1 flex flex-col items-center justify-center text-slate-400">
              <div className="w-20 h-20 rounded-2xl silk-extruded flex items-center justify-center mb-4">
                <span className="material-symbols-outlined text-[40px] text-indigo-300">chat_bubble</span>
              </div>
              <p className="text-[15px] font-medium text-slate-500">Select a session to view the conversation</p>
              <p className="text-[12px] font-mono text-slate-400 mt-1">Pick a chat from the left panel</p>
            </div>
          ) : (
            <>
              {/* Thread header */}
              <div className="px-6 py-4 border-b border-white/40 bg-white/40 backdrop-blur-md flex justify-between items-center z-10 flex-shrink-0 shadow-[0_4px_20px_-10px_rgba(0,0,0,0.05)]">
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 rounded-2xl silk-extruded flex items-center justify-center text-indigo-500 relative overflow-hidden">
                    <div className="absolute inset-0 bg-gradient-to-br from-indigo-500/10 to-violet-500/10" />
                    <span className="material-symbols-outlined relative z-10">person</span>
                  </div>
                  <div>
                    <h3 className="text-[18px] font-bold text-slate-800 flex items-center gap-2">
                      {activeSession.customer_phone}
                    </h3>
                    <p className="font-mono text-[11px] text-slate-400 mt-0.5">
                      WhatsApp Business API • {activeTenant?.name}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <StatusBadge status={activeSession.status} />
                  {activeSession.status !== 'RESOLVED' && (
                    <button
                      onClick={handleResolveSession}
                      disabled={isResolving}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-bold text-emerald-600 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                      title="Mark this conversation as resolved"
                    >
                      {isResolving ? (
                        <svg className="animate-spin h-3.5 w-3.5" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                        </svg>
                      ) : (
                        <span className="material-symbols-outlined text-[15px]">check_circle</span>
                      )}
                      {isResolving ? 'Resolving…' : 'Resolve'}
                    </button>
                  )}
                  {activeSession.status === 'RESOLVED' && (
                    <span className="flex items-center gap-1 text-[12px] text-emerald-600 font-semibold">
                      <span className="material-symbols-outlined text-[15px]">check_circle</span>
                      Resolved — next message starts a new session
                    </span>
                  )}
                </div>
              </div>

              {/* Chat canvas */}
              <div ref={chatCanvasRef} className="flex-1 overflow-y-auto p-6 space-y-5 relative">
                <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-indigo-500/5 rounded-full blur-3xl pointer-events-none" />
                <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-violet-500/5 rounded-full blur-3xl pointer-events-none" />

                <div className="flex justify-center relative z-10">
                  <div className="bg-white/60 backdrop-blur-md px-4 py-1.5 rounded-full text-[11px] font-mono text-slate-400 shadow-sm border border-white/80">
                    Session started • {new Date(activeSession.updated_at).toLocaleDateString()}
                  </div>
                </div>

                {messages.map(msg => (
                  <div key={msg.id} className="relative z-10">
                    <ChatBubble msg={msg} />
                  </div>
                ))}

                {activeSession.status === 'AGENT_RESPONDING' && (
                  <div className="relative z-10">
                    <TypingIndicator />
                  </div>
                )}
                <div ref={messagesEndRef} />
              </div>

              {/* Input footer */}
              <div className="p-5 bg-white/60 backdrop-blur-xl border-t border-white/80 z-20 flex-shrink-0">
                
                {/* Status indicator / Take over */}
                <div className="mb-4 px-4 py-2.5 silk-pressed rounded-xl flex items-center justify-between border border-white/60">
                  {activeSession.status !== 'NEEDS_HUMAN' ? (
                    <>
                      <div className="flex items-center gap-2.5 text-slate-400">
                        <span className="material-symbols-outlined text-[18px]">smart_toy</span>
                        <span className="text-[13px]">Currently in <strong className="text-slate-700">Bot-Only</strong> mode.</span>
                      </div>
                      <button 
                        onClick={handleTakeOver}
                        disabled={isTakingOver || activeSession.status === 'RESOLVED'}
                        className="silk-extruded hover:text-indigo-600 px-4 py-1.5 rounded-lg text-[12px] font-bold transition-all text-slate-600 disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {isTakingOver ? 'Taking over...' : 'Override & Take Over'}
                      </button>
                    </>
                  ) : (
                    <>
                      <div className="flex items-center gap-2.5 text-indigo-500">
                        <span className="material-symbols-outlined text-[18px]">support_agent</span>
                        <span className="text-[13px] font-bold">Human Agent Active.</span>
                      </div>
                      <span className="text-[12px] text-slate-400 font-medium">Bot replies are paused.</span>
                    </>
                  )}
                </div>

                {/* Chat box */}
                <div className="flex items-end gap-3">
                  <button disabled className="w-11 h-11 silk-extruded text-slate-300 rounded-xl flex items-center justify-center cursor-not-allowed opacity-50">
                    <span className="material-symbols-outlined text-[24px]">add</span>
                  </button>
                  <div className="flex-1">
                    <textarea
                      disabled={activeSession.status !== 'NEEDS_HUMAN' || isSending}
                      rows={1}
                      value={chatInput}
                      onChange={(e) => {
                        setChatInput(e.target.value);
                        // Debounced typing indicator: fires after 400ms of inactivity
                        if (typingDebounceRef.current) clearTimeout(typingDebounceRef.current);
                        typingDebounceRef.current = setTimeout(() => {
                          if (activeSession?.status === 'NEEDS_HUMAN') {
                            fetch(`/backend/api/sessions/${activeSession.id}/read`, {
                              method: 'POST',
                              headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify({ customer_phone: activeSession.customer_phone }),
                            }).catch(console.error);
                          }
                        }, 400);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && !e.shiftKey) {
                          e.preventDefault();
                          handleSendMessage();
                        }
                      }}
                      placeholder={activeSession.status === 'NEEDS_HUMAN' ? "Type your message..." : "Take over to type a message..."}
                      className="w-full silk-pressed border border-white/60 rounded-2xl pl-4 pr-12 py-3.5 text-[14px] text-slate-700 placeholder:text-slate-300 focus:outline-none resize-none disabled:opacity-60 disabled:cursor-not-allowed shadow-inner"
                    />
                  </div>
                  <button 
                    onClick={handleSendMessage}
                    disabled={activeSession.status !== 'NEEDS_HUMAN' || !chatInput.trim() || isSending}
                    className={`w-12 h-12 rounded-xl flex items-center justify-center transition-all ${
                      activeSession.status === 'NEEDS_HUMAN' && chatInput.trim() && !isSending
                        ? 'bg-indigo-500 text-white shadow-md hover:bg-indigo-600'
                        : 'silk-pressed text-slate-300 opacity-60 cursor-not-allowed'
                    }`}
                  >
                    {isSending ? (
                      <svg className="animate-spin h-5 w-5" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                      </svg>
                    ) : (
                      <span className="material-symbols-outlined">send</span>
                    )}
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      </main>
    </DashboardLayout>
  );
}
