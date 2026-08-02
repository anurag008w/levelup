import { extractPdfTextFallback } from '/workspace/src/lib/pdfFallback.ts';

function adler32(data) {
  let a = 1, b = 0;
  for (let i = 0; i < data.length; i++) { a = (a + data[i]) % 65521; b = (b + a) % 65521; }
  return (b << 16) | a;
}
function compressSync(bytes) {
  const cmf = 0x78, flg = 0x9c;
  const out = new Uint8Array(2 + 5 + bytes.length + 4);
  out[0] = cmf; out[1] = flg;
  out[2] = 0x01;
  out[3] = bytes.length & 0xff;
  out[4] = (bytes.length >> 8) & 0xff;
  out[5] = (~bytes.length) & 0xff;
  out[6] = ((~bytes.length) >> 8) & 0xff;
  out.set(bytes, 7);
  const crc = adler32(bytes);
  out[out.length - 4] = crc & 0xff;
  out[out.length - 3] = (crc >> 8) & 0xff;
  out[out.length - 2] = (crc >> 16) & 0xff;
  out[out.length - 1] = (crc >> 24) & 0xff;
  return out;
}

const content = 'BT /F1 24 Tf 72 700 Td (Hello from flate PDF) Tj ET';
const stream = compressSync(new TextEncoder().encode(content));
console.log('compressed len', stream.length);

const pdf = [
  '%PDF-1.4', '1 0 obj', '<< /Type /Catalog /Pages 2 0 R >>', 'endobj',
  '2 0 obj', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>', 'endobj',
  '3 0 obj', '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>', 'endobj',
  '4 0 obj', `<< /Length ${stream.length} /Filter /FlateDecode >>`, 'stream', 'endstream', 'endobj',
  '5 0 obj', '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>', 'endobj',
  'trailer', '<< /Root 1 0 R >>', '%%EOF',
].join('\n');

const marker = 'stream\n';
const idx = pdf.indexOf(marker) + marker.length;
const endIdx = pdf.indexOf('endstream', idx);
const head = pdf.slice(0, idx);
const tail = pdf.slice(endIdx);
const bytes = new Uint8Array(head.length + stream.length + tail.length);
for (let i = 0; i < head.length; i++) bytes[i] = head.charCodeAt(i);
bytes.set(stream, head.length);
for (let i = 0; i < tail.length; i++) bytes[head.length + stream.length + i] = tail.charCodeAt(i);

console.log('head tail ok:', head.includes('stream'), tail.startsWith('endstream'));
const text = await extractPdfTextFallback(bytes);
console.log('EXTRACTED:', JSON.stringify(text));
