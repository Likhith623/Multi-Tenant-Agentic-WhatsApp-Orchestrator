'use client';

import React, { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTenant } from '@/context/TenantContext';
import { supabase } from '@/lib/supabase';

function getInitials(name: string): string {
  return name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
}

// ── Broadcast Modal ───────────────────────────────────────────────────────────
function BroadcastModal({ onClose }: { onClose: () => void }) {
  const { tenants, activeTenantId } = useTenant();
  const [tenantId, setTenantId] = useState(activeTenantId ?? '');
  const [message, setMessage] = useState('');
  const [phonesRaw, setPhonesRaw] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [result, setResult] = useState<{ success: string[]; failed: string[] } | null>(null);

  const handleSend = async () => {
    const phones = phonesRaw.split(/[\n,]+/).map(p => p.trim()).filter(Boolean);
    if (!phones.length || !tenantId || !message.trim()) {
      alert('Please fill in all fields and add at least one phone number.');
      return;
    }
    setIsSending(true);
    try {
      const res = await fetch('/backend/api/broadcast', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tenant_id: tenantId, message: message.trim(), phone_numbers: phones }),
      });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      setResult(data.results);
    } catch (e) {
      alert(`Broadcast failed: ${e}`);
    } finally {
      setIsSending(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm" onClick={!isSending ? onClose : undefined} />
      <div className="relative w-full max-w-lg mx-4 silk-card rounded-2xl shadow-2xl p-6 space-y-5 animate-in fade-in zoom-in-95 duration-200">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-[18px] font-bold text-slate-800">Broadcast Campaign</h2>
            <p className="text-[13px] text-slate-500 mt-0.5">Send a custom message to multiple users at once.</p>
          </div>
          <button onClick={onClose} disabled={isSending} className="w-8 h-8 rounded-lg silk-pressed flex items-center justify-center text-slate-400 hover:text-slate-700">
            <span className="material-symbols-outlined text-[18px]">close</span>
          </button>
        </div>

        {result ? (
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-emerald-600 font-semibold">
              <span className="material-symbols-outlined">check_circle</span>
              Broadcast sent!
            </div>
            <div className="text-[13px] text-slate-600 space-y-1">
              <p>✅ Delivered: <strong>{result.success.length}</strong> numbers</p>
              {result.failed.length > 0 && <p>❌ Failed: <strong>{result.failed.length}</strong> — {result.failed.join(', ')}</p>}
            </div>
            <button onClick={onClose} className="w-full py-2.5 rounded-xl bg-indigo-500 text-white font-bold text-[14px] hover:bg-indigo-600 transition-colors">Done</button>
          </div>
        ) : (
          <>
            <div>
              <label className="block text-[11px] font-bold text-slate-500 uppercase tracking-widest mb-1.5">Tenant</label>
              <select value={tenantId} onChange={e => setTenantId(e.target.value)} className="w-full silk-pressed rounded-xl px-4 py-2.5 text-[14px] text-slate-700 focus:outline-none border border-white/60">
                <option value="">— Select a tenant —</option>
                {tenants.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-[11px] font-bold text-slate-500 uppercase tracking-widest mb-1.5">Message <span className="text-red-400">*</span></label>
              <textarea
                rows={4}
                value={message}
                onChange={e => setMessage(e.target.value)}
                placeholder="Type your broadcast message here…"
                className="w-full silk-pressed rounded-xl px-4 py-2.5 text-[14px] text-slate-700 placeholder:text-slate-300 focus:outline-none border border-white/60 resize-none"
              />
              <p className="text-[11px] text-slate-400 mt-1">Your message will be delivered to all recipients.</p>
            </div>
            <div>
              <label className="block text-[11px] font-bold text-slate-500 uppercase tracking-widest mb-1.5">Phone Numbers <span className="text-red-400">*</span></label>
              <textarea rows={4} value={phonesRaw} onChange={e => setPhonesRaw(e.target.value)} placeholder={"917993701604\n919876543210\n..."} className="w-full silk-pressed rounded-xl px-4 py-2.5 text-[13px] font-mono text-slate-700 placeholder:text-slate-300 focus:outline-none border border-white/60 resize-none" />
              <p className="text-[11px] text-slate-400 mt-1">One per line or comma-separated. Include country code, no +.</p>
            </div>
            <div className="flex gap-3 pt-1">
              <button onClick={onClose} disabled={isSending} className="flex-1 py-2.5 rounded-xl silk-extruded text-slate-600 font-semibold text-[14px] hover:text-slate-800 transition-colors disabled:opacity-50">Cancel</button>
              <button onClick={handleSend} disabled={isSending || !tenantId || !message.trim() || !phonesRaw.trim()} className="flex-1 py-2.5 rounded-xl bg-gradient-to-br from-indigo-500 to-violet-600 text-white font-bold text-[14px] shadow-lg shadow-indigo-500/20 hover:from-indigo-600 hover:to-violet-700 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2">
                {isSending ? (<><svg className="animate-spin h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg>Sending…</>) : (<><span className="material-symbols-outlined text-[18px]">campaign</span>Send Broadcast</>)}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ── Main Layout ───────────────────────────────────────────────────────────────
export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { tenants, activeTenantId, setActiveTenantId, activeTenant } = useTenant();
  const [tenantOpen, setTenantOpen] = useState(false);
  const [broadcastOpen, setBroadcastOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const [needsHumanSessions, setNeedsHumanSessions] = useState<{ id: string; customer_phone: string; updated_at: string }[]>([]);
  const notifRef = useRef<HTMLDivElement>(null);
  const pathname = usePathname();

  useEffect(() => {
    const fetchAlerts = async () => {
      const { data } = await supabase.from('sessions').select('id, customer_phone, updated_at').eq('status', 'NEEDS_HUMAN').order('updated_at', { ascending: false });
      setNeedsHumanSessions(data ?? []);
    };
    fetchAlerts();
    const channel = supabase.channel('needs-human-global').on('postgres_changes', { event: '*', schema: 'public', table: 'sessions' }, fetchAlerts).subscribe();
    return () => { supabase.removeChannel(channel); };
  }, []);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (notifRef.current && !notifRef.current.contains(e.target as Node)) setNotifOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const links = [
    { href: '/', icon: 'forum', label: 'Chat Monitor' },
    { href: '/media', icon: 'folder_shared', label: 'Media Library' },
    { href: '/appointments', icon: 'calendar_month', label: 'Appointments' },
    { href: '/tenants', icon: 'corporate_fare', label: 'Tenants' },
    { href: '/settings', icon: 'settings', label: 'Settings' },
  ].filter(link => {
    // Hide Appointments for Luxury Furniture Store
    if (link.label === 'Appointments' && activeTenant?.name?.includes('Furniture')) return false;
    return true;
  });

  return (
    <div className="flex h-screen overflow-hidden text-slate-800">
      {broadcastOpen && <BroadcastModal onClose={() => setBroadcastOpen(false)} />}

      {/* Sidebar */}
      <aside className="hidden md:flex silk-card w-[280px] flex-shrink-0 flex-col h-full py-6 sticky left-0 top-0 z-20 m-4 rounded-2xl mr-2">
        <div className="px-6 pb-6 mb-6 flex items-center gap-3 relative after:content-[''] after:absolute after:bottom-0 after:left-6 after:right-6 after:h-[1px] after:bg-gradient-to-r after:from-transparent after:via-slate-200 after:to-transparent">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-400 to-violet-500 flex items-center justify-center shadow-sm border border-white/40">
            <span className="material-symbols-outlined text-white text-[20px]">hub</span>
          </div>
          <div>
            <h1 className="text-[16px] font-extrabold silk-gradient-text tracking-tight">WhatsApp AI</h1>
            <p className="text-[11px] font-mono text-slate-400 uppercase tracking-widest mt-0.5">Orchestrator</p>
          </div>
        </div>

        <div className="px-4 mb-6 relative">
          <div className="flex items-center justify-between p-3 rounded-xl silk-extruded cursor-pointer hover:shadow-md transition-all duration-300" onClick={() => setTenantOpen(o => !o)}>
            <div className="flex items-center gap-2.5">
              <div className="w-7 h-7 rounded-lg bg-slate-100 flex items-center justify-center text-slate-600 font-bold text-xs shadow-inner">{activeTenant ? getInitials(activeTenant.name) : '..'}</div>
              <span className="text-[13px] font-semibold text-slate-800 truncate max-w-[140px]">{activeTenant?.name ?? 'Select Tenant'}</span>
            </div>
            <span className="material-symbols-outlined text-slate-400 text-lg">expand_more</span>
          </div>
          {tenantOpen && (
            <div className="absolute left-4 right-4 top-full mt-2 silk-card rounded-xl shadow-xl z-50 overflow-hidden border border-white/50">
              <div className="max-h-48 overflow-y-auto p-1">
                {tenants.map(t => (
                  <div key={t.id} onClick={() => { setActiveTenantId(t.id); setTenantOpen(false); }} className={`flex items-center gap-2.5 p-2 rounded-lg cursor-pointer transition-colors ${activeTenantId === t.id ? 'bg-indigo-500/10 border-l-2 border-indigo-500' : 'hover:bg-slate-50'}`}>
                    <div className={`w-7 h-7 rounded-lg flex items-center justify-center text-xs font-bold ${activeTenantId === t.id ? 'bg-white shadow-sm text-indigo-600' : 'bg-slate-100 text-slate-500'}`}>{getInitials(t.name)}</div>
                    <span className={`text-[13px] font-medium ${activeTenantId === t.id ? 'text-indigo-600 font-semibold' : 'text-slate-600'}`}>{t.name}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <nav className="flex-1 px-3 space-y-1.5">
          {links.map((link) => {
            const isActive = pathname === link.href;
            return (
              <Link key={link.href} href={link.href} className={`flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all group relative overflow-hidden ${isActive ? 'bg-white shadow-sm border border-slate-200/60 text-indigo-600 font-semibold' : 'text-slate-400 hover:text-slate-700 hover:bg-white/50'}`}>
                {isActive && (<><div className="absolute left-0 top-0 bottom-0 w-1 bg-gradient-to-b from-indigo-500 to-violet-500 rounded-r-full" /><div className="absolute inset-0 bg-gradient-to-r from-indigo-500/5 to-transparent" /></>)}
                <span className="material-symbols-outlined relative z-10" style={isActive ? { fontVariationSettings: "'FILL' 1" } : {}}>{link.icon}</span>
                <span className={`text-[13px] relative z-10 ${isActive ? 'font-semibold' : 'font-medium'}`}>{link.label}</span>
              </Link>
            );
          })}
        </nav>

        <div className="mt-auto px-3 pt-4 border-t border-slate-100">
          <button onClick={() => setBroadcastOpen(true)} className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-slate-400 hover:text-indigo-600 hover:bg-indigo-50/50 transition-all group">
            <span className="material-symbols-outlined">campaign</span>
            <span className="text-[13px] font-medium">Broadcast</span>
          </button>
        </div>
      </aside>

      {/* Main Workspace */}
      <div className="flex-1 flex flex-col min-w-0">
        <header className="h-20 px-6 flex justify-between items-center z-40 flex-shrink-0">
          <div className="text-[20px] font-bold text-slate-800 hidden md:block">Orchestrator</div>
          <div className="flex items-center gap-3">
            {/* Notifications */}
            <div className="relative" ref={notifRef}>
              <button onClick={() => setNotifOpen(o => !o)} className="w-10 h-10 flex items-center justify-center rounded-full text-slate-400 silk-extruded hover:text-indigo-500 transition-all relative">
                <span className="material-symbols-outlined text-[20px]">notifications</span>
                {needsHumanSessions.length > 0 && (
                  <span className="absolute top-1.5 right-1.5 min-w-[16px] h-4 bg-red-500 text-white text-[9px] font-bold rounded-full flex items-center justify-center px-1">
                    {needsHumanSessions.length}
                  </span>
                )}
              </button>
              {notifOpen && (
                <div className="absolute right-0 top-full mt-2 w-80 silk-card rounded-2xl shadow-2xl z-50 overflow-hidden border border-white/50">
                  <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
                    <span className="text-[13px] font-bold text-slate-700">Needs Human Agent</span>
                    <span className="text-[11px] font-mono text-red-500 font-semibold">{needsHumanSessions.length} alert{needsHumanSessions.length !== 1 ? 's' : ''}</span>
                  </div>
                  <div className="max-h-72 overflow-y-auto">
                    {needsHumanSessions.length === 0 ? (
                      <div className="px-4 py-8 text-center text-slate-400 text-[13px]">
                        <span className="material-symbols-outlined text-[32px] block mb-2">check_circle</span>
                        No sessions need attention
                      </div>
                    ) : (
                      needsHumanSessions.map(s => (
                        <Link key={s.id} href="/" onClick={() => setNotifOpen(false)} className="flex items-center gap-3 px-4 py-3 hover:bg-red-50/50 transition-colors border-b border-slate-50 last:border-0">
                          <div className="w-8 h-8 rounded-full bg-red-100 flex items-center justify-center flex-shrink-0">
                            <span className="material-symbols-outlined text-red-500 text-[16px]">support_agent</span>
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-[13px] font-semibold text-slate-800 truncate">{s.customer_phone}</p>
                            <p className="text-[11px] text-slate-400 font-mono">Waiting for human agent</p>
                          </div>
                          <span className="material-symbols-outlined text-slate-300 text-[16px]">chevron_right</span>
                        </Link>
                      ))
                    )}
                  </div>
                </div>
              )}
            </div>

            <div className="w-10 h-10 rounded-full silk-extruded p-0.5 cursor-pointer">
              <div className="w-full h-full rounded-full bg-gradient-to-br from-indigo-400 to-violet-500 flex items-center justify-center text-white font-bold text-[13px]">A</div>
            </div>
          </div>
        </header>
        {children}
      </div>
    </div>
  );
}
