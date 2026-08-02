import './polyfills.mjs';
import { readFileSync } from 'fs';
import { getDocument } from 'pdfjs-dist';

async function main() {
  const data = readFileSync('test.pdf');
  const task = getDocument({ data: new Uint8Array(data), isEvalSupported: false, useWorkerFetch: false, disableFontFace: true });
  const doc = await task.promise;
  console.log('pages:', doc.numPages);
  const page = await doc.getPage(1);
  const content = await page.getTextContent();
  const text = content.items.map((i) => i.str ?? '').join(' ');
  console.log('TEXT:', text);
  await task.destroy();
}

main().then(() => process.exit(0)).catch((e) => {
  console.error('EXTRACTION FAILED:', e.message);
  console.error(e.stack.split('\n').slice(0, 6).join('\n'));
  process.exit(1);
});
