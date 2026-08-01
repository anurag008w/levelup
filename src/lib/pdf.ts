/**
 * Client-side PDF text extraction powered by pdfjs-dist (lazy-loaded).
 * Lets the AI read the actual contents of uploaded PDFs instead of falling
 * back to a "system limitation" message.
 */

const MAX_PDF_CHARS = 60_000;
const MAX_PDF_PAGES = 60;

type PdfModule = typeof import('pdfjs-dist');
let pdfModule: PdfModule | null = null;

async function loadPdfJs(): Promise<PdfModule> {
  if (!pdfModule) {
    const mod = await import('pdfjs-dist');
    mod.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString();
    pdfModule = mod;
  }
  return pdfModule;
}

/** Extracts plain text from a PDF File. Returns '' when nothing readable. */
export async function extractPdfText(file: File): Promise<string> {
  const pdfjs = await loadPdfJs();
  const buffer = await file.arrayBuffer();
  const loadingTask = pdfjs.getDocument({ data: new Uint8Array(buffer) });
  const doc = await loadingTask.promise;
  try {
    const pageCount = doc.numPages;
    const parts: string[] = [];
    const pageLimit = Math.min(pageCount, MAX_PDF_PAGES);
    for (let pageNum = 1; pageNum <= pageLimit; pageNum++) {
      const page = await doc.getPage(pageNum);
      const content = await page.getTextContent();
      const text = content.items
        .map((item) => {
          const any = item as { str?: string };
          return typeof any.str === 'string' ? any.str : '';
        })
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim();
      parts.push(`--- Page ${pageNum}/${pageCount} ---\n${text}`);
      page.cleanup();
      const total = parts.join('\n\n').length;
      if (total >= MAX_PDF_CHARS) break;
    }
    const full = parts.join('\n\n').trim();
    if (!full) return '';
    const truncated = full.length > MAX_PDF_CHARS;
    return truncated ? `${full.slice(0, MAX_PDF_CHARS)}\n\n[PDF truncated after ${MAX_PDF_CHARS} characters]` : full;
  } finally {
    await loadingTask.destroy();
  }
}
