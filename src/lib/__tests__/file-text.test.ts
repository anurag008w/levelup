import { describe, it, expect } from 'vitest';
import JSZip from 'jszip';
import { extractFileText } from '../fileText';
import { extractPdfTextFallback } from '../pdfFallback';

function buildPdf(contentStream: string, flate = false): Uint8Array {
  const stream = flate ? compress(contentStream) : contentStream;
  const length = stream.length;
  const filter = flate ? ' /Filter /FlateDecode' : '';
  const pdf = [
    '%PDF-1.4',
    '1 0 obj',
    '<< /Type /Catalog /Pages 2 0 R >>',
    'endobj',
    '2 0 obj',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    'endobj',
    '3 0 obj',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    'endobj',
    `4 0 obj`,
    `<< /Length ${length}${filter} >>`,
    'stream',
    ...(flate ? [] : [contentStream]),
    'endstream',
    'endobj',
    '5 0 obj',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    'endobj',
    'trailer',
    '<< /Root 1 0 R >>',
    '%%EOF',
  ].join('\n');

  if (flate) {
    // Insert the raw compressed bytes between "stream\n" and "endstream".
    const marker = 'stream\n';
    const idx = pdf.indexOf(marker) + marker.length;
    const endIdx = pdf.indexOf('endstream', idx);
    const head = pdf.slice(0, idx);
    const tail = pdf.slice(endIdx - 1); // keep the '\n' before 'endstream'
    const bytes = new Uint8Array(head.length + stream.length + tail.length);
    for (let i = 0; i < head.length; i++) bytes[i] = head.charCodeAt(i);
    bytes.set(stream as Uint8Array, head.length);
    for (let i = 0; i < tail.length; i++) bytes[head.length + stream.length + i] = tail.charCodeAt(i);
    return bytes;
  }
  return new TextEncoder().encode(pdf);
}

function compress(data: string): Uint8Array {
  const bytes = new TextEncoder().encode(data);
  // Synchronous compression is not available; use the async stream API via a helper.
  return compressSync(bytes);
}

function compressSync(bytes: Uint8Array): Uint8Array {
  // CompressionStream is async-only; emulate with a tiny stored (uncompressed)
  // deflate block so no real compressor is needed. zlib wrapper: CMF+FLG then
  // stored block 0x01 0x00 0x00 0xFFFF 0x0000 (BTYPE=00, stored).
  const cmf = 0x78;
  const flg = 0x9c;
  const out = new Uint8Array(2 + 5 + bytes.length + 4);
  out[0] = cmf;
  out[1] = flg;
  out[2] = 0x01; // BFINAL=1, BTYPE=00 (stored)
  out[3] = bytes.length & 0xff;
  out[4] = (bytes.length >> 8) & 0xff;
  out[5] = (~bytes.length) & 0xff;
  out[6] = ((~bytes.length) >> 8) & 0xff;
  out.set(bytes, 7);
  const crc = adler32(bytes);
  out[out.length - 4] = (crc >> 24) & 0xff;
  out[out.length - 3] = (crc >> 16) & 0xff;
  out[out.length - 2] = (crc >> 8) & 0xff;
  out[out.length - 1] = crc & 0xff;
  return out;
}

function adler32(data: Uint8Array): number {
  let a = 1;
  let b = 0;
  for (let i = 0; i < data.length; i++) {
    a = (a + data[i]) % 65521;
    b = (b + a) % 65521;
  }
  return (b << 16) | a;
}

async function zipToFile(entries: Record<string, string>, name: string): Promise<File> {
  const zip = new JSZip();
  for (const [path, content] of Object.entries(entries)) zip.file(path, content);
  const blob = await zip.generateAsync({ type: 'blob' });
  return new File([blob], name);
}

describe('extractPdfTextFallback', () => {
  it('extracts text from an uncompressed content stream', async () => {
    const pdf = buildPdf('BT /F1 24 Tf 72 700 Td (Hello from plain PDF) Tj ET');
    const text = await extractPdfTextFallback(pdf);
    expect(text).toContain('Hello from plain PDF');
  });

  it('extracts text from a FlateDecode-compressed content stream', async () => {
    const pdf = buildPdf('BT /F1 24 Tf 72 700 Td (Hello from flate PDF) Tj ET', true);
    const text = await extractPdfTextFallback(pdf);
    expect(text).toContain('Hello from flate PDF');
  });

  it('handles TJ arrays and balanced parentheses', async () => {
    const pdf = buildPdf('BT /F1 12 Tf 72 700 Td [(IIT) 12 ((JEE))] TJ ET');
    const text = await extractPdfTextFallback(pdf);
    expect(text).toContain('IIT');
    expect(text).toContain('(JEE)');
  });

  it('returns empty string for garbage bytes', async () => {
    expect(await extractPdfTextFallback(new TextEncoder().encode('not a pdf at all'))).toBe('');
  });
});

