/**
 * Lightweight, dependency-free PDF text extractor used as a fallback when
 * pdfjs-dist is unavailable or fails (e.g. an environment without the very
 * recent JS features pdfjs v6 relies on). Handles the common cases:
 * uncompressed and FlateDecode-compressed content streams with Tj / TJ / '
 * / " text-showing operators. Returns '' when nothing readable.
 */

const MAX_FALLBACK_CHARS = 60_000;

interface PdfObject {
  /** Full object body text (header + surroundings) for /Type and /Contents scans. */
  def: string;
  stream: Uint8Array | null;
  flate: boolean;
}

export async function extractPdfTextFallback(data: Uint8Array): Promise<string> {
  try {
    const objects = parseObjects(data);
    if (objects.size === 0) return '';
    const pages = collectContentStreams(objects);
    const pageTexts: string[] = [];

    for (const streams of pages) {
      const pageChunks: string[] = [];
      for (const obj of streams) {
        if (!obj.stream) continue;
        let decoded: string | null = null;
        if (obj.flate) {
          const inflated = await inflateZlib(obj.stream);
          if (inflated) decoded = new TextDecoder().decode(inflated);
        } else {
          decoded = new TextDecoder('latin1').decode(obj.stream);
        }
        if (!decoded) continue;
        const text = extractText(decoded);
        if (text.trim()) pageChunks.push(text);
      }
      if (pageChunks.length > 0) pageTexts.push(pageChunks.join('\n'));
    }

    const full = pageTexts.join('\n\n').trim();
    return full.slice(0, MAX_FALLBACK_CHARS);
  } catch {
    return '';
  }
}

function parseObjects(data: Uint8Array): Map<number, PdfObject> {
  // NOTE: TextDecoder('latin1') actually resolves to windows-1252 per the
  // WHATWG encoding spec, which remaps the C1 bytes 0x80-0x9F (e.g. 0x9C →
  // U+0153) and corrupts binary streams. Build a byte-preserving string
  // instead so binary content survives the object scan untouched.
  let text = '';
  for (let i = 0; i < data.length; i += 0x8000) {
    text += String.fromCharCode(...data.subarray(i, i + 0x8000));
  }
  const objects = new Map<number, PdfObject>();
  const re = /(\d+)\s+0\s+obj([\s\S]*?)endobj/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const id = Number(m[1]);
    const body = m[2];
    const streamMatch = /stream\r?\n([\s\S]*?)\r?\nendstream/.exec(body);
    const stream = streamMatch ? toBytes(streamMatch[1]) : null;
    const flate = /\/Filter\s*\/FlateDecode|\/Filter\s*\[[^\]]*FlateDecode/.test(body);
    objects.set(id, { def: body, stream, flate });
  }
  return objects;
}

function collectContentStreams(objects: Map<number, PdfObject>): PdfObject[][] {
  const pages: PdfObject[][] = [];
  for (const obj of objects.values()) {
    if (!/\/Type\s*\/Page(?![sA-Za-z])/.test(obj.def)) continue;
    const refs = extractContentRefs(obj.def);
    const streams = refs.map((rid) => objects.get(rid)).filter((o): o is PdfObject => Boolean(o?.stream));
    if (streams.length > 0) pages.push(streams);
  }
  return pages;
}

function extractContentRefs(def: string): number[] {
  const match = /\/Contents\s+(\[[\d\sR]+\]|\d+\s+\d+\s+R)/.exec(def);
  if (!match) return [];
  return [...match[1].matchAll(/(\d+)\s+\d+\s+R/g)].map((x) => Number(x[1]));
}

async function inflateZlib(bytes: Uint8Array): Promise<Uint8Array | null> {
  try {
    if (typeof DecompressionStream !== 'function') return null;
    const stream = new Blob([new Uint8Array(bytes)]).stream().pipeThrough(new DecompressionStream('deflate'));
    const buf = await new Response(stream).arrayBuffer();
    return new Uint8Array(buf);
  } catch {
    return null;
  }
}

function toBytes(s: string): Uint8Array {
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i) & 0xff;
  return out;
}

