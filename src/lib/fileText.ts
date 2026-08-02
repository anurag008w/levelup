/**
 * Unified client-side text extraction for chat attachments. Converts PDFs,
 * Office documents (DOCX / PPTX / XLSX) and plain text formats into readable
 * text so the AI can actually work with uploaded files.
 *
 * Layered fallbacks: pdfjs-dist first, then a lightweight parser; Office
 * formats are unzipped (ZIP/XML) with jszip. Never throws — returns '' when a
 * file genuinely cannot be read client-side.
 */
import JSZip from 'jszip';
import { extractPdfText } from './pdf';
import { extractPdfTextFallback } from './pdfFallback';

export const TEXT_FILE_EXTENSIONS = new Set([
  'txt', 'md', 'markdown', 'csv', 'json', 'yaml', 'yml', 'xml', 'html', 'htm', 'css', 'scss', 'less',
  'js', 'jsx', 'ts', 'tsx', 'py', 'java', 'cpp', 'c', 'h', 'cs', 'go', 'rs', 'rb', 'php', 'swift', 'kt',
  'sh', 'bash', 'bat', 'ps1', 'sql', 'toml', 'ini', 'cfg', 'log', 'tex', 'env', 'properties',
]);

/** Extensions with no client-side reader (legacy OLE or archives). */
const UNREADABLE_EXTENSIONS = new Set(['doc', 'ppt', 'xls', 'zip', 'rar', '7z', 'gz', 'tar', 'exe', 'bin', 'so', 'dll']);

/**
 * True when a pdfjs extraction contains actual document text beyond the
 * "--- Page n/m ---" header boilerplate pdf.ts emits. Prevents header-only
 * results from short-circuiting the lightweight fallback.
 */
function hasRealText(text: string): boolean {
  const withoutHeaders = text.replace(/^--- Page \d+\/\d+ ---$/gm, '').replace(/^\s*$/gm, '');
  return withoutHeaders.trim().length > 0;
}

/**
 * Hard cap on extracted Office text. A giant workbook or deck can otherwise
 * produce a multi-MB prompt that blows the model context; the tail is cut
 * with an explicit marker so the AI knows content was truncated.
 */
export const MAX_OFFICE_CHARS = 60_000;
const OFFICE_TRUNCATION_MARKER = '\n\n[Document truncated after 60000 characters]';

/** Returns the extracted plain text, or '' when nothing could be read. */
export async function extractFileText(file: File): Promise<string> {
  const name = file.name ?? '';
  const ext = name.split('.').pop()?.toLowerCase() ?? '';

  if (file.type === 'application/pdf' || ext === 'pdf') {
    const primary = await extractPdfText(file).catch(() => '');
    // pdfjs "succeeds" on some PDFs while producing nothing but whitespace or
    // per-page header boilerplate (image-only scans, corrupt streams). Treat
    // that as a failure and let the lightweight parser retry — it may still
    // recover real text.
    if (hasRealText(primary)) return primary;
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      return await extractPdfTextFallback(bytes);
    } catch {
      return '';
    }
  }

  if (ext === 'docx' || ext === 'pptx' || ext === 'xlsx') {
    try {
      return await extractOfficeText(await file.arrayBuffer(), ext);
    } catch {
      return '';
    }
  }

  if (UNREADABLE_EXTENSIONS.has(ext)) return '';

  if (file.type.startsWith('text/') || TEXT_FILE_EXTENSIONS.has(ext)) {
    try {
      return await file.text();
    } catch {
      return '';
    }
  }

  return '';
}

async function extractOfficeText(data: ArrayBuffer, type: 'docx' | 'pptx' | 'xlsx'): Promise<string> {
  const zip = await JSZip.loadAsync(data);
  let text = '';
  switch (type) {
    case 'docx':
      text = await extractDocx(zip);
      break;
    case 'pptx':
      text = await extractPptx(zip);
      break;
    case 'xlsx':
      text = await extractXlsx(zip);
      break;
  }
  return truncateOffice(text);
}

/** Bounds any Office extraction that outgrew the cap (docx path). */
function truncateOffice(text: string): string {
  if (text.endsWith(OFFICE_TRUNCATION_MARKER)) return text;
  if (text.length > MAX_OFFICE_CHARS) {
    return `${text.slice(0, MAX_OFFICE_CHARS)}${OFFICE_TRUNCATION_MARKER}`;
  }
  return text;
}

