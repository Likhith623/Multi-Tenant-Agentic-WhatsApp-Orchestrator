'use client';

import React, { useState } from 'react';
import { useTenant } from '@/context/TenantContext';
import { supabase } from '@/lib/supabase';
import DashboardLayout from '@/components/DashboardLayout';

export default function TenantsPage() {
  const { tenants, refreshTenants } = useTenant();
  const [isCreating, setIsCreating] = useState(false);

  const handleCreateTenant = async () => {
    const name = prompt("Enter the name of the new tenant:");
    if (!name) return;

    const defaultPrompt = `You are a helpful customer support agent for ${name}.`;

    setIsCreating(true);
    const { error } = await supabase.from('tenants').insert({
      name,
      prompt_directions: defaultPrompt,
      media_library: []
    });
    setIsCreating(false);

    if (error) {
      alert("Failed to create tenant.");
      console.error(error);
    } else {
      await refreshTenants();
    }
  };

  const handleDeleteTenant = async (id: string, name: string) => {
    const confirmDelete = confirm(`Are you sure you want to completely delete the tenant "${name}" and all its data?`);
    if (!confirmDelete) return;

    // To prevent orphans or FK constraints, typically you'd need to delete sessions first.
    // For this simple admin page, we'll just try to delete the tenant directly. 
    // If there are sessions linked to it, Supabase will likely throw an error due to the FK constraint.
    const { error } = await supabase.from('tenants').delete().eq('id', id);
    
    if (error) {
      alert("Failed to delete tenant. (Note: You cannot delete a tenant that has active sessions).");
      console.error(error);
    } else {
      await refreshTenants();
    }
  };

  return (
    <DashboardLayout>
      <main className="flex-1 overflow-y-auto p-8">
        <div className="max-w-4xl mx-auto space-y-8">
          <div className="flex justify-between items-end">
            <div>
              <h1 className="text-2xl font-bold text-slate-800 tracking-tight">Tenants</h1>
              <p className="text-slate-500 mt-1">Manage all business clients in the orchestrator.</p>
            </div>
            <button
              onClick={handleCreateTenant}
              disabled={isCreating}
              className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl font-semibold shadow-sm transition-colors flex items-center gap-2"
            >
              <span className="material-symbols-outlined text-[20px]">add_business</span>
              {isCreating ? 'Creating...' : 'Create Tenant'}
            </button>
          </div>

          <div className="silk-card rounded-2xl overflow-hidden border border-white/50">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-50/50 border-b border-slate-200/60">
                  <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-widest">Name</th>
                  <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-widest">Tenant ID (UUID)</th>
                  <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-widest text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {tenants.map(tenant => (
                  <tr key={tenant.id} className="hover:bg-slate-50/50 transition-colors">
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-lg bg-indigo-50 flex items-center justify-center text-indigo-600 font-bold text-xs">
                          {tenant.name.substring(0, 2).toUpperCase()}
                        </div>
                        <span className="font-semibold text-slate-800">{tenant.name}</span>
                      </div>
                    </td>
                    <td className="px-6 py-4 text-[13px] font-mono text-slate-500">
                      {tenant.id}
                    </td>
                    <td className="px-6 py-4 text-right">
                      <button 
                        onClick={() => handleDeleteTenant(tenant.id, tenant.name)}
                        className="p-2 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                        title="Delete Tenant"
                      >
                        <span className="material-symbols-outlined text-[20px]">delete</span>
                      </button>
                    </td>
                  </tr>
                ))}
                {tenants.length === 0 && (
                  <tr>
                    <td colSpan={3} className="px-6 py-12 text-center text-slate-500">
                      No tenants found. Create one to get started!
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </main>
    </DashboardLayout>
  );
}
