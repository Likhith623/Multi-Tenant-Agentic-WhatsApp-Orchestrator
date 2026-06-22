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
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const chatCanvasRef = useRef<HTMLDivElement>(null);

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
    const channel = supabase
      .channel(`messages-session-${activeSession.id}`)
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'messages',
        filter: `session_id=eq.${activeSession.id}`,
      }, (payload) => {
        setMessages(prev => [...prev, payload.new as Message]);
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [activeSession?.id]);

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
          <div className="flex-1 overflow-y-auto p-3 space-y-2">
            {sessions.length === 0 && (
              <div className="flex flex-col items-center justify-center h-40 text-slate-400">
                <span className="material-symbols-outlined text-[40px] mb-2">forum</span>
                <p className="text-[13px]">No sessions yet</p>
              </div>
            )}
            {sessions.map(session => {
              const isActive = activeSession?.id === session.id;
              return (
                <div
                  key={session.id}
                  onClick={() => {
                    setActiveSession(session);
                    localStorage.setItem('activeSessionId', session.id);
                  }}
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
                <div className="flex items-center gap-2">
                  <StatusBadge status={activeSession.status} />
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
                <div className="mb-4 px-4 py-2.5 silk-pressed rounded-xl flex items-center justify-between border border-white/60">
                  <div className="flex items-center gap-2.5 text-slate-400">
                    <span className="material-symbols-outlined text-[18px]">smart_toy</span>
                    <span className="text-[13px]">Currently in <strong className="text-slate-700">Bot-Only</strong> mode.</span>
                  </div>
                  <button className="silk-extruded hover:text-indigo-600 px-4 py-1.5 rounded-lg text-[12px] font-bold transition-all text-slate-600">
                    Override & Take Over
                  </button>
                </div>
                <div className="flex items-end gap-3">
                  <button disabled className="w-11 h-11 silk-extruded text-slate-300 rounded-xl flex items-center justify-center cursor-not-allowed opacity-50">
                    <span className="material-symbols-outlined text-[24px]">add</span>
                  </button>
                  <div className="flex-1">
                    <textarea
                      disabled
                      rows={1}
                      placeholder="Type a message..."
                      className="w-full silk-pressed border border-white/60 rounded-2xl pl-4 pr-12 py-3.5 text-[14px] text-slate-700 placeholder:text-slate-300 focus:outline-none resize-none opacity-60 cursor-not-allowed shadow-inner"
                    />
                  </div>
                  <button disabled className="w-12 h-12 silk-pressed text-slate-300 rounded-xl flex items-center justify-center cursor-not-allowed opacity-60">
                    <span className="material-symbols-outlined">send</span>
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
