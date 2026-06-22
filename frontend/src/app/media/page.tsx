'use client';

import React, { useState } from 'react';
import { useTenant } from '@/context/TenantContext';
import { supabase } from '@/lib/supabase';
import DashboardLayout from '@/components/DashboardLayout';

interface MediaItem {
  id: string;
  name: string;
  url: string;
  type: 'image' | 'document';
}

export default function MediaLibraryPage() {
  const { activeTenant, refreshTenants } = useTenant();
  const [isUploading, setIsUploading] = useState(false);

  if (!activeTenant) {
    return (
      <DashboardLayout>
        <div className="flex-1 flex items-center justify-center text-slate-400">
          <p>Please select a tenant to view their media library.</p>
        </div>
      </DashboardLayout>
    );
  }

  // Handle parsing JSONB whether it's an array or an object
  let mediaList: MediaItem[] = [];
  if (Array.isArray(activeTenant.media_library)) {
    mediaList = activeTenant.media_library;
  } else if (typeof activeTenant.media_library === 'object' && activeTenant.media_library !== null) {
    // If it's an object, convert to array
    mediaList = Object.values(activeTenant.media_library);
  }

  const handleSimulateUpload = async () => {
    const url = prompt("Enter the URL of the image or document:");
    if (!url) return;
    
    const name = prompt("Enter a name for this media:") || "Untitled";
    const type = url.match(/\.(jpeg|jpg|gif|png)$/) != null ? 'image' : 'document';
    
    const newItem: MediaItem = {
      id: Math.random().toString(36).substring(7),
      name,
      url,
      type
    };

    const newLibrary = [...mediaList, newItem];
    
    setIsUploading(true);
    const { error } = await supabase
      .from('tenants')
      .update({ media_library: newLibrary })
      .eq('id', activeTenant.id);
      
    setIsUploading(false);
    
    if (error) {
      alert("Failed to save media");
      console.error(error);
    } else {
      await refreshTenants();
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Are you sure you want to delete this media?")) return;
    
    const newLibrary = mediaList.filter(m => m.id !== id);
    
    const { error } = await supabase
      .from('tenants')
      .update({ media_library: newLibrary })
      .eq('id', activeTenant.id);
      
    if (error) {
      alert("Failed to delete media");
    } else {
      await refreshTenants();
    }
  };

  return (
    <DashboardLayout>
      <main className="flex-1 overflow-y-auto p-8">
        <div className="max-w-6xl mx-auto space-y-8">
          <div className="flex justify-between items-end">
            <div>
              <h1 className="text-2xl font-bold text-slate-800 tracking-tight">Media Library</h1>
              <p className="text-slate-500 mt-1">Manage assets for {activeTenant.name}</p>
            </div>
            <button
              onClick={handleSimulateUpload}
              disabled={isUploading}
              className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl font-semibold shadow-sm transition-colors flex items-center gap-2"
            >
              <span className="material-symbols-outlined text-[20px]">cloud_upload</span>
              {isUploading ? 'Saving...' : 'Add Media'}
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
            {mediaList.length === 0 && (
              <div className="col-span-full py-16 flex flex-col items-center justify-center border-2 border-dashed border-slate-200 rounded-2xl bg-slate-50/50">
                <span className="material-symbols-outlined text-4xl text-slate-300 mb-3">perm_media</span>
                <p className="text-slate-500 font-medium">No media found in this library.</p>
                <p className="text-sm text-slate-400 mt-1">Upload images or documents to use them in WhatsApp broadcasts.</p>
              </div>
            )}
            
            {mediaList.map((media) => (
              <div key={media.id} className="silk-card rounded-2xl overflow-hidden group relative flex flex-col">
                <div className="h-40 bg-slate-100 flex items-center justify-center relative overflow-hidden">
                  {media.type === 'image' ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={media.url} alt={media.name} className="w-full h-full object-cover" />
                  ) : (
                    <span className="material-symbols-outlined text-[48px] text-slate-300">description</span>
                  )}
                  
                  {/* Delete overlay */}
                  <div className="absolute inset-0 bg-slate-900/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                    <button 
                      onClick={() => handleDelete(media.id)}
                      className="w-10 h-10 bg-white text-red-500 rounded-full flex items-center justify-center hover:bg-red-50 transition-colors shadow-lg"
                    >
                      <span className="material-symbols-outlined">delete</span>
                    </button>
                  </div>
                </div>
                <div className="p-4 border-t border-white/50 bg-white/40">
                  <h3 className="font-semibold text-slate-800 truncate">{media.name}</h3>
                  <div className="flex items-center gap-1 text-[11px] text-slate-500 font-mono mt-1 uppercase">
                    <span className="material-symbols-outlined text-[14px]">
                      {media.type === 'image' ? 'image' : 'picture_as_pdf'}
                    </span>
                    {media.type}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </main>
    </DashboardLayout>
  );
}
