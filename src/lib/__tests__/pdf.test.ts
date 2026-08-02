import { describe, it, expect, vi } from 'vitest';

// pdfjs-dist is lazy-loaded via dynamic import inside pdf.ts. Mock it so we can
// control exactly what a page reports, without shipping a real PDF through the
// worker pipeline.
vi.mock('pdfjs-dist', () => {
  const makePage = (text: string) => ({
    getTextContent: async () => ({ items: text ? [{ str: text }] : [{ str: '' }] }),
    cleanup: () => {},
  });
  return {
    GlobalWorkerOptions: {},
    getDocument: () => ({
      promise: Promise.resolve({
        numPages: 1,
        getPage: async () => makePage(''),
      }),
      destroy: async () => {},
    }),
  };
});

import { extractPdfText } from '../pdf';

describe('extractPdfText (pdfjs primary)', () => {
  it('returns an empty string when every page has no text (image-only scan)', async () => {
    const file = new File(['fake-pdf-bytes'], 'scan.pdf', { type: 'application/pdf' });
    // Mocked pdfjs-dist returns one page whose items hold only an empty string.
    const text = await extractPdfText(file);
    expect(text).toBe('');
  });
});
