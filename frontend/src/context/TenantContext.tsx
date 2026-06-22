'use client';

import React, { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react';
import { supabase } from '@/lib/supabase';
import { Tenant } from '@/types';

interface TenantContextType {
  tenants: Tenant[];
  activeTenantId: string | null;
  setActiveTenantId: (id: string | null) => void;
  refreshTenants: () => Promise<void>;
  activeTenant: Tenant | null;
}

const TenantContext = createContext<TenantContextType | undefined>(undefined);

export function TenantProvider({ children }: { children: ReactNode }) {
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [activeTenantId, setActiveTenantId] = useState<string | null>(null);

  const refreshTenants = useCallback(async () => {
    const { data, error } = await supabase.from('tenants').select('id, name, prompt_directions, media_library');
    if (error) {
      console.error('[TenantContext] Error fetching tenants:', error);
      return;
    }
    if (data) {
      setTenants(data);
      const savedTenantId = localStorage.getItem('activeTenantId');
      
      if (savedTenantId && data.find(t => t.id === savedTenantId)) {
        setActiveTenantId(savedTenantId);
      } else if (data.length > 0 && !activeTenantId) {
        setActiveTenantId(data[0].id);
      }
    }
  }, [activeTenantId]);

  // Initial fetch
  useEffect(() => {
    refreshTenants();
  }, [refreshTenants]);

  // Sync to localStorage
  useEffect(() => {
    if (activeTenantId) {
      localStorage.setItem('activeTenantId', activeTenantId);
    }
  }, [activeTenantId]);

  const activeTenant = tenants.find(t => t.id === activeTenantId) || null;

  return (
    <TenantContext.Provider
      value={{
        tenants,
        activeTenantId,
        setActiveTenantId,
        refreshTenants,
        activeTenant,
      }}
    >
      {children}
    </TenantContext.Provider>
  );
}

export function useTenant() {
  const context = useContext(TenantContext);
  if (context === undefined) {
    throw new Error('useTenant must be used within a TenantProvider');
  }
  return context;
}
