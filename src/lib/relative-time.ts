/**
 * Relative "time ago" formatting shared by the chat history and the read-only
 * memory viewer. Date-only values (YYYY-MM-DD, e.g. a MemoryEntry.createdAt)
 * are parsed as LOCAL midnight — `new Date('2026-07-30')` would otherwise be
 * UTC midnight and shift the reported age by the timezone offset.
 */
export function timeAgo(iso: string): string {
  const date = parseLocal(iso);
  if (!date) return '';
  const diff = Date.now() - date.getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return 'abhi';
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d`;
}

function parseLocal(iso: string): Date | null {
  if (typeof iso !== 'string' || !iso) return null;
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (dateOnly) {
    const [, y, m, d] = dateOnly;
    const date = new Date(Number(y), Number(m) - 1, Number(d));
    return Number.isNaN(date.getTime()) ? null : date;
  }
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? null : date;
}
