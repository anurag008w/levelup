import {
  File,
  FileArchive,
  FileAudio,
  FileCode,
  FileImage,
  FileSpreadsheet,
  FileText,
  FileType,
  FileVideo,
  Presentation,
} from 'lucide-react';
import type { ComponentType } from 'react';

/** A file's rendered identity: short type label + type icon + tint classes. */
export interface FileKindInfo {
  ext: string;
  Icon: ComponentType<{ size?: number | string; className?: string }>;
  tile: string;
  fg: string;
}

const TEXT_EXT = ['txt', 'md', 'markdown', 'tex', 'log', 'rtf'];
const CODE_EXT = ['js', 'ts', 'tsx', 'jsx', 'py', 'java', 'c', 'cpp', 'h', 'css', 'html', 'json', 'yaml', 'yml', 'sql', 'sh', 'go', 'rs', 'rb'];
const IMAGE_EXT = ['jpg', 'jpeg', 'png', 'webp', 'gif', 'heic', 'heif', 'avif', 'svg', 'bmp'];
const DOC_EXT = ['doc', 'docx', 'odt'];
const SHEET_EXT = ['xls', 'xlsx', 'csv', 'ods'];
const SLIDES_EXT = ['ppt', 'pptx', 'odp'];
const ARCHIVE_EXT = ['zip', 'rar', '7z', 'tar', 'gz', 'bz2'];
const AUDIO_EXT = ['mp3', 'wav', 'ogg', 'm4a', 'aac', 'flac'];
const VIDEO_EXT = ['mp4', 'mkv', 'mov', 'avi', 'webm'];

/** Maps a file name / MIME type to its icon + label + tint (PDF, DOC, IMG…). */
export function fileKindOf(name: string, mimeType?: string): FileKindInfo {
  const ext = (name.split('.').pop() ?? '').toLowerCase();
  const mime = (mimeType ?? '').toLowerCase();
  if (ext === 'pdf' || mime.includes('pdf')) return { ext: 'PDF', Icon: FileText, tile: 'bg-red-500/15', fg: 'text-red-400' };
  if (IMAGE_EXT.includes(ext) || mime.startsWith('image/')) return { ext: 'IMG', Icon: FileImage, tile: 'bg-violet-500/15', fg: 'text-violet-400' };
  if (DOC_EXT.includes(ext) || mime.includes('word')) return { ext: 'DOC', Icon: FileType, tile: 'bg-blue-500/15', fg: 'text-blue-400' };
  if (SHEET_EXT.includes(ext) || mime.includes('excel') || mime.includes('sheet') || mime.includes('csv')) return { ext: 'XLS', Icon: FileSpreadsheet, tile: 'bg-emerald-500/15', fg: 'text-emerald-400' };
  if (SLIDES_EXT.includes(ext) || mime.includes('presentation')) return { ext: 'PPT', Icon: Presentation, tile: 'bg-orange-500/15', fg: 'text-orange-400' };
  if (ARCHIVE_EXT.includes(ext) || mime.includes('zip') || mime.includes('compressed')) return { ext: 'ZIP', Icon: FileArchive, tile: 'bg-amber-500/15', fg: 'text-amber-400' };
  if (AUDIO_EXT.includes(ext) || mime.startsWith('audio/')) return { ext: 'AUD', Icon: FileAudio, tile: 'bg-pink-500/15', fg: 'text-pink-400' };
  if (VIDEO_EXT.includes(ext) || mime.startsWith('video/')) return { ext: 'VID', Icon: FileVideo, tile: 'bg-indigo-500/15', fg: 'text-indigo-400' };
  if (CODE_EXT.includes(ext) || mime.includes('javascript') || mime.includes('json')) return { ext: ext.toUpperCase(), Icon: FileCode, tile: 'bg-teal-500/15', fg: 'text-teal-400' };
  if (TEXT_EXT.includes(ext) || mime.startsWith('text/')) return { ext: ext.toUpperCase(), Icon: FileText, tile: 'bg-slate-500/15', fg: 'text-slate-400' };
  return { ext: 'FILE', Icon: File, tile: 'bg-slate-500/15', fg: 'text-slate-400' };
}

/** Shortens a long file name, keeping the extension readable (middle-truncate). */
export function shortFileName(name: string, max = 20): string {
  const dot = name.lastIndexOf('.');
  const ext = dot > 0 ? name.slice(dot + 1) : '';
  const base = dot > 0 ? name.slice(0, dot) : name;
  if (base.length <= max) return name;
  return `${base.slice(0, max - 1).trimEnd()}…${ext ? `.${ext}` : ''}`;
}
