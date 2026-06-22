'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { useTenant } from '@/context/TenantContext';
import { supabase } from '@/lib/supabase';
import DashboardLayout from '@/components/DashboardLayout';

interface Service {
  name: string;
  quantity: number;
  unit_cost: number;
}

interface Appointment {
  id: string;
  tenant_id: string;
  session_id: string;
  customer_phone: string;
  customer_name: string;
  vehicle_info: string;
  services: Service[];
  appointment_date: string;
  appointment_time: string;
  status: 'SCHEDULED' | 'INVOICED' | 'CANCELLED';
  invoice_url: string | null;
  total_amount: number;
  notes: string;
  created_at: string;
}

function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(amount);
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

function StatusBadge({ status }: { status: Appointment['status'] }) {
  const map = {
    SCHEDULED: { bg: 'bg-blue-50 text-blue-700 border-blue-200', icon: 'calendar_month', label: 'Scheduled' },
    INVOICED:  { bg: 'bg-emerald-50 text-emerald-700 border-emerald-200', icon: 'receipt_long', label: 'Invoiced' },
    CANCELLED: { bg: 'bg-red-50 text-red-700 border-red-200', icon: 'cancel', label: 'Cancelled' },
  };
  const s = map[status] ?? map.SCHEDULED;
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-bold uppercase tracking-widest border ${s.bg}`}>
      <span className="material-symbols-outlined text-[13px]">{s.icon}</span>
      {s.label}
    </span>
  );
}

// Appointment detail drawer
function AppointmentDrawer({ appt, onClose, onCancel, onRegenerate }: {
  appt: Appointment;
  onClose: () => void;
  onCancel: (id: string) => Promise<void>;
  onRegenerate: (id: string) => Promise<void>;
}) {
  const [cancelling, setCancelling] = useState(false);
  const [regenerating, setRegenerating] = useState(false);

  const handleCancel = async () => {
    if (!confirm('Cancel this appointment and notify the customer?')) return;
    setCancelling(true);
    await onCancel(appt.id);
    setCancelling(false);
    onClose();
  };

  const handleRegenerate = async () => {
    setRegenerating(true);
    await onRegenerate(appt.id);
    setRegenerating(false);
  };

  const subtotal = appt.services.reduce((s, sv) => s + sv.unit_cost * sv.quantity, 0);
  const gst = subtotal * 0.18;

  return (
    <div className="fixed inset-0 z-50 flex">
      <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative ml-auto w-full max-w-lg h-full bg-white shadow-2xl flex flex-col animate-in slide-in-from-right-8 duration-300">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-slate-100">
          <div>
            <h2 className="text-[18px] font-bold text-slate-800">Appointment Details</h2>
            <p className="text-[12px] text-slate-400 font-mono mt-0.5">{appt.id.slice(0, 16)}…</p>
          </div>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-xl hover:bg-slate-100 transition-colors">
            <span className="material-symbols-outlined text-slate-500">close</span>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-5">
          {/* Status + dates */}
          <div className="flex items-center justify-between">
            <StatusBadge status={appt.status} />
            <span className="text-[12px] text-slate-400 font-mono">Booked {formatDate(appt.created_at)}</span>
          </div>

          {/* Customer info */}
          <div className="silk-card rounded-xl p-4 space-y-2">
            <p className="text-[11px] font-bold text-slate-400 uppercase tracking-widest mb-2">Customer</p>
            <div className="flex items-center gap-2">
              <span className="material-symbols-outlined text-indigo-400 text-[18px]">person</span>
              <span className="font-semibold text-slate-800">{appt.customer_name || '—'}</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="material-symbols-outlined text-indigo-400 text-[18px]">phone</span>
              <span className="text-slate-600 font-mono text-[13px]">{appt.customer_phone}</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="material-symbols-outlined text-indigo-400 text-[18px]">directions_car</span>
              <span className="text-slate-600">{appt.vehicle_info || '—'}</span>
            </div>
          </div>

          {/* Appointment time */}
          <div className="silk-card rounded-xl p-4">
            <p className="text-[11px] font-bold text-slate-400 uppercase tracking-widest mb-2">Scheduled For</p>
            <p className="text-[16px] font-bold text-slate-800">{appt.appointment_date}</p>
            <p className="text-slate-500 mt-0.5">{appt.appointment_time}</p>
            {appt.notes && <p className="text-[12px] text-slate-400 mt-2 italic">{appt.notes}</p>}
          </div>

          {/* Services */}
          <div className="silk-card rounded-xl p-4">
            <p className="text-[11px] font-bold text-slate-400 uppercase tracking-widest mb-3">Services</p>
            <div className="space-y-2">
              {appt.services.map((svc, i) => (
                <div key={i} className="flex items-center justify-between">
                  <span className="text-slate-700 text-[14px]">{svc.name} × {svc.quantity}</span>
                  <span className="font-semibold text-slate-800 font-mono text-[13px]">{formatCurrency(svc.unit_cost * svc.quantity)}</span>
                </div>
              ))}
            </div>
            <div className="border-t border-slate-100 mt-3 pt-3 space-y-1">
              <div className="flex justify-between text-[12px] text-slate-500">
                <span>Subtotal</span><span>{formatCurrency(subtotal)}</span>
              </div>
              <div className="flex justify-between text-[12px] text-slate-500">
                <span>GST (18%)</span><span>{formatCurrency(gst)}</span>
              </div>
              <div className="flex justify-between font-bold text-slate-800 text-[15px] pt-1">
                <span>Total</span><span>{formatCurrency(appt.total_amount || subtotal + gst)}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Actions */}
        <div className="p-6 border-t border-slate-100 space-y-2">
          {appt.invoice_url && (
            <a
              href={appt.invoice_url}
              target="_blank"
              rel="noopener noreferrer"
              className="w-full py-2.5 rounded-xl bg-gradient-to-br from-indigo-500 to-violet-600 text-white font-bold text-[14px] shadow-lg shadow-indigo-500/20 hover:from-indigo-600 hover:to-violet-700 transition-all flex items-center justify-center gap-2"
            >
              <span className="material-symbols-outlined text-[18px]">picture_as_pdf</span>
              View Invoice PDF
            </a>
          )}
          {appt.status !== 'CANCELLED' && (
            <button
              onClick={handleRegenerate}
              disabled={regenerating}
              className="w-full py-2.5 rounded-xl silk-extruded text-indigo-600 font-bold text-[14px] hover:text-indigo-800 transition-colors flex items-center justify-center gap-2 disabled:opacity-50"
            >
              {regenerating ? (
                <svg className="animate-spin h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
              ) : <span className="material-symbols-outlined text-[18px]">refresh</span>}
              {regenerating ? 'Generating…' : 'Re-generate & Resend Invoice'}
            </button>
          )}
          {appt.status !== 'CANCELLED' && (
            <button
              onClick={handleCancel}
              disabled={cancelling}
              className="w-full py-2.5 rounded-xl text-red-500 font-bold text-[14px] hover:bg-red-50 transition-colors flex items-center justify-center gap-2 disabled:opacity-50"
            >
              <span className="material-symbols-outlined text-[18px]">cancel</span>
              {cancelling ? 'Cancelling…' : 'Cancel Appointment'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────
export default function AppointmentsPage() {
  const { activeTenant } = useTenant();
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedAppt, setSelectedAppt] = useState<Appointment | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>('ALL');
  const [search, setSearch] = useState('');

  const fetchAppointments = useCallback(async () => {
    if (!activeTenant) return;
    setLoading(true);
    try {
      const url = `/backend/api/appointments?tenant_id=${activeTenant.id}${statusFilter !== 'ALL' ? `&status=${statusFilter}` : ''}`;
      const res = await fetch(url);
      const data = await res.json();
      setAppointments(data.appointments || []);
    } catch (err) {
      console.error('[appointments] fetch error:', err);
    } finally {
      setLoading(false);
    }
  }, [activeTenant, statusFilter]);

  useEffect(() => {
    fetchAppointments();
  }, [fetchAppointments]);

  // Real-time subscription
  useEffect(() => {
    if (!activeTenant) return;
    const channel = supabase
      .channel('appointments-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'appointments', filter: `tenant_id=eq.${activeTenant.id}` },
        () => { fetchAppointments(); }
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [activeTenant, fetchAppointments]);

  const handleCancel = async (id: string) => {
    await fetch(`/backend/api/appointments/${id}/cancel`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason: 'Cancelled by staff' }),
    });
    await fetchAppointments();
  };

  const handleRegenerate = async (id: string) => {
    await fetch(`/backend/api/appointments/${id}/generate-invoice`, { method: 'POST' });
    await fetchAppointments();
  };

  const filtered = appointments.filter(a => {
    const q = search.toLowerCase();
    return !q || a.customer_name?.toLowerCase().includes(q) || a.customer_phone.includes(q) || a.vehicle_info?.toLowerCase().includes(q);
  });

  const counts = {
    ALL: appointments.length,
    SCHEDULED: appointments.filter(a => a.status === 'SCHEDULED').length,
    INVOICED: appointments.filter(a => a.status === 'INVOICED').length,
    CANCELLED: appointments.filter(a => a.status === 'CANCELLED').length,
  };

  if (!activeTenant) {
    return (
      <DashboardLayout>
        <div className="flex-1 flex items-center justify-center text-slate-400">
          <p>Please select a tenant to view appointments.</p>
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      {selectedAppt && (
        <AppointmentDrawer
          appt={selectedAppt}
          onClose={() => setSelectedAppt(null)}
          onCancel={handleCancel}
          onRegenerate={handleRegenerate}
        />
      )}

      <main className="flex-1 overflow-y-auto p-8">
        <div className="max-w-7xl mx-auto space-y-6">

          {/* Header */}
          <div className="flex justify-between items-end gap-4">
            <div>
              <h1 className="text-2xl font-bold text-slate-800 tracking-tight">Appointments</h1>
              <p className="text-slate-500 mt-1">
                Service bookings for <span className="font-semibold text-slate-700">{activeTenant.name}</span>
                <span className="ml-2 text-[12px] font-mono bg-indigo-50 text-indigo-600 px-2 py-0.5 rounded-full border border-indigo-100">
                  {counts.ALL} total
                </span>
              </p>
            </div>
            {/* Search */}
            <div className="relative w-64">
              <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm">search</span>
              <input
                type="text"
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search name, phone, vehicle…"
                className="w-full pl-9 pr-4 py-2 silk-pressed rounded-xl text-[13px] placeholder:text-slate-300 focus:outline-none border border-white/40"
              />
              {search && (
                <button onClick={() => setSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
                  <span className="material-symbols-outlined text-[16px]">close</span>
                </button>
              )}
            </div>
          </div>

          {/* Status filter tabs */}
          <div className="flex gap-2">
            {(['ALL', 'SCHEDULED', 'INVOICED', 'CANCELLED'] as const).map(s => (
              <button
                key={s}
                onClick={() => setStatusFilter(s)}
                className={`px-4 py-1.5 rounded-xl text-[12px] font-bold uppercase tracking-widest transition-all ${
                  statusFilter === s
                    ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-500/20'
                    : 'silk-extruded text-slate-500 hover:text-slate-700'
                }`}
              >
                {s} <span className="ml-1 opacity-60">{counts[s as keyof typeof counts]}</span>
              </button>
            ))}
          </div>

          {/* Stats row */}
          <div className="grid grid-cols-3 gap-4">
            {[
              { label: 'Scheduled', value: counts.SCHEDULED, color: 'text-blue-600', bg: 'bg-blue-50', icon: 'calendar_month' },
              { label: 'Invoiced', value: counts.INVOICED, color: 'text-emerald-600', bg: 'bg-emerald-50', icon: 'receipt_long' },
              { label: 'Cancelled', value: counts.CANCELLED, color: 'text-red-500', bg: 'bg-red-50', icon: 'cancel' },
            ].map(stat => (
              <div key={stat.label} className="silk-card rounded-2xl p-5 flex items-center gap-4">
                <div className={`w-11 h-11 ${stat.bg} rounded-xl flex items-center justify-center`}>
                  <span className={`material-symbols-outlined ${stat.color} text-[22px]`}>{stat.icon}</span>
                </div>
                <div>
                  <p className="text-[13px] text-slate-500">{stat.label}</p>
                  <p className={`text-2xl font-bold ${stat.color}`}>{stat.value}</p>
                </div>
              </div>
            ))}
          </div>

          {/* Table */}
          <div className="silk-card rounded-2xl overflow-hidden">
            {loading ? (
              <div className="py-20 flex items-center justify-center">
                <svg className="animate-spin h-8 w-8 text-indigo-400" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
              </div>
            ) : filtered.length === 0 ? (
              <div className="py-20 flex flex-col items-center justify-center text-slate-400 gap-3">
                <span className="material-symbols-outlined text-[48px]">calendar_month</span>
                <p className="font-semibold">No appointments found</p>
                <p className="text-[13px]">
                  {search ? 'Try a different search term' : 'Appointments booked via WhatsApp will appear here in real time'}
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-[13px]">
                  <thead>
                    <tr className="border-b border-slate-100 bg-slate-50/50">
                      <th className="px-5 py-3.5 font-bold text-slate-500 text-[11px] uppercase tracking-widest">Customer</th>
                      <th className="px-5 py-3.5 font-bold text-slate-500 text-[11px] uppercase tracking-widest">Vehicle</th>
                      <th className="px-5 py-3.5 font-bold text-slate-500 text-[11px] uppercase tracking-widest">Services</th>
                      <th className="px-5 py-3.5 font-bold text-slate-500 text-[11px] uppercase tracking-widest">Date & Time</th>
                      <th className="px-5 py-3.5 font-bold text-slate-500 text-[11px] uppercase tracking-widest">Total</th>
                      <th className="px-5 py-3.5 font-bold text-slate-500 text-[11px] uppercase tracking-widest">Status</th>
                      <th className="px-5 py-3.5 font-bold text-slate-500 text-[11px] uppercase tracking-widest">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-50">
                    {filtered.map(appt => (
                      <tr key={appt.id} className="hover:bg-indigo-50/30 transition-colors cursor-pointer" onClick={() => setSelectedAppt(appt)}>
                        <td className="px-5 py-4">
                          <p className="font-semibold text-slate-800">{appt.customer_name || '—'}</p>
                          <p className="text-slate-400 font-mono text-[11px]">{appt.customer_phone}</p>
                        </td>
                        <td className="px-5 py-4 text-slate-600">{appt.vehicle_info || '—'}</td>
                        <td className="px-5 py-4">
                          <div className="flex flex-col gap-0.5">
                            {(appt.services || []).slice(0, 2).map((svc, i) => (
                              <span key={i} className="text-slate-600 truncate max-w-[180px]">{svc.name}</span>
                            ))}
                            {(appt.services || []).length > 2 && (
                              <span className="text-[11px] text-slate-400">+{appt.services.length - 2} more</span>
                            )}
                          </div>
                        </td>
                        <td className="px-5 py-4">
                          <p className="font-semibold text-slate-700">{appt.appointment_date}</p>
                          <p className="text-slate-400 text-[12px]">{appt.appointment_time}</p>
                        </td>
                        <td className="px-5 py-4 font-bold text-slate-800 font-mono">{formatCurrency(appt.total_amount || 0)}</td>
                        <td className="px-5 py-4"><StatusBadge status={appt.status} /></td>
                        <td className="px-5 py-4">
                          <div className="flex items-center gap-1" onClick={e => e.stopPropagation()}>
                            <button
                              onClick={() => setSelectedAppt(appt)}
                              className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-indigo-50 text-slate-400 hover:text-indigo-600 transition-colors"
                              title="View details"
                            >
                              <span className="material-symbols-outlined text-[18px]">open_in_new</span>
                            </button>
                            {appt.invoice_url && (
                              <a
                                href={appt.invoice_url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-emerald-50 text-slate-400 hover:text-emerald-600 transition-colors"
                                title="View Invoice PDF"
                              >
                                <span className="material-symbols-outlined text-[18px]">picture_as_pdf</span>
                              </a>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

        </div>
      </main>
    </DashboardLayout>
  );
}
