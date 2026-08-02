import { describe, it, expect, vi, beforeEach } from 'vitest';

// Isolate the PDF retry routing in extractFileText: fake the pdfjs primary
// extractor and the lightweight fallback so we can assert which path runs.
vi.mock('../pdf', () => ({
  extractPdfText: vi.fn(),
}));
vi.mock('../pdfFallback', () => ({
  extractPdfTextFallback: vi.fn(),
}));

import { extractPdfText } from '../pdf';
import { extractPdfTextFallback } from '../pdfFallback';
import { extractFileText } from '../fileText';

const pdfFile = (name = 'doc.pdf') => new File(['x'], name, { type: 'application/pdf' });

describe('extractFileText PDF retry', () => {
  beforeEach(() => {
    vi.mocked(extractPdfText).mockReset();
    vi.mocked(extractPdfTextFallback).mockReset();
  });

  it('returns pdfjs text directly when it contains real content', async () => {
    vi.mocked(extractPdfText).mockResolvedValue('real pdfjs text');
    expect(await extractFileText(pdfFile())).toBe('real pdfjs text');
    expect(extractPdfTextFallback).not.toHaveBeenCalled();
  });

  it('retries the fallback when pdfjs returns whitespace only', async () => {
    vi.mocked(extractPdfText).mockResolvedValue('   \n  ');
    vi.mocked(extractPdfTextFallback).mockResolvedValue('recovered by fallback');
    expect(await extractFileText(pdfFile())).toBe('recovered by fallback');
    expect(extractPdfTextFallback).toHaveBeenCalledTimes(1);
  });

  it('retries the fallback when pdfjs returns page-header boilerplate only', async () => {
    vi.mocked(extractPdfText).mockResolvedValue('--- Page 1/1 ---');
    vi.mocked(extractPdfTextFallback).mockResolvedValue('recovered too');
    expect(await extractFileText(pdfFile())).toBe('recovered too');
    expect(extractPdfTextFallback).toHaveBeenCalledTimes(1);
  });

  it('retries the fallback when pdfjs throws', async () => {
    vi.mocked(extractPdfText).mockRejectedValue(new Error('pdfjs exploded'));
    vi.mocked(extractPdfTextFallback).mockResolvedValue('recovered after crash');
    expect(await extractFileText(pdfFile())).toBe('recovered after crash');
    expect(extractPdfTextFallback).toHaveBeenCalledTimes(1);
  });

  it('returns empty string when both layers fail', async () => {
    vi.mocked(extractPdfText).mockResolvedValue('');
    vi.mocked(extractPdfTextFallback).mockRejectedValue(new Error('fallback also failed'));
    expect(await extractFileText(pdfFile())).toBe('');
  });
});
