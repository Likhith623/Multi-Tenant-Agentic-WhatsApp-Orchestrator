'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTenant } from '@/context/TenantContext';

function getInitials(name: string): string {
  return name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
}

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { tenants, activeTenantId, setActiveTenantId, activeTenant } = useTenant();
  const [tenantOpen, setTenantOpen] = useState(false);
  const pathname = usePathname();

  const links = [
    { href: '/', icon: 'forum', label: 'Chat Monitor' },
    { href: '/media', icon: 'folder_shared', label: 'Media Library' },
    { href: '/tenants', icon: 'corporate_fare', label: 'Tenants' },
    { href: '/settings', icon: 'settings', label: 'Settings' },
  ];

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
          {links.map((link) => {
            const isActive = pathname === link.href;
            return (
              <Link key={link.href} href={link.href} className={`flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all group relative overflow-hidden ${isActive ? 'bg-white shadow-sm border border-slate-200/60 text-indigo-600 font-semibold' : 'text-slate-400 hover:text-slate-700 hover:bg-white/50'}`}>
                {isActive && (
                  <>
                    <div className="absolute left-0 top-0 bottom-0 w-1 bg-gradient-to-b from-indigo-500 to-violet-500 rounded-r-full" />
                    <div className="absolute inset-0 bg-gradient-to-r from-indigo-500/5 to-transparent" />
                  </>
                )}
                <span className="material-symbols-outlined relative z-10" style={isActive ? { fontVariationSettings: "'FILL' 1" } : {}}>{link.icon}</span>
                <span className={`text-[13px] relative z-10 ${isActive ? 'font-semibold' : 'font-medium'}`}>{link.label}</span>
              </Link>
            );
          })}
        </nav>

        {/* Broadcast button */}
        <div className="mt-auto px-3 pt-4 border-t border-slate-100">
          <button
            onClick={() => {}}
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
                placeholder="Search..."
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

        {/* Dynamic page content */}
        {children}
      </div>
    </div>
  );
}