async function extractDocx(zip: JSZip): Promise<string> {
  const entry = zip.file('word/document.xml');
  if (!entry) return '';
  const xml = await entry.async('string');
  return xmlToText(xml, /<\/w:p>/g, /<\/w:tc>/g);
}

async function extractPptx(zip: JSZip): Promise<string> {
  const slideNames = Object.keys(zip.files)
    .filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n))
    .sort((a, b) => slideNumber(a) - slideNumber(b));
  const parts: string[] = [];
  let total = 0;
  for (const name of slideNames) {
    const xml = await zip.files[name].async('string');
    const text = xmlToText(xml, /<\/a:p>/g, null);
    const num = slideNumber(name);
    const block = `--- Slide ${num} ---\n${text}`;
    if (total + block.length > MAX_OFFICE_CHARS) {
      parts.push(block.slice(0, Math.max(0, MAX_OFFICE_CHARS - total)) + OFFICE_TRUNCATION_MARKER);
      break;
    }
    parts.push(block);
    total += block.length;
  }
  return parts.join('\n\n');
}

async function extractXlsx(zip: JSZip): Promise<string> {
  const shared: string[] = [];
  const ssEntry = zip.file('xl/sharedStrings.xml');
  if (ssEntry) {
    const xml = await ssEntry.async('string');
    for (const si of xml.split('</si>')) {
      const t = [...si.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((m) => decodeEntities(m[1])).join('');
      if (t !== '') shared.push(t);
    }
  }

  const sheetNames = Object.keys(zip.files)
    .filter((n) => /^xl\/worksheets\/sheet\d+\.xml$/.test(n))
    .sort((a, b) => sheetNumber(a) - sheetNumber(b));
  const parts: string[] = [];
  let total = 0;
  for (const name of sheetNames) {
    const xml = await zip.files[name].async('string');
    const rows: string[] = [];
    for (const rowXml of xml.split('</row>')) {
      const cells: string[] = [];
      for (const cellXml of rowXml.split('</c>')) {
        const cTag = /<c\b[^>]*>/.exec(cellXml);
        const tAttr = cTag ? /t="([^"]*)"/.exec(cTag[0])?.[1] : undefined;
        const v = /<v>([\s\S]*?)<\/v>/.exec(cellXml);
        let value: string | null = null;
        if (v) {
          const raw = decodeEntities(v[1]);
          value = tAttr === 's' ? (shared[Number(raw)] ?? '') : raw;
        } else {
          // Inline (non-shared) strings live in an <is><t>…</t></is> block and
          // have NO <v> element — previously these cells were silently dropped.
          const is = /<is>([\s\S]*?)<\/is>/.exec(cellXml);
          if (is) {
            value = [...is[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((m) => decodeEntities(m[1])).join('');
          }
        }
        if (value !== null) cells.push(value);
      }
      if (cells.some((c) => c.trim())) rows.push(cells.join('\t'));
    }
    const block = rows.join('\n');
    if (total + block.length > MAX_OFFICE_CHARS) {
      parts.push(block.slice(0, Math.max(0, MAX_OFFICE_CHARS - total)) + OFFICE_TRUNCATION_MARKER);
      break;
    }
    parts.push(block);
    total += block.length;
  }
  return parts.join('\n\n');
}

function xmlToText(xml: string, paraBreak: RegExp, cellBreak: RegExp | null): string {
  let s = xml;
  if (cellBreak) s = s.replace(cellBreak, '\t');
  s = s.replace(paraBreak, '\n');
  s = s.replace(/<[^>]*>/g, '');
  s = decodeEntities(s);
  s = s.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  return s;
}

function slideNumber(name: string): number {
  const m = /slide(\d+)\.xml$/.exec(name);
  return m ? Number(m[1]) : 0;
}

function sheetNumber(name: string): number {
  const m = /sheet(\d+)\.xml$/.exec(name);
  return m ? Number(m[1]) : 0;
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_m, n: string) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_m, h: string) => String.fromCharCode(parseInt(h, 16)));
}
