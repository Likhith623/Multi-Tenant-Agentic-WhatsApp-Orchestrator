'use client';

import React, { useState, useEffect } from 'react';
import { useTenant } from '@/context/TenantContext';
import { supabase } from '@/lib/supabase';
import DashboardLayout from '@/components/DashboardLayout';

export default function SettingsPage() {
  const { activeTenant, refreshTenants } = useTenant();
  const [promptContent, setPromptContent] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);

  useEffect(() => {
    if (activeTenant) {
      setPromptContent(activeTenant.prompt_directions || '');
    }
  }, [activeTenant]);

  if (!activeTenant) {
    return (
      <DashboardLayout>
        <div className="flex-1 flex items-center justify-center text-slate-400">
          <p>Please select a tenant to edit settings.</p>
        </div>
      </DashboardLayout>
    );
  }

  const handleSave = async () => {
    setIsSaving(true);
    setSaveSuccess(false);

    const { error } = await supabase
      .from('tenants')
      .update({ prompt_directions: promptContent })
      .eq('id', activeTenant.id);

    setIsSaving(false);

    if (error) {
      alert("Failed to save settings.");
      console.error(error);
    } else {
      setSaveSuccess(true);
      await refreshTenants();
      setTimeout(() => setSaveSuccess(false), 3000);
    }
  };

  return (
    <DashboardLayout>
      <main className="flex-1 overflow-y-auto p-8">
        <div className="max-w-4xl mx-auto space-y-8">
          <div className="flex justify-between items-end">
            <div>
              <h1 className="text-2xl font-bold text-slate-800 tracking-tight">Tenant Settings</h1>
              <p className="text-slate-500 mt-1">Configure {activeTenant.name}&apos;s AI agent behavior</p>
            </div>
            <button
              onClick={handleSave}
              disabled={isSaving}
              className="px-6 py-2.5 bg-gradient-to-br from-indigo-500 to-violet-600 hover:from-indigo-600 hover:to-violet-700 text-white rounded-xl font-bold shadow-lg shadow-indigo-500/25 transition-all flex items-center gap-2 disabled:opacity-50"
            >
              {isSaving ? (
                <>
                  <svg className="animate-spin h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
                  Saving...
                </>
              ) : (
                <>
                  <span className="material-symbols-outlined text-[20px]">save</span>
                  Save Changes
                </>
              )}
            </button>
          </div>

          {saveSuccess && (
            <div className="p-4 rounded-xl bg-green-50 text-green-700 border border-green-200/50 flex items-center gap-2">
              <span className="material-symbols-outlined">check_circle</span>
              <span className="font-medium">Settings saved successfully!</span>
            </div>
          )}

          <div className="silk-card rounded-2xl p-6 space-y-6">
            <div>
              <label className="block text-sm font-bold text-slate-700 mb-2">Agent System Prompt</label>
              <p className="text-[13px] text-slate-500 mb-4">
                This prompt defines how the WhatsApp AI agent behaves for this specific tenant. It provides the context, rules, and knowledge base for the agent.
              </p>
              <textarea
                value={promptContent}
                onChange={(e) => setPromptContent(e.target.value)}
                rows={15}
                className="w-full silk-pressed border border-white/60 rounded-xl p-4 text-[14px] text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-400/30 resize-y leading-relaxed font-mono shadow-inner bg-slate-50/50"
                placeholder="Enter instructions for the AI agent..."
              />
            </div>
          </div>
        </div>
      </main>
    </DashboardLayout>
  );
}