describe('extractFileText', () => {
  it('extracts text from .txt files', async () => {
    const file = new File(['hello from txt'], 'notes.txt', { type: 'text/plain' });
    expect(await extractFileText(file)).toBe('hello from txt');
  });

  it('extracts text from .md and .html files', async () => {
    expect(await extractFileText(new File(['# Heading'], 'a.md'))).toBe('# Heading');
    expect(await extractFileText(new File(['<p>Hi</p>'], 'a.html'))).toBe('<p>Hi</p>');
  });

  it('extracts paragraph text from .docx files', async () => {
    const file = await zipToFile(
      {
        'word/document.xml':
          '<?xml version="1.0"?><w:document xmlns:w="w"><w:body>' +
          '<w:p><w:r><w:t>Hello DOCX world</w:t></w:r></w:p>' +
          '<w:p><w:r><w:t>Second &amp; paragraph</w:t></w:r></w:p>' +
          '</w:body></w:document>',
      },
      'notes.docx',
    );
    const text = await extractFileText(file);
    expect(text).toContain('Hello DOCX world');
    expect(text).toContain('Second & paragraph');
  });

  it('extracts slide text from .pptx files in order', async () => {
    const file = await zipToFile(
      {
        'ppt/slides/slide1.xml': '<a:p><a:r><a:t>First slide</a:t></a:r></a:p>',
        'ppt/slides/slide2.xml': '<a:p><a:r><a:t>Second slide</a:t></a:r></a:p>',
        '[Content_Types].xml': '<Types/>',
      },
      'deck.pptx',
    );
    const text = await extractFileText(file);
    expect(text).toContain('--- Slide 1 ---');
    expect(text).toContain('First slide');
    expect(text).toContain('Second slide');
    expect(text.indexOf('Second slide')).toBeGreaterThan(text.indexOf('First slide'));
  });

  it('extracts cells from .xlsx files using shared strings', async () => {
    const file = await zipToFile(
      {
        'xl/sharedStrings.xml':
          '<sst><si><t>Name</t></si><si><t>Rohit</t></si><si><t>Marks</t></si><si><t>95</t></si></sst>',
        'xl/worksheets/sheet1.xml':
          '<worksheet><sheetData>' +
          '<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>2</v></c></row>' +
          '<row r="2"><c r="A2" t="s"><v>1</v></c><c r="B2"><v>95</v></c></row>' +
          '</sheetData></worksheet>',
      },
      'marks.xlsx',
    );
    const text = await extractFileText(file);
    expect(text).toContain('Name\tMarks');
    expect(text).toContain('Rohit\t95');
  });

  it('extracts inline (non-shared) string cells from .xlsx files', async () => {
    // Inline strings live in <is><t>…</t></is> with NO <v> element — they
    // were silently dropped before the <is> reader was added.
    const file = await zipToFile(
      {
        'xl/worksheets/sheet1.xml':
          '<worksheet><sheetData>' +
          '<row r="1"><c r="A1" t="inlineStr"><is><t>Subject</t></is></c><c r="B1" t="inlineStr"><is><t>Score</t></is></c></row>' +
          '<row r="2"><c r="A2" t="inlineStr"><is><t>Physics</t></is></c><c r="B2"><v>88</v></c></row>' +
          '</sheetData></worksheet>',
      },
      'inline.xlsx',
    );
    const text = await extractFileText(file);
    expect(text).toContain('Subject\tScore');
    expect(text).toContain('Physics\t88');
  });

  it('caps extracted office text and marks the truncation', async () => {
    const file = await zipToFile(
      {
        'ppt/slides/slide1.xml': `<a:p><a:r><a:t>${'A'.repeat(120_000)}</a:t></a:r></a:p>`,
        '[Content_Types].xml': '<Types/>',
      },
      'huge.pptx',
    );
    const text = await extractFileText(file);
    expect(text.length).toBeLessThanOrEqual(60_000 + 100);
    expect(text).toContain('[Document truncated after 60000 characters]');
  });

  it('falls back to the lightweight parser when pdfjs is unavailable', async () => {
    const pdf = buildPdf('BT /F1 24 Tf 72 700 Td (Fallback PDF text) Tj ET');
    const file = new File([new Uint8Array(pdf)], 'doc.pdf', { type: 'application/pdf' });
    const text = await extractFileText(file);
    expect(text).toContain('Fallback PDF text');
  });

  it('returns empty string for unreadable archives', async () => {
    const file = await zipToFile({ 'a.txt': 'secret' }, 'bundle.zip');
    expect(await extractFileText(file)).toBe('');
  });

  it('returns empty string for unsupported binary types', async () => {
    const file = new File([new Uint8Array([1, 2, 3])], 'data.bin', { type: 'application/octet-stream' });
    expect(await extractFileText(file)).toBe('');
  });
});
