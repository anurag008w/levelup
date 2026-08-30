export type VaultSubject = 'physics' | 'chemistry' | 'maths' | 'general' | 'formula';

export interface StudyResource {
  id: string;
  title: string;
  fileName: string;
  fileType: 'pdf' | 'text' | 'image' | 'doc';
  subject: VaultSubject;
  fileSize: number;
  storageKey: string;
  tags: string[];
  notes?: string;
  uploadedAtISO: string;
}

export function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

export function getFileCategory(mimeType: string, fileName: string): StudyResource['fileType'] {
  const lower = fileName.toLowerCase();
  if (mimeType.includes('pdf') || lower.endsWith('.pdf')) return 'pdf';
  if (mimeType.startsWith('image/') || /\.(png|jpe?g|webp|gif)$/.test(lower)) return 'image';
  if (mimeType.includes('text') || /\.(txt|md|csv|json)$/.test(lower)) return 'text';
  return 'doc';
}
