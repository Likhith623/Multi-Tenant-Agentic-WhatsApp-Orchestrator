'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { supabase } from '@/lib/supabase';

// ─── Types ────────────────────────────────────────────────────────────────────

interface Tenant {
  id: string;
  name: string;
}

interface Session {
  id: string;
  customer_phone: string;
  status: 'WAITING_FOR_BOT' | 'AGENT_RESPONDING' | 'RESOLVED' | 'NEEDS_HUMAN';
  tenant_id: string | null;
  updated_at: string;
}

interface Message {
  id: string;          // WhatsApp message ID (wamid...)
  session_id: string;
  direction: 'inbound' | 'outbound';
  content_type: 'text' | 'image' | 'document';
  text_content: string | null;
  media_url: string | null;
  timestamp: string;   // DB column is 'timestamp', not 'created_at'
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getInitials(name: string): string {
  return name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
}

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

  // User bubble — right-aligned, gradient
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

  if (isBot) {
    // Bot bubble — left-aligned
    return (
      <div className="flex items-end gap-3 max-w-[75%]">
        <div className="w-8 h-8 rounded-full bg-gradient-to-br from-indigo-500 to-indigo-700 flex-shrink-0 flex items-center justify-center text-white mb-5 shadow-lg border border-white/20">
          <span className="material-symbols-outlined text-[16px]">smart_toy</span>
        </div>
        <div className="flex flex-col gap-1 w-full">
          <div className="silk-extruded p-3.5 rounded-2xl rounded-bl-sm">

            {/* Image type */}
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

            {/* Document type */}
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

            {/* Plain text type */}
            {msg.content_type === 'text' && (
              <p className="text-[14px] text-slate-700 leading-relaxed">{msg.text_content}</p>
            )}
          </div>
          <span className="text-[10px] font-mono text-slate-400 ml-1">Bot • {formatChatTime(msg.timestamp)}</span>
        </div>
      </div>
    );
  }
}

// ─── Broadcast Drawer ─────────────────────────────────────────────────────────

