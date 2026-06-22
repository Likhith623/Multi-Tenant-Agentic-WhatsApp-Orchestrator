'use client';

import React, { useState, useRef } from 'react';
import { useTenant } from '@/context/TenantContext';
import { supabase } from '@/lib/supabase';
import DashboardLayout from '@/components/DashboardLayout';

const BUCKET = 'krid_tenents';
const ACCEPTED_TYPES = 'image/jpeg,image/png,image/gif,image/webp,application/pdf';

interface MediaItem {
  id: string;
  name: string;       // human-readable label chosen by the user
  url: string;        // permanent Supabase Storage public URL
  type: 'image' | 'document';
  storagePath?: string;
  size?: number;
}

function formatBytes(bytes: number): string {
  if (!bytes) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// ── Upload Modal ──────────────────────────────────────────────────────────────
interface UploadModalProps {
  file: File;
  onConfirm: (name: string) => void;
  onCancel: () => void;
  isUploading: boolean;
}

function UploadModal({ file, onConfirm, onCancel, isUploading }: UploadModalProps) {
  const [name, setName] = useState(
    // Pre-fill with filename (without extension) as a starting point
    file.name.replace(/\.[^/.]+$/, '').replace(/[_-]/g, ' ')
  );
  const isImage = file.type.startsWith('image/');
  const preview = isImage ? URL.createObjectURL(file) : null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm" onClick={!isUploading ? onCancel : undefined} />

      {/* Card */}
      <div className="relative w-full max-w-md mx-4 silk-card rounded-2xl shadow-2xl p-6 space-y-5 animate-in fade-in zoom-in-95 duration-200">
        <div>
          <h2 className="text-[18px] font-bold text-slate-800">Add Media Asset</h2>
          <p className="text-[13px] text-slate-500 mt-0.5">
            Give this file a clear, descriptive name — the AI agent uses it to find and send media.
          </p>
        </div>

        {/* File preview */}
        <div className="silk-pressed rounded-xl overflow-hidden h-40 flex items-center justify-center border border-white/60">
          {preview ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={preview} alt="preview" className="w-full h-full object-cover" />
          ) : (
            <div className="flex flex-col items-center gap-2 text-slate-400">
              <span className="material-symbols-outlined text-[48px]">picture_as_pdf</span>
              <span className="text-[12px] font-mono">{file.name}</span>
            </div>
          )}
        </div>

        {/* File metadata */}
        <div className="flex items-center gap-3 text-[12px] text-slate-500 font-mono">
          <span className="bg-slate-100 px-2 py-0.5 rounded-md">{file.type.split('/')[1].toUpperCase()}</span>
          <span>{formatBytes(file.size)}</span>
        </div>

        {/* Name input */}
        <div>
          <label className="block text-[12px] font-bold text-slate-600 uppercase tracking-widest mb-2">
            Media Name <span className="text-red-400">*</span>
          </label>
          <input
            type="text"
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="e.g. Product Catalog 2024, Welcome Banner"
            className="w-full silk-pressed border border-white/60 rounded-xl px-4 py-3 text-[14px] text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-400/30 placeholder:text-slate-300"
            autoFocus
            onKeyDown={e => {
              if (e.key === 'Enter' && name.trim() && !isUploading) onConfirm(name.trim());
            }}
          />
          <p className="text-[11px] text-slate-400 mt-1.5 font-mono">
            The agent will reference this name to find and send this file.
          </p>
        </div>

        {/* Actions */}
        <div className="flex gap-3 pt-1">
          <button
            onClick={onCancel}
            disabled={isUploading}
            className="flex-1 py-2.5 rounded-xl silk-extruded text-slate-600 font-semibold text-[14px] hover:text-slate-800 transition-colors disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={() => onConfirm(name.trim())}
            disabled={!name.trim() || isUploading}
            className="flex-1 py-2.5 rounded-xl bg-gradient-to-br from-indigo-500 to-violet-600 text-white font-bold text-[14px] shadow-lg shadow-indigo-500/20 hover:from-indigo-600 hover:to-violet-700 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            {isUploading ? (
              <>
                <svg className="animate-spin h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                Uploading…
              </>
            ) : (
              <>
                <span className="material-symbols-outlined text-[18px]">cloud_upload</span>
                Upload
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────
export default function MediaLibraryPage() {
  const { activeTenant, refreshTenants } = useTenant();
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [mediaSearch, setMediaSearch] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  if (!activeTenant) {
    return (
      <DashboardLayout>
        <div className="flex-1 flex items-center justify-center text-slate-400">
          <p>Please select a tenant to view their media library.</p>
        </div>
      </DashboardLayout>
    );
  }

  // Parse media_library JSONB
  let mediaList: MediaItem[] = [];
  if (Array.isArray(activeTenant.media_library)) {
    mediaList = activeTenant.media_library;
  } else if (typeof activeTenant.media_library === 'object' && activeTenant.media_library !== null) {
    mediaList = Object.entries(activeTenant.media_library).map(([key, value]) => {
      if (typeof value === 'object' && value !== null) return value as MediaItem;
      return {
        id: key,
        name: key,
        url: value as string,
        type: typeof value === 'string' && value.toLowerCase().endsWith('.pdf') ? 'document' : 'image'
      };
    });
  }

  /**
   * Convert any image File to a JPEG Blob via canvas.
   * WhatsApp only accepts JPG/PNG/WebP — this ensures we always store a clean JPEG
   * regardless of what the user uploaded (GIF, HEIC re-saved as JPG, BMP, etc.)
   */
  const convertToJpeg = (file: File): Promise<Blob> =>
    new Promise((resolve, reject) => {
      const img = new Image();
      const objectUrl = URL.createObjectURL(file);
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        const ctx = canvas.getContext('2d');
        if (!ctx) { reject(new Error('Canvas not supported')); return; }
        // Fill white background first (handles transparent PNGs)
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0);
        canvas.toBlob(blob => {
          URL.revokeObjectURL(objectUrl);
          if (blob) resolve(blob);
          else reject(new Error('Canvas toBlob failed'));
        }, 'image/jpeg', 0.92);
      };
      img.onerror = () => { URL.revokeObjectURL(objectUrl); reject(new Error('Image load failed')); };
      img.src = objectUrl;
    });

  // Step 1: File picker opens → store file and show modal
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = ''; // reset so same file can be re-selected
    setPendingFile(file);
  };

  // Step 2: User confirms name in modal → upload to Supabase Storage
  const handleConfirmUpload = async (name: string) => {
    if (!pendingFile) return;

    const isImage = pendingFile.type.startsWith('image/');
    const mediaType: 'image' | 'document' = isImage ? 'image' : 'document';

    const timestamp = Date.now();
    let fileToUpload: File | Blob = pendingFile;
    let storagePath: string;

    if (isImage) {
      // Always convert images to JPEG so WhatsApp can always display them
      try {
        const jpegBlob = await convertToJpeg(pendingFile);
        fileToUpload = jpegBlob;
        const baseName = pendingFile.name.replace(/\.[^/.]+$/, '').replace(/[^a-zA-Z0-9._-]/g, '_');
        storagePath = `${activeTenant.id}/${timestamp}_${baseName}.jpg`;
      } catch (e) {
        console.warn('[media] JPEG conversion failed, uploading original:', e);
        const safeName = pendingFile.name.replace(/[^a-zA-Z0-9._-]/g, '_');
        storagePath = `${activeTenant.id}/${timestamp}_${safeName}`;
      }
    } else {
      const safeName = pendingFile.name.replace(/[^a-zA-Z0-9._-]/g, '_');
      storagePath = `${activeTenant.id}/${timestamp}_${safeName}`;
    }

    setIsUploading(true);

    try {
      // 1. Upload physical file to Supabase Storage
      const { error: uploadError } = await supabase.storage
        .from(BUCKET)
        .upload(storagePath, fileToUpload, { cacheControl: '3600', upsert: false, contentType: isImage ? 'image/jpeg' : pendingFile.type });

      if (uploadError) {
        console.error('[media] Upload error:', uploadError);
        alert(`Upload failed: ${uploadError.message}`);
        return;
      }

      // 2. Get permanent public URL
      const { data: urlData } = supabase.storage
        .from(BUCKET)
        .getPublicUrl(storagePath);

      // 3. Save both name + url to the DB
      const newItem: MediaItem = {
        id: `${timestamp}_${Math.random().toString(36).substring(2, 7)}`,
        name,                      // ← custom human-readable name
        url: urlData.publicUrl,    // ← permanent Supabase Storage URL
        type: mediaType,
        storagePath,
        size: pendingFile.size,
      };

      const newLibrary = [...mediaList, newItem];

      const { error: dbError } = await supabase
        .from('tenants')
        .update({ media_library: newLibrary })
        .eq('id', activeTenant.id);

      if (dbError) {
        console.error('[media] DB update error:', dbError);
        alert('File uploaded to storage but metadata save failed. Refresh the page.');
        return;
      }

      await refreshTenants();
      setPendingFile(null);
    } finally {
      setIsUploading(false);
    }
  };

  // Delete: remove from Storage + DB
  const handleDelete = async (item: MediaItem) => {
    if (!confirm(`Delete "${item.name}"? This cannot be undone.`)) return;

    setDeletingId(item.id);
    try {
      if (item.storagePath) {
        await supabase.storage.from(BUCKET).remove([item.storagePath]);
      }

      const newLibrary = mediaList.filter(m => m.id !== item.id);
      await supabase.from('tenants').update({ media_library: newLibrary }).eq('id', activeTenant.id);
      await refreshTenants();
    } finally {
      setDeletingId(null);
    }
  };

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <DashboardLayout>
      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        accept={ACCEPTED_TYPES}
        className="hidden"
        onChange={handleFileChange}
      />

      {/* Upload modal */}
      {pendingFile && (
        <UploadModal
          file={pendingFile}
          onConfirm={handleConfirmUpload}
          onCancel={() => { if (!isUploading) setPendingFile(null); }}
          isUploading={isUploading}
        />
      )}

      <main className="flex-1 overflow-y-auto p-8">
        <div className="max-w-6xl mx-auto space-y-6">

          {/* Header */}
          <div className="flex justify-between items-end gap-4">
            <div>
              <h1 className="text-2xl font-bold text-slate-800 tracking-tight">Media Library</h1>
              <p className="text-slate-500 mt-1">
                Assets for <span className="font-semibold text-slate-700">{activeTenant.name}</span>
                {mediaList.length > 0 && (
                  <span className="ml-2 text-[12px] font-mono bg-indigo-50 text-indigo-600 px-2 py-0.5 rounded-full border border-indigo-100">
                    {mediaList.length} {mediaList.length === 1 ? 'file' : 'files'}
                  </span>
                )}
              </p>
            </div>
            <div className="flex items-center gap-3 flex-shrink-0">
              {/* Search */}
              <div className="relative w-56">
                <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm">search</span>
                <input
                  type="text"
                  value={mediaSearch}
                  onChange={e => setMediaSearch(e.target.value)}
                  placeholder="Search media…"
                  className="w-full pl-9 pr-4 py-2 silk-pressed rounded-xl text-[13px] placeholder:text-slate-300 focus:outline-none border border-white/40"
                />
                {mediaSearch && (
                  <button onClick={() => setMediaSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
                    <span className="material-symbols-outlined text-[16px]">close</span>
                  </button>
                )}
              </div>
              <button
                onClick={() => fileInputRef.current?.click()}
                className="px-5 py-2.5 bg-gradient-to-br from-indigo-500 to-violet-600 hover:from-indigo-600 hover:to-violet-700 text-white rounded-xl font-bold shadow-lg shadow-indigo-500/20 transition-all flex items-center gap-2"
              >
                <span className="material-symbols-outlined text-[20px]">cloud_upload</span>
                Upload Media
              </button>
            </div>
          </div>

          <p className="text-[12px] font-mono text-slate-400">
            Supported: JPEG · PNG · GIF · WEBP · PDF &nbsp;·&nbsp; Stored in{' '}
            <code className="bg-slate-100 px-1.5 py-0.5 rounded">krid_tenents/{activeTenant.id}/</code>
          </p>

          {/* Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
            {mediaList.length === 0 && (
              <div
                onClick={() => fileInputRef.current?.click()}
                className="col-span-full py-20 flex flex-col items-center justify-center border-2 border-dashed border-indigo-200 rounded-2xl bg-indigo-50/30 cursor-pointer hover:border-indigo-400 hover:bg-indigo-50/60 transition-all group"
              >
                <span className="material-symbols-outlined text-5xl text-indigo-300 group-hover:text-indigo-400 transition-colors mb-3">cloud_upload</span>
                <p className="text-slate-600 font-semibold">Click to upload your first file</p>
                <p className="text-sm text-slate-400 mt-1">Give each file a name the agent can reference</p>
              </div>
            )}

            {mediaList.filter(m => m?.name?.toLowerCase().includes(mediaSearch.toLowerCase().trim())).length === 0 && mediaList.length > 0 && (
              <div className="col-span-full py-12 text-center text-slate-400">
                <span className="material-symbols-outlined text-[40px] block mb-2">search_off</span>
                <p>No media matching &ldquo;{mediaSearch}&rdquo;</p>
              </div>
            )}

            {mediaList.filter(m => m?.name?.toLowerCase().includes(mediaSearch.toLowerCase().trim())).map(media => {
              const isDeleting = deletingId === media.id;
              return (
                <div
                  key={media.id}
                  className={`silk-card rounded-2xl overflow-hidden group relative flex flex-col transition-all duration-200 ${isDeleting ? 'opacity-40 scale-95 pointer-events-none' : ''}`}
                >
                  {/* Thumbnail */}
                  <div className="h-44 bg-slate-100 flex items-center justify-center relative overflow-hidden">
                    {media.type === 'image' ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={media.url} alt={media.name} className="w-full h-full object-cover" />
                    ) : (
                      <div className="flex flex-col items-center gap-2 text-slate-400">
                        <span className="material-symbols-outlined text-[56px]">picture_as_pdf</span>
                        <span className="text-[11px] font-mono uppercase tracking-widest">PDF</span>
                      </div>
                    )}

                    {/* Hover overlay */}
                    <div className="absolute inset-0 bg-slate-900/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-3">
                      <a
                        href={media.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="w-10 h-10 bg-white text-slate-700 rounded-full flex items-center justify-center hover:bg-slate-100 transition-colors shadow-lg"
                        title={media.type === 'image' ? 'Open' : 'Download'}
                      >
                        <span className="material-symbols-outlined text-[18px]">
                          {media.type === 'image' ? 'open_in_new' : 'download'}
                        </span>
                      </a>
                      <button
                        onClick={() => handleDelete(media)}
                        className="w-10 h-10 bg-white text-red-500 rounded-full flex items-center justify-center hover:bg-red-50 transition-colors shadow-lg"
                        title="Delete"
                      >
                        <span className="material-symbols-outlined text-[18px]">delete</span>
                      </button>
                    </div>
                  </div>

                  {/* Info */}
                  <div className="p-4 border-t border-white/50 bg-white/40">
                    {/* Name (the agent uses this) */}
                    <h3 className="font-bold text-slate-800 truncate text-[14px]" title={media.name}>
                      {media.name}
                    </h3>
                    {/* URL preview */}
                    {media.url && (
                      <p className="text-[11px] font-mono text-slate-400 truncate mt-0.5" title={media.url}>
                        {media.url.split('/').pop()}
                      </p>
                    )}
                    <div className="flex items-center justify-between mt-2">
                      <span className={`text-[10px] font-bold uppercase tracking-widest px-2 py-0.5 rounded-md ${media.type === 'image' ? 'bg-indigo-50 text-indigo-600' : 'bg-orange-50 text-orange-600'}`}>
                        {media.type}
                      </span>
                      {media.size && (
                        <span className="text-[11px] font-mono text-slate-400">{formatBytes(media.size)}</span>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Agent reference table */}
          {mediaList.length > 0 && (
            <div className="silk-card rounded-2xl p-6 space-y-4 mt-8">
              <div>
                <h2 className="text-[15px] font-bold text-slate-800">Agent Reference Table</h2>
                <p className="text-[13px] text-slate-500 mt-0.5">
                  The AI agent retrieves media using the <strong>Name</strong> you assigned. The URL is stored alongside it in the database.
                </p>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-[13px] border-collapse">
                  <thead>
                    <tr className="border-b border-slate-100">
                      <th className="pb-2 font-bold text-slate-500 text-[11px] uppercase tracking-widest pr-6">Name</th>
                      <th className="pb-2 font-bold text-slate-500 text-[11px] uppercase tracking-widest pr-6">Type</th>
                      <th className="pb-2 font-bold text-slate-500 text-[11px] uppercase tracking-widest">URL</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-50">
                    {mediaList.map(m => (
                      <tr key={m.id}>
                        <td className="py-2.5 pr-6 font-semibold text-slate-800">{m.name}</td>
                        <td className="py-2.5 pr-6">
                          <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-md ${m.type === 'image' ? 'bg-indigo-50 text-indigo-600' : 'bg-orange-50 text-orange-600'}`}>
                            {m.type}
                          </span>
                        </td>
                        <td className="py-2.5 font-mono text-[12px] text-slate-500 max-w-[300px] truncate">
                          <a href={m.url} target="_blank" rel="noopener noreferrer" className="hover:text-indigo-600 transition-colors">
                            {m.url}
                          </a>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

        </div>
      </main>
    </DashboardLayout>
  );
}
