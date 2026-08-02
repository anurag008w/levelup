import { readFileSync } from 'fs';
import { getDocument } from 'pdfjs-dist';

class DOMMatrixStub {
  constructor() { this.a = 1; this.b = 0; this.c = 0; this.d = 1; this.e = 0; this.f = 0; }
  multiplySelf() { return this; }
  translate() { return this; }
  scale() { return this; }
  rotate() { return this; }
  preMultiplySelf() { return this; }
  is2D = true;
}
class Path2DStub {
  rect() {}
  moveTo() {}
  lineTo() {}
  bezierCurveTo() {}
  arc() {}
  closePath() {}
}
class OffscreenCanvasStub {
  constructor(w, h) { this.width = w; this.height = h; this.ctx = null; }
  getContext() { return this.ctx ?? new CanvasRenderingContextStub(); }
}
class CanvasRenderingContextStub {
  fillText() {}
  measureText() { return { width: 0 }; }
  save() {}
  restore() {}
  translate() {}
  scale() {}
  rotate() {}
  beginPath() {}
  rect() {}
  fill() {}
  stroke() {}
  clip() {}
  resetTransform() {}
  setTransform() {}
}

if (!globalThis.DOMMatrix) globalThis.DOMMatrix = DOMMatrixStub;
if (!globalThis.Path2D) globalThis.Path2D = Path2DStub;
if (!globalThis.OffscreenCanvas) globalThis.OffscreenCanvas = OffscreenCanvasStub;
if (!globalThis.ImageData) globalThis.ImageData = class { constructor(w, h) { this.width = w; this.height = h; this.data = new Uint8ClampedArray(w * h * 4); } };

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
  if (e.message && !e.stack.includes('DOMMatrix')) console.error(e.stack.split('\n').slice(0, 6).join('\n'));
  process.exit(1);
});
