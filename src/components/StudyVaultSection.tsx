import { useState, useRef, useEffect } from 'react';
import {
  BookOpen,
  Download,
  Eye,
  File,
  FileCode,
  FileText,
  FolderOpen,
  HardDrive,
  Search,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import type { StudyResource, VaultSubject } from '../core/domain/study-vault';
import { formatFileSize, getFileCategory } from '../core/domain/study-vault';
import { deleteVaultFileBlob, getVaultFileBlob, saveVaultFileBlob } from '../infra/storage/vault-db';
import { haptic } from '../lib/haptics';

interface StudyVaultSectionProps {
  resources: StudyResource[];
  onAddResource: (resource: StudyResource) => void;
  onDeleteResource: (id: string, storageKey: string) => void;
  flash: (msg: string) => void;
}

const VAULT_SUBJECTS: { id: VaultSubject | 'all'; label: string; color: string }[] = [
  { id: 'all', label: 'All Files', color: 'text-stone-300 bg-stone-500/10 border-stone-500/20' },
  { id: 'physics', label: 'Physics', color: 'text-blue-400 bg-blue-500/10 border-blue-500/20' },
  { id: 'chemistry', label: 'Chemistry', color: 'text-purple-400 bg-purple-500/10 border-purple-500/20' },
  { id: 'maths', label: 'Maths', color: 'text-cyan-400 bg-cyan-500/10 border-cyan-500/20' },
  { id: 'formula', label: 'Formula Sheets', color: 'text-amber-400 bg-amber-500/10 border-amber-500/20' },
  { id: 'general', label: 'General / DPPs', color: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20' },
];

export default function StudyVaultSection({
  resources,
  onAddResource,
  onDeleteResource,
  flash,
}: StudyVaultSectionProps) {
  const [selectedSubject, setSelectedSubject] = useState<VaultSubject | 'all'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [uploadSubject, setUploadSubject] = useState<VaultSubject>('physics');
  const [uploadTitle, setUploadTitle] = useState('');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [previewBlobUrl, setPreviewBlobUrl] = useState<string | null>(null);
  const [previewTitle, setPreviewTitle] = useState<string>('');
  const [isUploading, setIsUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Clean up any preview blob URLs on unmount
  useEffect(() => {
    return () => {
      if (previewBlobUrl) URL.revokeObjectURL(previewBlobUrl);
    };
  }, [previewBlobUrl]);

  const filtered = resources.filter((r) => {
    const matchesSubject = selectedSubject === 'all' || r.subject === selectedSubject;
    const matchesSearch =
      !searchQuery.trim() ||
      r.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      r.fileName.toLowerCase().includes(searchQuery.toLowerCase()) ||
      r.tags?.some((t) => t.toLowerCase().includes(searchQuery.toLowerCase()));
    return matchesSubject && matchesSearch;
  });

  async function handleFilePick(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    const file = files[0];
    setSelectedFile(file);
    if (!uploadTitle.trim()) {
      // Auto-set title from file name
      setUploadTitle(file.name.replace(/\.[^/.]+$/, ''));
    }
  }

  async function handleSaveFile() {
    if (!selectedFile) {
      flash('Pehle koi PDF ya Document file select karo.');
      return;
    }
    if (!uploadTitle.trim()) {
      flash('File ka title bharein.');
      return;
    }

    setIsUploading(true);
    try {
      const storageKey = `vault_blob_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
      await saveVaultFileBlob(storageKey, selectedFile);

      const category = getFileCategory(selectedFile.type, selectedFile.name);

      const newResource: StudyResource = {
        id: `res_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        title: uploadTitle.trim(),
        fileName: selectedFile.name,
        fileType: category,
        fileSize: selectedFile.size,
        subject: uploadSubject,
        storageKey,
        tags: [],
        uploadedAtISO: new Date().toISOString(),
      };

      onAddResource(newResource);
      flash(`"${uploadTitle}" Study Vault mein save ho gaya!`);
      setShowUploadModal(false);
      setSelectedFile(null);
      setUploadTitle('');
    } catch {
      flash('File save karte waqt error aaya. Dobara try karein.');
    } finally {
      setIsUploading(false);
    }
  }

  async function handleOpenPreview(resource: StudyResource) {
    haptic();
    try {
      const blob = await getVaultFileBlob(resource.storageKey);
      if (!blob) {
        flash('File data nahi mila. Shayad storage clear ho gaya hai.');
        return;
      }
      if (previewBlobUrl) URL.revokeObjectURL(previewBlobUrl);
      const blobObj = typeof blob === 'string' ? new Blob([blob]) : blob;
      const url = URL.createObjectURL(blobObj);
      setPreviewBlobUrl(url);
      setPreviewTitle(resource.title);
    } catch {
      flash('Preview kholne mein samasya aayi.');
    }
  }

  async function handleDownload(resource: StudyResource) {
    haptic();
    try {
      const blob = await getVaultFileBlob(resource.storageKey);
      if (!blob) {
        flash('File download nahi ho saki.');
        return;
      }
      const blobObj = typeof blob === 'string' ? new Blob([blob]) : blob;
      const url = URL.createObjectURL(blobObj);
      const a = document.createElement('a');
      a.href = url;
      a.download = resource.fileName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch {
      flash('Download fail ho gaya.');
    }
  }

  async function handleDelete(resource: StudyResource) {
    if (!confirm(`"${resource.title}" ko Study Vault se delete karna hai?`)) return;
    haptic();
    try {
      await deleteVaultFileBlob(resource.storageKey);
      onDeleteResource(resource.id, resource.storageKey);
      flash(`"${resource.title}" delete ho gaya.`);
    } catch {
      flash('Delete karte waqt error aaya.');
    }
  }

  function getFileIcon(fileName: string, mime: string) {
    const cat = getFileCategory(mime, fileName);
    if (cat === 'pdf') return <FileText size={18} className="text-rose-400" />;
    if (cat === 'image') return <BookOpen size={18} className="text-emerald-400" />;
    if (cat === 'text') return <FileCode size={18} className="text-teal-400" />;
    return <File size={18} className="text-stone-400" />;
  }

  return (
    <div className="space-y-4">
      {/* Header & Upload Button */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-display text-base font-bold text-text">Study Resource Vault</h3>
          <p className="text-xs text-muted">PDFs, Formula Sheets, DPPs aur Notes store karo</p>
        </div>
        <button
          type="button"
          onClick={() => {
            haptic();
            setShowUploadModal(true);
          }}
          className="btn btn-primary gap-1.5 px-3 py-2 text-xs font-bold"
        >
          <Upload size={14} /> Upload File
        </button>
      </div>

      {/* Subject Filter Pills */}
      <div className="flex flex-wrap gap-1.5">
        {VAULT_SUBJECTS.map((s) => {
          const count = s.id === 'all' ? resources.length : resources.filter((r) => r.subject === s.id).length;
          const active = selectedSubject === s.id;
          return (
            <button
              key={s.id}
              type="button"
              onClick={() => {
                haptic(4);
                setSelectedSubject(s.id);
              }}
              className={`rounded-full border px-3 py-1 text-xs font-medium transition-all ${
                active ? 'border-l bg-l/15 text-light font-bold' : 'border-border/50 bg-panel/50 text-muted hover:border-border'
              }`}
            >
              {s.label} ({count})
            </button>
          );
        })}
      </div>

      {/* Search Input */}
      {resources.length > 0 && (
        <div className="relative">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
          <input
            type="text"
            className="field pl-9 text-xs"
            placeholder="Search PDFs, formula sheets, notes..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted hover:text-text"
            >
              <X size={13} />
            </button>
          )}
        </div>
      )}

      {/* Resources List */}
      {filtered.length === 0 ? (
        <div className="card p-6 text-center text-muted space-y-2">
          <HardDrive size={28} className="mx-auto text-muted-dim" />
          <p className="font-semibold text-xs text-text">
            {resources.length === 0 ? 'Abhi tak koi PDF ya file upload nahi hui hai.' : 'Koi matching file nahi mili.'}
          </p>
          <p className="text-[11px] text-muted max-w-xs mx-auto">
            Physics notes, Math formula sheets, ya Chemistry DPPs yaha safely offline IndexedDB me store kar sakte ho.
          </p>
        </div>
      ) : (
        <div className="space-y-2.5">
          {filtered.map((res) => {
            const subj = VAULT_SUBJECTS.find((s) => s.id === res.subject) || VAULT_SUBJECTS[5];
            return (
              <div
                key={res.id}
                className="card flex items-center justify-between gap-3 p-3.5 hover:border-border-strong transition-all"
              >
                <div className="flex min-w-0 items-center gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white/5 border border-border/50">
                    {getFileIcon(res.fileName, res.fileType)}
                  </div>
                  <div className="min-w-0">
                    <p className="font-display text-sm font-semibold text-text truncate leading-snug">{res.title}</p>
                    <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[10px] text-muted">
                      <span className={`inline-flex rounded-md border px-1.5 py-0.2 font-medium ${subj.color}`}>
                        {subj.label}
                      </span>
                      <span>·</span>
                      <span>{formatFileSize(res.fileSize)}</span>
                      <span>·</span>
                      <span className="truncate max-w-[120px]">{res.fileName}</span>
                    </div>
                  </div>
                </div>

                {/* Actions */}
                <div className="flex shrink-0 items-center gap-1">
                  <button
                    type="button"
                    onClick={() => handleOpenPreview(res)}
                    className="btn btn-ghost min-h-8 px-2.5 text-xs text-light gap-1 font-semibold"
                    title="View file"
                  >
                    <Eye size={13} /> View
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDownload(res)}
                    className="icon-btn text-muted hover:text-text"
                    title="Download file"
                  >
                    <Download size={14} />
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDelete(res)}
                    className="icon-btn text-muted hover:text-danger"
                    title="Delete file"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Upload Modal */}
      {showUploadModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm fade-in">
          <div className="card w-full max-w-md p-5 space-y-4 border-l/40 bg-panel-raised shadow-2xl">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Upload size={16} className="text-l" />
                <h3 className="font-display text-base font-bold text-text">Upload Study File</h3>
              </div>
              <button
                type="button"
                onClick={() => setShowUploadModal(false)}
                className="icon-btn"
                aria-label="Close modal"
              >
                <X size={16} />
              </button>
            </div>

            <div className="space-y-3 text-xs">
              {/* File picker */}
              <div>
                <input
                  type="file"
                  ref={fileInputRef}
                  onChange={handleFilePick}
                  accept=".pdf,.png,.jpg,.jpeg,.doc,.docx,.txt"
                  className="hidden"
                />
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="w-full flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border hover:border-l p-5 bg-white/5 transition-all text-center"
                >
                  <FolderOpen size={24} className="text-muted" />
                  {selectedFile ? (
                    <div>
                      <p className="font-semibold text-text text-sm truncate max-w-xs">{selectedFile.name}</p>
                      <p className="text-muted text-[11px] mt-0.5">{formatFileSize(selectedFile.size)}</p>
                    </div>
                  ) : (
                    <div>
                      <p className="font-semibold text-text text-xs">Tap to choose PDF or Document</p>
                      <p className="text-muted text-[10px] mt-0.5">Supports PDF, Formula JPGs, DOCX</p>
                    </div>
                  )}
                </button>
              </div>

              {/* Title input */}
              <div>
                <label className="block text-[11px] font-semibold text-muted mb-1 uppercase tracking-wider">File Title</label>
                <input
                  type="text"
                  className="field w-full text-xs"
                  placeholder="e.g. Kinematics Formula Sheet 2026"
                  value={uploadTitle}
                  onChange={(e) => setUploadTitle(e.target.value)}
                />
              </div>

              {/* Subject selector */}
              <div>
                <label className="block text-[11px] font-semibold text-muted mb-1 uppercase tracking-wider">Subject</label>
                <div className="grid grid-cols-3 gap-1.5">
                  {VAULT_SUBJECTS.filter((s) => s.id !== 'all').map((s) => {
                    const active = uploadSubject === s.id;
                    return (
                      <button
                        key={s.id}
                        type="button"
                        onClick={() => {
                          haptic(4);
                          setUploadSubject(s.id as VaultSubject);
                        }}
                        className={`rounded-lg border p-2 text-xs font-semibold text-center transition-all ${
                          active ? s.color : 'border-border/60 bg-white/5 text-muted hover:border-border'
                        }`}
                      >
                        {s.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>

            <div className="flex gap-2 pt-2">
              <button
                type="button"
                onClick={() => setShowUploadModal(false)}
                className="btn btn-ghost flex-1 text-xs"
                disabled={isUploading}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSaveFile}
                disabled={!selectedFile || isUploading}
                className="btn btn-primary flex-1 text-xs font-bold"
              >
                {isUploading ? 'Saving...' : 'Save to Vault'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* PDF / File Viewer Modal */}
      {previewBlobUrl && (
        <div className="fixed inset-0 z-50 flex flex-col bg-black/90 backdrop-blur-md fade-in">
          <div className="flex items-center justify-between border-b border-border bg-panel px-4 py-3">
            <div className="flex items-center gap-2 min-w-0">
              <FileText size={16} className="text-l shrink-0" />
              <p className="font-display text-sm font-bold text-text truncate">{previewTitle}</p>
            </div>
            <button
              type="button"
              onClick={() => {
                if (previewBlobUrl) URL.revokeObjectURL(previewBlobUrl);
                setPreviewBlobUrl(null);
              }}
              className="icon-btn text-muted hover:text-text"
              aria-label="Close viewer"
            >
              <X size={18} />
            </button>
          </div>

          <div className="flex-1 w-full h-full p-2">
            <iframe
              src={previewBlobUrl}
              title={previewTitle}
              className="w-full h-full rounded-xl border border-border bg-white"
            />
          </div>
        </div>
      )}
    </div>
  );
}
