import { Download, Eye, EyeOff, FileText } from 'lucide-react';

interface FileCardProps {
  name: string;
  sizeLabel: string;
  preview: boolean;
  onTogglePreview: () => void;
  onDownload: () => void;
}

/** Compact file header shown above rendered document messages (formula sheets,
 *  notes, solutions) so users get a Preview + Download affordance instead of
 *  raw markdown dumps. */
export default function FileCard({ name, sizeLabel, preview, onTogglePreview, onDownload }: FileCardProps) {
  return (
    <div className="file-card">
      <span className="file-card-icon">
        <FileText size={16} />
      </span>
      <div className="file-card-meta">
        <span className="file-card-name">{name}</span>
        <span className="file-card-size">{sizeLabel} · markdown</span>
      </div>
      <div className="file-card-actions">
        <button type="button" className="file-card-btn" onClick={onTogglePreview} aria-pressed={preview}>
          {preview ? <EyeOff size={14} /> : <Eye size={14} />}
          <span>{preview ? 'Hide' : 'Preview'}</span>
        </button>
        <button type="button" className="file-card-btn" onClick={onDownload}>
          <Download size={14} />
          <span>Download</span>
        </button>
      </div>
    </div>
  );
}
