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
  constructor(w, h) { this.width = w; this.height = h; }
  getContext() { return new CanvasRenderingContextStub(); }
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
if (!globalThis.ImageData) {
  globalThis.ImageData = class {
    constructor(w, h) { this.width = w; this.height = h; this.data = new Uint8ClampedArray(w * h * 4); }
  };
}
if (!globalThis.Response) {
  globalThis.Response = class {
    constructor(body) { this.body = body; }
    blob() { return Promise.resolve(new Blob([this.body])); }
  };
}
if (!globalThis.Blob) globalThis.Blob = class {};