function BroadcastDrawer({ open, onClose, tenants }: { open: boolean; onClose: () => void; tenants: Tenant[] }) {
  const [selectedTenant, setSelectedTenant] = useState('all');
  const [template, setTemplate] = useState("🎉 New Catalog Available! Reply CATALOG to receive our latest collection.");
  const [sent, setSent] = useState(false);

  const handleSend = () => {
    setSent(true);
    setTimeout(() => { setSent(false); onClose(); }, 2000);
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="drawer-overlay absolute inset-0" onClick={onClose} />
      <div className="relative w-full max-w-md h-full silk-card shadow-2xl flex flex-col animate-in slide-in-from-right-full">
        {/* Header */}
        <div className="px-6 py-5 border-b border-white/50 flex items-center justify-between">
          <div>
            <h2 className="text-[18px] font-bold text-slate-800 silk-gradient-text">Broadcast Campaign</h2>
            <p className="text-[12px] font-mono text-slate-400 mt-0.5">Send template messages to a cohort</p>
          </div>
          <button onClick={onClose} className="w-9 h-9 rounded-xl silk-extruded flex items-center justify-center text-slate-400 hover:text-slate-700 transition-colors">
            <span className="material-symbols-outlined text-[20px]">close</span>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {/* Target cohort */}
          <div>
            <label className="block text-[12px] font-bold text-slate-500 uppercase tracking-widest mb-2">Target Cohort</label>
            <select
              value={selectedTenant}
              onChange={e => setSelectedTenant(e.target.value)}
              className="w-full silk-pressed rounded-xl px-4 py-3 text-[14px] text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-400/30 border border-white/60"
            >
              <option value="all">All Customers (All Tenants)</option>
              {tenants.map(t => (
                <option key={t.id} value={t.id}>{t.name} Customers</option>
              ))}
            </select>
          </div>

          {/* Template message */}
          <div>
            <label className="block text-[12px] font-bold text-slate-500 uppercase tracking-widest mb-2">Template Message</label>
            <textarea
              rows={5}
              value={template}
              onChange={e => setTemplate(e.target.value)}
              className="w-full silk-pressed rounded-xl px-4 py-3 text-[14px] text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-400/30 border border-white/60 resize-none leading-relaxed"
            />
            <p className="text-[11px] font-mono text-slate-400 mt-1.5">
              Note: WhatsApp Business API requires pre-approved message templates for broadcasts.
            </p>
          </div>

          {/* Preview */}
          <div>
            <label className="block text-[12px] font-bold text-slate-500 uppercase tracking-widest mb-2">Preview</label>
            <div className="silk-extruded rounded-2xl p-4">
              <div className="flex items-end gap-3 max-w-[85%]">
                <div className="w-7 h-7 rounded-full bg-gradient-to-br from-indigo-500 to-indigo-700 flex items-center justify-center text-white flex-shrink-0">
                  <span className="material-symbols-outlined text-[14px]">smart_toy</span>
                </div>
                <div className="silk-pressed p-3 rounded-2xl rounded-bl-sm">
                  <p className="text-[13px] text-slate-700 leading-relaxed">{template}</p>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="p-6 border-t border-white/50">
          {sent ? (
            <div className="flex items-center justify-center gap-2 py-3 rounded-xl bg-green-50 text-green-700 border border-green-200/50">
              <span className="material-symbols-outlined text-[18px]">check_circle</span>
              <span className="font-bold text-[14px]">Broadcast Queued Successfully!</span>
            </div>
          ) : (
            <button
              onClick={handleSend}
              className="w-full py-3 rounded-xl bg-gradient-to-br from-indigo-500 to-violet-600 text-white font-bold text-[14px] shadow-lg shadow-indigo-500/25 hover:shadow-indigo-500/40 hover:-translate-y-0.5 active:translate-y-0 transition-all flex items-center justify-center gap-2"
            >
              <span className="material-symbols-outlined text-[18px]">campaign</span>
              Send Broadcast
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Main Dashboard ───────────────────────────────────────────────────────────

export default function Dashboard() {
  const [tenants, setTenants]               = useState<Tenant[]>([]);
  const [activeTenantId, setActiveTenantId] = useState<string | null>(null);
  const [sessions, setSessions]             = useState<Session[]>([]);
  const [activeSession, setActiveSession]   = useState<Session | null>(null);
  const [messages, setMessages]             = useState<Message[]>([]);
  const [broadcastOpen, setBroadcastOpen]   = useState(false);
  const [tenantOpen, setTenantOpen]         = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to latest message
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, activeSession?.status]);

  // ── Fetch Tenants ────────────────────────────────────────────────────────────
  useEffect(() => {
    supabase.from('tenants').select('id, name').then(({ data }) => {
      if (data && data.length > 0) {
        setTenants(data);
        setActiveTenantId(data[0].id);
      }
    });
  }, []);

  // ── Fetch Sessions for active tenant ────────────────────────────────────────
  const fetchSessions = useCallback(async (tenantId: string) => {
    const { data, error } = await supabase
      .from('sessions')
      .select('*')
      .eq('tenant_id', tenantId)
      .order('updated_at', { ascending: false });
    if (error) console.error('[sessions] Supabase error:', error);
    if (data) setSessions(data);
  }, []);

  useEffect(() => {
    if (!activeTenantId) return;
    fetchSessions(activeTenantId);
    setActiveSession(null);
    setMessages([]);
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
          setSessions(prev => prev.map(s => s.id === updated.id ? updated : s));
          // Also update the active session status if it's the one being updated
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
        console.log('[realtime] New message:', payload.new);
        setMessages(prev => [...prev, payload.new as Message]);
      })
      .subscribe((status) => {
        console.log('[realtime] messages channel status:', status);
      });

    return () => { supabase.removeChannel(channel); };
  }, [activeSession?.id]);

  const activeTenant = tenants.find(t => t.id === activeTenantId);

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <div className="flex h-screen overflow-hidden text-slate-800">

      {/* ── Sidebar ── */}
      <aside className="hidden md:flex silk-card w-[280px] flex-shrink-0 flex-col h-full py-6 sticky left-0 top-0 z-20 m-4 rounded-2xl mr-2">
        {/* Logo */}
        <div className="px-6 pb-6 mb-6 flex items-center gap-3 relative after:content-[''] after:absolute after:bottom-0 after:left-6 after:right-6 after:h-[1px] after:bg-gradient-to-r after:from-transparent after:via-slate-200 after:to-transparent">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-400 to-violet-500 flex items-center justify-center shadow-sm border border-white/40">
            <span className="material-symbols-outlined text-white text-[20px]">hub</span>
          </div>
          <div>
            <h1 className="text-[16px] font-extrabold silk-gradient-text tracking-tight">WhatsApp AI</h1>
            <p className="text-[11px] font-mono text-slate-400 uppercase tracking-widest mt-0.5">Orchestrator</p>
          </div>
        </div>

        {/* Tenant Switcher */}
        <div className="px-4 mb-6 relative">
          <div
            className="flex items-center justify-between p-3 rounded-xl silk-extruded cursor-pointer hover:shadow-md transition-all duration-300"
            onClick={() => setTenantOpen(o => !o)}
          >
            <div className="flex items-center gap-2.5">
              <div className="w-7 h-7 rounded-lg bg-slate-100 flex items-center justify-center text-slate-600 font-bold text-xs shadow-inner">
                {activeTenant ? getInitials(activeTenant.name) : '..'}
              </div>
              <span className="text-[13px] font-semibold text-slate-800 truncate max-w-[140px]">
                {activeTenant?.name ?? 'Select Tenant'}
              </span>
            </div>
            <span className="material-symbols-outlined text-slate-400 text-lg">expand_more</span>
          </div>

          {tenantOpen && (
            <div className="absolute left-4 right-4 top-full mt-2 silk-card rounded-xl shadow-xl z-50 overflow-hidden border border-white/50">
              <div className="max-h-48 overflow-y-auto p-1">
                {tenants.map(t => (
                  <div
                    key={t.id}
                    onClick={() => { setActiveTenantId(t.id); setTenantOpen(false); }}
                    className={`flex items-center gap-2.5 p-2 rounded-lg cursor-pointer transition-colors ${activeTenantId === t.id ? 'bg-indigo-500/10 border-l-2 border-indigo-500' : 'hover:bg-slate-50'}`}
                  >
                    <div className={`w-7 h-7 rounded-lg flex items-center justify-center text-xs font-bold ${activeTenantId === t.id ? 'bg-white shadow-sm text-indigo-600' : 'bg-slate-100 text-slate-500'}`}>
                      {getInitials(t.name)}
                    </div>
                    <span className={`text-[13px] font-medium ${activeTenantId === t.id ? 'text-indigo-600 font-semibold' : 'text-slate-600'}`}>{t.name}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Nav */}
        <nav className="flex-1 px-3 space-y-1.5">
          <a href="#" className="flex items-center gap-3 px-3 py-2.5 rounded-xl bg-white shadow-sm border border-slate-200/60 text-indigo-600 font-semibold relative overflow-hidden group">
            <div className="absolute left-0 top-0 bottom-0 w-1 bg-gradient-to-b from-indigo-500 to-violet-500 rounded-r-full" />
            <div className="absolute inset-0 bg-gradient-to-r from-indigo-500/5 to-transparent" />
            <span className="material-symbols-outlined relative z-10" style={{ fontVariationSettings: "'FILL' 1" }}>forum</span>
            <span className="text-[13px] font-semibold relative z-10">Chat Monitor</span>
          </a>
          <a href="#" className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-slate-400 hover:text-slate-700 hover:bg-white/50 transition-all group">
            <span className="material-symbols-outlined">folder_shared</span>
            <span className="text-[13px] font-medium">Media Library</span>
          </a>
          <a href="#" className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-slate-400 hover:text-slate-700 hover:bg-white/50 transition-all group">
            <span className="material-symbols-outlined">corporate_fare</span>
            <span className="text-[13px] font-medium">Tenants</span>
          </a>
          <a href="#" className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-slate-400 hover:text-slate-700 hover:bg-white/50 transition-all group">
            <span className="material-symbols-outlined">settings</span>
            <span className="text-[13px] font-medium">Settings</span>
          </a>
        </nav>

        {/* Broadcast button */}
        <div className="mt-auto px-3 pt-4 border-t border-slate-100">
          <button
            onClick={() => setBroadcastOpen(true)}
            className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-slate-400 hover:text-indigo-600 hover:bg-indigo-50/50 transition-all group"
          >
            <span className="material-symbols-outlined">campaign</span>
            <span className="text-[13px] font-medium">Broadcast</span>
          </button>
        </div>
      </aside>

      {/* ── Main Workspace ── */}
      <div className="flex-1 flex flex-col min-w-0">

        {/* Top nav */}
        <header className="h-20 px-6 flex justify-between items-center z-40 flex-shrink-0">
          <div className="text-[20px] font-bold text-slate-800 hidden md:block">Orchestrator</div>
          <div className="flex items-center gap-3">
            <div className="relative hidden sm:block w-64">
              <span className="material-symbols-outlined absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 text-sm z-10">search</span>
              <input
                className="w-full pl-10 pr-4 py-2 silk-pressed rounded-full text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400/30 border border-white/40 placeholder:text-slate-400 shadow-inner bg-white/40"
                placeholder="Search chats, clients..."
                type="text"
              />
            </div>
            <button className="w-10 h-10 flex items-center justify-center rounded-full text-slate-400 silk-extruded hover:text-indigo-500 transition-all relative">
              <span className="material-symbols-outlined text-[20px]">notifications</span>
              <span className="absolute top-2 right-2.5 w-2 h-2 bg-red-500 rounded-full" />
            </button>
            <div className="w-10 h-10 rounded-full silk-extruded p-0.5 cursor-pointer">
              <div className="w-full h-full rounded-full bg-gradient-to-br from-indigo-400 to-violet-500 flex items-center justify-center text-white font-bold text-[13px]">
                A
              </div>
            </div>
          </div>
        </header>

        {/* Chat workspace */}
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
                    onClick={() => setActiveSession(session)}
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
                <div className="flex-1 overflow-y-auto p-6 space-y-5 relative">
                  {/* Background glows */}
                  <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-indigo-500/5 rounded-full blur-3xl pointer-events-none" />
                  <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-violet-500/5 rounded-full blur-3xl pointer-events-none" />

                  {/* Session start */}
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

                  {/* Live typing indicator */}
                  {activeSession.status === 'AGENT_RESPONDING' && (
                    <div className="relative z-10">
                      <TypingIndicator />
                    </div>
                  )}

                  <div ref={messagesEndRef} />
                </div>

                {/* Input footer — read-only (bot-only mode) */}
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
      </div>

      {/* Broadcast Drawer */}
      <BroadcastDrawer open={broadcastOpen} onClose={() => setBroadcastOpen(false)} tenants={tenants} />
    </div>
  );
}