/** Extracts the strings shown by Tj / TJ / ' / " operators into readable lines. */
function extractText(content: string): string {
  const lines: string[] = [];
  let current = '';
  let i = 0;
  const n = content.length;

  while (i < n) {
    const c = content[i];

    if (c === '%') {
      while (i < n && content[i] !== '\n' && content[i] !== '\r') i++;
      continue;
    }
    if (c === '(') {
      const { text, next } = readLiteralString(content, i);
      current += text;
      i = next;
      continue;
    }
    if (c === '<' && content[i + 1] !== '<') {
      const j = content.indexOf('>', i);
      if (j === -1) break;
      current += decodeHex(content.slice(i + 1, j));
      i = j + 1;
      continue;
    }
    if (c === '[') {
      const { texts, next } = readTextArray(content, i);
      current += texts.join('');
      i = next;
      continue;
    }
    if (isWordChar(c)) {
      const word = readWord(content, i);
      i += word.length;
      if (word === 'Tj' || word === "'" || word === '"' || word === 'TJ') {
        if (current) {
          lines.push(current);
          current = '';
        }
      } else if (isTextBlock(word)) {
        if (current) {
          lines.push(current);
          current = '';
        }
      }
      continue;
    }
    i++;
  }
  if (current) lines.push(current);
  return lines.join('\n').replace(/[ \t]{2,}/g, ' ').trim();
}

function isTextBlock(word: string): boolean {
  return word === 'Td' || word === 'TD' || word === 'T*' || word === 'Tm' || word === 'BT' || word === 'ET';
}

function readWord(s: string, start: number): string {
  let i = start;
  while (i < s.length && isWordChar(s[i])) i++;
  return s.slice(start, i);
}

function isWordChar(c: string): boolean {
  return /[A-Za-z0-9'"]/.test(c);
}

function readLiteralString(s: string, start: number): { text: string; next: number } {
  let i = start + 1;
  let depth = 1;
  let out = '';
  while (i < s.length && depth > 0) {
    const c = s[i];
    if (c === '\\') {
      const e = s[i + 1];
      if (e === undefined) break;
      switch (e) {
        case 'n': out += '\n'; i += 2; break;
        case 'r': out += '\r'; i += 2; break;
        case 't': out += '\t'; i += 2; break;
        case 'b': out += '\b'; i += 2; break;
        case 'f': out += '\f'; i += 2; break;
        case '(': out += '('; i += 2; break;
        case ')': out += ')'; i += 2; break;
        case '\\': out += '\\'; i += 2; break;
        default: {
          if (e >= '0' && e <= '7') {
            let oct = '';
            while (oct.length < 3 && i + 1 < s.length && /[0-7]/.test(s[i + 1])) {
              oct += s[i + 1];
              i++;
            }
            out += String.fromCharCode(parseInt(oct, 8));
            i++;
          } else {
            out += e;
            i += 2;
          }
        }
      }
      continue;
    }
    if (c === '(') {
      depth++;
      out += c;
      i++;
      continue;
    }
    if (c === ')') {
      depth--;
      if (depth > 0) out += c;
      i++;
      continue;
    }
    out += c;
    i++;
  }
  return { text: out, next: i };
}

function readTextArray(s: string, start: number): { texts: string[]; next: number } {
  const texts: string[] = [];
  let i = start + 1;
  while (i < s.length) {
    const c = s[i];
    if (c === ']') return { texts, next: i + 1 };
    if (c === '(') {
      const r = readLiteralString(s, i);
      texts.push(r.text);
      i = r.next;
      continue;
    }
    if (c === '<' && s[i + 1] !== '<') {
      const j = s.indexOf('>', i);
      if (j === -1) break;
      texts.push(decodeHex(s.slice(i + 1, j)));
      i = j + 1;
      continue;
    }
    i++;
  }
  return { texts, next: i };
}

function decodeHex(hex: string): string {
  const clean = hex.replace(/\s/g, '');
  let out = '';
  for (let i = 0; i + 1 < clean.length; i += 2) {
    out += String.fromCharCode(parseInt(clean.slice(i, i + 2), 16));
  }
  return out;
}
