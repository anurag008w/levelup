/**
 * Notification Formatter for LevelUp
 *
 * Converts Markdown and LaTeX / KaTeX math into beautifully rendered, readable
 * content tailored for Android notifications (and web notification fallback):
 *
 * 1. LaTeX Math Equations:
 *    - Display equations ($$...$$, \[...\]) & Inline equations ($...$, \(...\))
 *    - Fractions (\frac{a}{b}, \dfrac, \tfrac) -> clean Unicode (½, ¾) or (a)/(b)
 *    - Square roots (\sqrt{x}, \sqrt[n]{x}) -> √(x), ⁿ√(x)
 *    - Exponents & superscripts (x^2, x^{n+1}) -> x², xⁿ⁺¹
 *    - Subscripts (x_1, x_{max}) -> x₁, xₘₐₓ
 *    - Greek letters (\alpha, \beta, \pi, \theta, \Delta, \Sigma, etc.)
 *    - Operators & symbols (\pm, \times, \div, \cdot, \le, \ge, \ne, \approx, \infty, \sum, \int, \to, \implies, etc.)
 *    - Environments and text macros (\text{...}, \mathbf{...}, \mathrm{...})
 *    - Eliminates all raw LaTeX leaks (\frac, $$, $, \[, \], etc.)
 *
 * 2. Markdown Formatting:
 *    - Headings (#, ##, ###) -> Bold titles with clean breaks
 *    - Bold (**bold**, __bold__) -> <b>bold</b>
 *    - Italics (*italic*, _italic_) -> <i>italic</i>
 *    - Strikethrough (~~del~~) -> <s>del</s>
 *    - Code blocks (```lang ... ```) -> Clearly framed, indented, monospace (<tt>)
 *    - Inline code (`code`) -> Monospace (<tt>code</tt>)
 *    - Bullet lists (-, *, +) -> Nicely formatted bullets (•, ◦)
 *    - Numbered lists (1., 2.) -> Preserved and aligned
 *    - Blockquotes (>) -> ▎ quote indicator
 *    - Links ([text](url)) -> <a href="url">text</a> (url) for sensible fallback
 *
 * 3. Expandable & Non-Truncated:
 *    - HTML mode for Android NotificationCompat (Html.fromHtml / BigTextStyle)
 *    - Plain-text mode for web notifications & collapsed heads-up view
 */

// Mapping tables for Unicode superscripts and subscripts
const SUPERSCRIPT_MAP: Record<string, string> = {
  '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴',
  '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹',
  '+': '⁺', '-': '⁻', '=': '⁼', '(': '⁽', ')': '⁾',
  'a': 'ᵃ', 'b': 'ᵇ', 'c': 'ᶜ', 'd': 'ᵈ', 'e': 'ᵉ',
  'f': 'ᶠ', 'g': 'ᵍ', 'h': 'ʰ', 'i': 'ⁱ', 'j': 'ʲ',
  'k': 'ᵏ', 'l': 'ˡ', 'm': 'ᵐ', 'n': 'ⁿ', 'o': 'ᵒ',
  'p': 'ᵖ', 'r': 'ʳ', 's': 'ˢ', 't': 'ᵗ', 'u': 'ᵘ',
  'v': 'ᵛ', 'w': 'ʷ', 'x': 'ˣ', 'y': 'ʸ', 'z': 'ᶻ',
  'A': 'ᴬ', 'B': 'ᴮ', 'D': 'ᴰ', 'E': 'ᴱ', 'G': 'ᴳ',
  'H': 'ᴴ', 'I': 'ᴵ', 'J': 'ᴶ', 'K': 'ᴷ', 'L': 'ᴸ',
  'M': 'ᴹ', 'N': 'ᴺ', 'O': 'ᴼ', 'P': 'ᴾ', 'R': 'ᴿ',
  'T': 'ᵀ', 'U': 'ᵁ', 'W': 'ᵂ',
};

const SUBSCRIPT_MAP: Record<string, string> = {
  '0': '₀', '1': '₁', '2': '₂', '3': '₃', '4': '₄',
  '5': '₅', '6': '₆', '7': '₇', '8': '₈', '9': '₉',
  '+': '₊', '-': '₋', '=': '₌', '(': '₍', ')': '₎',
  'a': 'ₐ', 'e': 'ₑ', 'h': 'ₕ', 'i': 'ᵢ', 'j': 'ⱼ',
  'k': 'ₖ', 'l': 'ₗ', 'm': 'ₘ', 'n': 'ₙ', 'o': 'ₒ',
  'p': 'ₚ', 'r': 'ᵣ', 's': 'ₛ', 't': 'ₜ', 'u': 'ᵤ',
  'v': 'ᵥ', 'x': 'ₓ',
};

// Common fractions mapping
const FRACTION_MAP: Record<string, string> = {
  '1/2': '½',
  '1/3': '⅓',
  '2/3': '⅔',
  '1/4': '¼',
  '3/4': '¾',
  '1/5': '⅕',
  '2/5': '⅖',
  '3/5': '⅗',
  '4/5': '⅘',
  '1/6': '⅙',
  '5/6': '⅚',
  '1/8': '⅛',
  '3/8': '⅜',
  '5/8': '⅝',
  '7/8': '⅞',
};

// LaTeX symbols & Greek letters to clean Unicode
const LATEX_SYMBOLS: [RegExp, string][] = [
  // Arrows & Logic
  [/\\(iff|Leftrightarrow)(?![a-zA-Z])/g, '⇔'],
  [/\\(implies|Rightarrow)(?![a-zA-Z])/g, '⇒'],
  [/\\Leftarrow(?![a-zA-Z])/g, '⇐'],
  [/\\(to|rightarrow)(?![a-zA-Z])/g, '→'],
  [/\\(gets|leftarrow)(?![a-zA-Z])/g, '←'],
  [/\\leftrightarrow(?![a-zA-Z])/g, '↔'],
  [/\\mapsto(?![a-zA-Z])/g, '↦'],
  [/\\therefore(?![a-zA-Z])/g, '∴'],
  [/\\because(?![a-zA-Z])/g, '∵'],
  [/\\forall(?![a-zA-Z])/g, '∀'],
  [/\\exists(?![a-zA-Z])/g, '∃'],
  [/\\nexists(?![a-zA-Z])/g, '∄'],
  [/\\neg(?![a-zA-Z])/g, '¬'],
  [/\\land(?![a-zA-Z])/g, '∧'],
  [/\\lor(?![a-zA-Z])/g, '∨'],
  [/\\oplus(?![a-zA-Z])/g, '⊕'],
  [/\\otimes(?![a-zA-Z])/g, '⊗'],

  // Math Operators & Relations
  [/\\pm(?![a-zA-Z])/g, '±'],
  [/\\mp(?![a-zA-Z])/g, '∓'],
  [/\\times(?![a-zA-Z])/g, '×'],
  [/\\div(?![a-zA-Z])/g, '÷'],
  [/\\cdot(?![a-zA-Z])/g, '·'],
  [/\\bullet(?![a-zA-Z])/g, '•'],
  [/\\ast(?![a-zA-Z])/g, '*'],
  [/\\star(?![a-zA-Z])/g, '⋆'],
  [/\\circ(?![a-zA-Z])/g, '°'],
  [/\\degree(?![a-zA-Z])/g, '°'],
  [/\\(le|leq)(?![a-zA-Z])/g, '≤'],
  [/\\(ge|geq)(?![a-zA-Z])/g, '≥'],
  [/\\(ne|neq)(?![a-zA-Z])/g, '≠'],
  [/\\approx(?![a-zA-Z])/g, '≈'],
  [/\\sim(?![a-zA-Z])/g, '~'],
  [/\\equiv(?![a-zA-Z])/g, '≡'],
  [/\\cong(?![a-zA-Z])/g, '≅'],
  [/\\ll(?![a-zA-Z])/g, '≪'],
  [/\\gg(?![a-zA-Z])/g, '≫'],
  [/\\propto(?![a-zA-Z])/g, '∝'],
  [/\\infty(?![a-zA-Z])/g, '∞'],
  [/\\partial(?![a-zA-Z])/g, '∂'],
  [/\\nabla(?![a-zA-Z])/g, '∇'],
  [/\\angle(?![a-zA-Z])/g, '∠'],
  [/\\perp(?![a-zA-Z])/g, '⊥'],
  [/\\parallel(?![a-zA-Z])/g, '∥'],

  // Calculus & Sets
  [/\\iint(?![a-zA-Z])/g, '∬'],
  [/\\iiint(?![a-zA-Z])/g, '∭'],
  [/\\oint(?![a-zA-Z])/g, '∮'],
  [/\\int(?![a-zA-Z])/g, '∫'],
  [/\\sum(?![a-zA-Z])/g, '∑'],
  [/\\prod(?![a-zA-Z])/g, '∏'],
  [/\\coprod(?![a-zA-Z])/g, '∐'],
  [/\\in(?![a-zA-Z])/g, '∈'],
  [/\\notin(?![a-zA-Z])/g, '∉'],
  [/\\ni(?![a-zA-Z])/g, '∋'],
  [/\\subset(?![a-zA-Z])/g, '⊂'],
  [/\\subseteq(?![a-zA-Z])/g, '⊆'],
  [/\\supset(?![a-zA-Z])/g, '⊃'],
  [/\\supseteq(?![a-zA-Z])/g, '⊇'],
  [/\\cup(?![a-zA-Z])/g, '∪'],
  [/\\cap(?![a-zA-Z])/g, '∩'],
  [/\\setminus(?![a-zA-Z])/g, '∖'],
  [/\\(emptyset|varnothing)(?![a-zA-Z])/g, '∅'],

  // Greek Alphabet (Uppercase)
  [/\\Gamma(?![a-zA-Z])/g, 'Γ'],
  [/\\Delta(?![a-zA-Z])/g, 'Δ'],
  [/\\Theta(?![a-zA-Z])/g, 'Θ'],
  [/\\Lambda(?![a-zA-Z])/g, 'Λ'],
  [/\\Xi(?![a-zA-Z])/g, 'Ξ'],
  [/\\Pi(?![a-zA-Z])/g, 'Π'],
  [/\\Sigma(?![a-zA-Z])/g, 'Σ'],
  [/\\Upsilon(?![a-zA-Z])/g, 'Υ'],
  [/\\Phi(?![a-zA-Z])/g, 'Φ'],
  [/\\Psi(?![a-zA-Z])/g, 'Ψ'],
  [/\\Omega(?![a-zA-Z])/g, 'Ω'],

  // Greek Alphabet (Lowercase)
  [/\\alpha(?![a-zA-Z])/g, 'α'],
  [/\\beta(?![a-zA-Z])/g, 'β'],
  [/\\gamma(?![a-zA-Z])/g, 'γ'],
  [/\\delta(?![a-zA-Z])/g, 'δ'],
  [/\\(epsilon|varepsilon)(?![a-zA-Z])/g, 'ε'],
  [/\\zeta(?![a-zA-Z])/g, 'ζ'],
  [/\\eta(?![a-zA-Z])/g, 'η'],
  [/\\(theta|vartheta)(?![a-zA-Z])/g, 'θ'],
  [/\\iota(?![a-zA-Z])/g, 'ι'],
  [/\\kappa(?![a-zA-Z])/g, 'κ'],
  [/\\lambda(?![a-zA-Z])/g, 'λ'],
  [/\\mu(?![a-zA-Z])/g, 'μ'],
  [/\\nu(?![a-zA-Z])/g, 'ν'],
  [/\\xi(?![a-zA-Z])/g, 'ξ'],
  [/\\(pi|varpi)(?![a-zA-Z])/g, 'π'],
  [/\\(rho|varrho)(?![a-zA-Z])/g, 'ρ'],
  [/\\(sigma|varsigma)(?![a-zA-Z])/g, 'σ'],
  [/\\tau(?![a-zA-Z])/g, 'τ'],
  [/\\upsilon(?![a-zA-Z])/g, 'υ'],
  [/\\(phi|varphi)(?![a-zA-Z])/g, 'φ'],
  [/\\chi(?![a-zA-Z])/g, 'χ'],
  [/\\psi(?![a-zA-Z])/g, 'ψ'],
  [/\\omega(?![a-zA-Z])/g, 'ω'],
];

/**
 * Converts a string to Unicode superscripts if possible.
 */
function toSuperscript(s: string): string {
  let res = '';
  for (const ch of s) {
    res += SUPERSCRIPT_MAP[ch] ?? ch;
  }
  return res;
}

/**
 * Converts a string to Unicode subscripts if possible.
 */
function toSubscript(s: string): string {
  let res = '';
  for (const ch of s) {
    res += SUBSCRIPT_MAP[ch] ?? ch;
  }
  return res;
}

/**
 * Helper to match balanced curly braces: find `{ ... }` starting at index.
 */
function extractBalancedBraces(str: string, startIndex: number): { content: string; endIndex: number } | null {
  if (str[startIndex] !== '{') return null;
  let depth = 0;
  let contentStart = startIndex + 1;
  for (let i = startIndex; i < str.length; i++) {
    if (str[i] === '{') {
      depth++;
    } else if (str[i] === '}') {
      depth--;
      if (depth === 0) {
        return {
          content: str.slice(contentStart, i),
          endIndex: i,
        };
      }
    }
  }
  return null;
}

/**
 * Resolves LaTeX \frac{num}{den}, \dfrac{num}{den}, \tfrac{num}{den} recursively.
 */
function resolveFractions(math: string): string {
  let out = '';
  let i = 0;
  while (i < math.length) {
    const fracMatch = /\\(?:frac|dfrac|tfrac)\s*\{/.exec(math.slice(i));
    if (!fracMatch || fracMatch.index !== 0) {
      const nextIdx = math.slice(i).search(/\\(?:frac|dfrac|tfrac)\s*\{/);
      if (nextIdx === -1) {
        out += math.slice(i);
        break;
      }
      out += math.slice(i, i + nextIdx);
      i += nextIdx;
    }

    const braceStart = math.indexOf('{', i);
    const numBlock = extractBalancedBraces(math, braceStart);
    if (!numBlock) {
      out += math.slice(i, i + 5);
      i += 5;
      continue;
    }

    let denStart = numBlock.endIndex + 1;
    while (denStart < math.length && /\s/.test(math[denStart])) denStart++;

    const denBlock = extractBalancedBraces(math, denStart);
    if (!denBlock) {
      out += math.slice(i, numBlock.endIndex + 1);
      i = numBlock.endIndex + 1;
      continue;
    }

    // Recursively resolve numerator and denominator
    const num = resolveFractions(numBlock.content.trim());
    const den = resolveFractions(denBlock.content.trim());

    // Check simple fraction table (e.g. 1/2 -> ½)
    const simpleKey = `${num}/${den}`;
    if (FRACTION_MAP[simpleKey]) {
      out += FRACTION_MAP[simpleKey];
    } else {
      // Need parentheses if compound expression (signs, spaces, or coefficient like 2a, 2z)
      const needsNumParen = /[+\-\s]/.test(num) && !/^\(.*\)$/.test(num);
      const needsDenParen = !/^\(.*\)$/.test(den) && (/[+\-*/\s]/.test(den) || /^\d+[a-zA-Z]/.test(den));
      const formattedNum = needsNumParen ? `(${num})` : num;
      const formattedDen = needsDenParen ? `(${den})` : den;
      out += `${formattedNum} / ${formattedDen}`;
    }

    i = denBlock.endIndex + 1;
  }
  return out;
}

/**
 * Resolves LaTeX roots (\sqrt{x}, \sqrt[n]{x}).
 */
function resolveRoots(math: string): string {
  // \sqrt[n]{x}
  let res = math.replace(/\\sqrt\s*\[([^\]]+)\]\s*\{([^{}]+)\}/g, (_m, n: string, inner: string) => {
    return `${toSuperscript(n.trim())}√(${inner.trim()})`;
  });

  // \sqrt{x} with balanced braces
  let out = '';
  let i = 0;
  while (i < res.length) {
    const sqrtMatch = /\\sqrt\s*\{/.exec(res.slice(i));
    if (!sqrtMatch || sqrtMatch.index !== 0) {
      const nextIdx = res.slice(i).search(/\\sqrt\s*\{/);
      if (nextIdx === -1) {
        out += res.slice(i);
        break;
      }
      out += res.slice(i, i + nextIdx);
      i += nextIdx;
    }

    const braceStart = res.indexOf('{', i);
    const block = extractBalancedBraces(res, braceStart);
    if (!block) {
      out += res.slice(i, i + 5);
      i += 5;
      continue;
    }

    const inner = resolveLatexToUnicode(block.content.trim());
    out += `√(${inner})`;
    i = block.endIndex + 1;
  }
  return out;
}

/**
 * Converts a raw LaTeX mathematical expression into human-readable Unicode math.
 */
export function resolveLatexToUnicode(rawMath: string): string {
  let s = rawMath.trim();

  // Strip wrapping tags like \text{...}, \mathrm{...}, \mathbf{...}, \mathit{...}
  s = s.replace(/\\(text|mathrm|mathbf|mathit|mathsf|mathtt|operatorname)\s*\{([^{}]+)\}/g, '$2');

  // Strip environments like \begin{matrix} ... \end{matrix}, \begin{cases}, etc.
  s = s.replace(/\\begin\{(?:matrix|pmatrix|bmatrix|vmatrix|cases|align\*?|equation\*?|gather\*?)\}/g, '');
  s = s.replace(/\\end\{(?:matrix|pmatrix|bmatrix|vmatrix|cases|align\*?|equation\*?|gather\*?)\}/g, '');

  // Line breaks in LaTeX
  s = s.replace(/\\\\/g, '\n');

  // Resolve fractions & roots
  s = resolveFractions(s);
  s = resolveRoots(s);

  // Common math symbols & Greek letters
  for (const [pattern, replacement] of LATEX_SYMBOLS) {
    s = s.replace(pattern, replacement);
  }

  // Superscripts: ^{expr} or ^x
  s = s.replace(/\^\{([^{}]+)\}/g, (_m, expr: string) => {
    let clean = expr.trim();
    clean = clean.replace(/\^([0-9a-zA-Z+\-()])/g, (_m2, ch: string) => toSuperscript(ch));
    return toSuperscript(clean);
  });
  s = s.replace(/\^([0-9a-zA-Z+\-()])/g, (_m, ch: string) => toSuperscript(ch));

  // Subscripts: _{expr} or _x
  s = s.replace(/_\{([^{}]+)\}/g, (_m, expr: string) => {
    let clean = expr.trim();
    clean = clean.replace(/_([0-9a-zA-Z+\-()])/g, (_m2, ch: string) => toSubscript(ch));
    return toSubscript(clean);
  });
  s = s.replace(/_([0-9a-zA-Z+\-()])/g, (_m, ch: string) => toSubscript(ch));

  // Sizing & Delimiters
  s = s.replace(/\\(left|right)\s*([()[\]{}|])\s*/g, '$2');
  s = s.replace(/\(\s+/g, '(').replace(/\s+\)/g, ')');
  s = s.replace(/\[\s+/g, '[').replace(/\s+\]/g, ']');
  s = s.replace(/\\\{/g, '{').replace(/\\\}/g, '}');

  // Spacing commands
  s = s.replace(/\\(quad|qquad)/g, '  ');
  s = s.replace(/\\[,;:!]/g, ' ');

  // Common function names: \sin, \cos, \tan, \ln, \log, \lim, \max, \min
  s = s.replace(/\\(sin|cos|tan|cot|sec|csc|arcsin|arccos|arctan|sinh|cosh|tanh|ln|log|exp|det|dim|gcd|hom|ker|deg)\b/g, '$1');
  s = s.replace(/\\lim\b/g, 'lim');
  s = s.replace(/\\(max|min|sup|inf)\b/g, '$1');

  // Clean remaining lone backslashes from unknown commands
  s = s.replace(/\\([a-zA-Z]+)/g, '$1');
  s = s.replace(/\\/g, '');

  // Normalize excess spaces
  return s.replace(/[ \t]+/g, ' ').trim();
}

/**
 * Scans text and replaces LaTeX math formulas (display & inline) with clean Unicode.
 */
export function renderLatexFormulasInText(text: string): string {
  // Protect code blocks first so code blocks don't get accidentally rewritten
  const codeBlocks: string[] = [];
  let masked = text.replace(/(```[\s\S]*?```|`[^`\n]+`)/g, (match) => {
    codeBlocks.push(match);
    return `\uE001CODE_${codeBlocks.length - 1}\uE001`;
  });

  // 1. Display Math: $$ ... $$ and \[ ... \]
  // Rendered on their own prominent block lines
  masked = masked.replace(/\$\$([\s\S]*?)\$\$/g, (_m, inner: string) => {
    const rendered = resolveLatexToUnicode(inner);
    return `\n\n  ${rendered}\n\n`;
  });
  masked = masked.replace(/\\\[([\s\S]*?)\\\]/g, (_m, inner: string) => {
    const rendered = resolveLatexToUnicode(inner);
    return `\n\n  ${rendered}\n\n`;
  });

  // 2. Inline Math: $ ... $ and \( ... \)
  masked = masked.replace(/\$([^$\n]+?)\$/g, (_m, inner: string) => {
    // Avoid accidental currency matches like $50 or $100
    if (/^\s*\d+(?:\.\d+)?\s*$/.test(inner)) {
      return `$${inner}$`;
    }
    return resolveLatexToUnicode(inner);
  });
  masked = masked.replace(/\\\(([\s\S]*?)\\\)/g, (_m, inner: string) => {
    return resolveLatexToUnicode(inner);
  });

  // Restore code blocks
  return masked.replace(/\uE001CODE_(\d+)\uE001/g, (_m, idx) => codeBlocks[Number(idx)] ?? '');
}

/**
 * Escapes XML/HTML entities for safe use in Android notification CharSequence.
 */
function escapeHtmlBasic(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Converts Markdown and LaTeX into formatted HTML suitable for Android
 * NotificationCompat (parsed via HtmlCompat.fromHtml / Html.fromHtml).
 *
 * Supported tags by Android SystemUI:
 * - <b>, <strong> (Bold)
 * - <i>, <em> (Italics)
 * - <s>, <strike> (Strikethrough)
 * - <tt>, <code> (Monospace font)
 * - <a> (Clickable link with href)
 * - <br> (Line breaks)
 * - <blockquote> (Indented quote)
 */
export function formatNotificationHtml(rawText: string): string {
  if (!rawText || !rawText.trim()) return '';

  // 1. First convert LaTeX formulas into clean Unicode (protecting code blocks)
  const mathResolved = renderLatexFormulasInText(rawText);

  // 2. Extract and format fenced code blocks
  const codeBlocks: string[] = [];
  let textWithFences = mathResolved.replace(/```([\w-]*)\s*\n?([\s\S]*?)```/g, (_m, lang: string, code: string) => {
    const cleanLang = lang.trim() || 'code';
    const lines = code.replace(/\r\n/g, '\n').replace(/\n+$/, '').split('\n');
    const borderTop = `┌─ ${escapeHtmlBasic(cleanLang)} ─────────────────────`;
    const borderBottom = `└──────────────────────────────`;
    const codeLines = lines
      .map((line) => `│ ${escapeHtmlBasic(line)}`)
      .join('<br>');

    // <tt> in Android Html.fromHtml renders with Typeface.MONOSPACE
    const formattedCode = `<br><b>${borderTop}</b><br><tt>${codeLines}</tt><br><b>${borderBottom}</b><br>`;
    codeBlocks.push(formattedCode);
    return `\uE002CB_${codeBlocks.length - 1}\uE002`;
  });

  // 3. Extract and format inline code `...`
  const inlineCodes: string[] = [];
  textWithFences = textWithFences.replace(/`([^`\n]+)`/g, (_m, inline: string) => {
    inlineCodes.push(`<tt>${escapeHtmlBasic(inline)}</tt>`);
    return `\uE003IC_${inlineCodes.length - 1}\uE003`;
  });

  // 4. Normalize line breaks
  const lines = textWithFences.replace(/\r\n/g, '\n').split('\n');
  const formattedLines: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    let line = lines[i];

    // Horizontal rules (---, ***, ___)
    if (/^\s{0,3}([-*_])( *\1){2,}\s*$/.test(line)) {
      formattedLines.push('──────────────────────────────');
      continue;
    }

    // Headings: # Heading 1, ## Heading 2, etc.
    const headingMatch = /^(\s{0,3})(#{1,6})\s+(.+)$/.exec(line);
    if (headingMatch) {
      const level = headingMatch[2].length;
      const title = headingMatch[3].trim();
      const escapedTitle = escapeHtmlBasic(title);
      if (level === 1) {
        formattedLines.push(`<b>${escapedTitle.toUpperCase()}</b>`);
      } else {
        formattedLines.push(`<b>${escapedTitle}</b>`);
      }
      continue;
    }

    // Blockquotes: > quote
    const quoteMatch = /^(\s{0,3})>\s*(.*)$/.exec(line);
    if (quoteMatch) {
      const qText = escapeHtmlBasic(quoteMatch[2]);
      formattedLines.push(`▎ <i>${qText}</i>`);
      continue;
    }

    // Bullet list items (-, *, +)
    const bulletMatch = /^(\s*)([-*+])\s+(.+)$/.exec(line);
    if (bulletMatch) {
      const indent = bulletMatch[1].length >= 2 ? '  ◦ ' : '• ';
      const content = escapeHtmlBasic(bulletMatch[3]);
      formattedLines.push(`${indent}${content}`);
      continue;
    }

    // Numbered list items (1., 2., etc.)
    const numMatch = /^(\s*)(\d+)\.\s+(.+)$/.exec(line);
    if (numMatch) {
      const num = numMatch[2];
      const content = escapeHtmlBasic(numMatch[3]);
      formattedLines.push(`${num}. ${content}`);
      continue;
    }

    // Regular line: escape HTML entities before formatting markdown spans
    formattedLines.push(escapeHtmlBasic(line));
  }

  let bodyHtml = formattedLines.join('\n');

  // 5. Links: [text](url) -> <a href="url">text</a> (url)
  // Provides sensible fallback if tapping links in notification is restricted
  bodyHtml = bodyHtml.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, (_m, text: string, url: string) => {
    if (text.trim() === url.trim()) {
      return `<a href="${url}">${text}</a>`;
    }
    return `<a href="${url}"><b>${text}</b></a> (${url})`;
  });

  // 6. Bold: **text** or __text__
  bodyHtml = bodyHtml.replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>');
  bodyHtml = bodyHtml.replace(/__([^_]+)__/g, '<b>$1</b>');

  // 7. Italics: *text* or _text_
  bodyHtml = bodyHtml.replace(/(?<![*\w])\*([^*]+)\*(?![*\w])/g, '<i>$1</i>');
  bodyHtml = bodyHtml.replace(/(?<![_\w])_([^_]+)_(?![_\w])/g, '<i>$1</i>');

  // 8. Strikethrough: ~~text~~
  bodyHtml = bodyHtml.replace(/~~([^~]+)~~/g, '<s>$1</s>');

  // 9. Restore inline codes & code blocks
  bodyHtml = bodyHtml.replace(/\uE003IC_(\d+)\uE003/g, (_m, idx) => inlineCodes[Number(idx)] ?? '');
  bodyHtml = bodyHtml.replace(/\uE002CB_(\d+)\uE002/g, (_m, idx) => codeBlocks[Number(idx)] ?? '');

  // 10. Convert newlines to <br>
  // Multiple blank lines turn into <br><br>
  return bodyHtml
    .replace(/\n\s*\n/g, '<br><br>')
    .replace(/\n/g, '<br>')
    .trim();
}

/**
 * Converts Markdown and LaTeX into clean, readable plain text.
 * Suitable for web notifications (which don't parse HTML tags) and
 * plain notification summaries.
 */
export function formatNotificationPlain(rawText: string): string {
  if (!rawText || !rawText.trim()) return '';

  // 1. Convert LaTeX formulas to Unicode
  const mathResolved = renderLatexFormulasInText(rawText);

  // 2. Format fenced code blocks cleanly
  let text = mathResolved.replace(/```([\w-]*)\s*\n?([\s\S]*?)```/g, (_m, lang: string, code: string) => {
    const cleanLang = lang.trim() || 'code';
    const lines = code.replace(/\r\n/g, '\n').replace(/\n+$/, '').split('\n');
    const header = `[${cleanLang}]`;
    const codeLines = lines.map((l) => `  ${l}`).join('\n');
    return `\n${header}\n${codeLines}\n`;
  });

  // 3. Inline code
  text = text.replace(/`([^`\n]+)`/g, '$1');

  // 4. Headings
  text = text.replace(/^#{1,6}\s+(.+)$/gm, (_m, title: string) => title.trim().toUpperCase());

  // 5. Blockquotes
  text = text.replace(/^\s*>\s*(.*)$/gm, '▎ $1');

  // 6. Bullet lists
  text = text.replace(/^(\s*)[-*+]\s+(.+)$/gm, (_m, indent: string, item: string) => {
    return `${indent.length >= 2 ? '  ◦ ' : '• '}${item}`;
  });

  // 7. Links: [text](url) -> text (url)
  text = text.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, (_m, linkText: string, url: string) => {
    if (linkText.trim() === url.trim()) return url;
    return `${linkText} (${url})`;
  });

  // 8. Bold / Italics / Strikethrough
  text = text.replace(/\*\*([^*]+)\*\*/g, '$1');
  text = text.replace(/__([^_]+)__/g, '$1');
  text = text.replace(/(?<!\w)\*([^*]+)\*(?!\w)/g, '$1');
  text = text.replace(/(?<!\w)_([^_]+)_(?!\w)/g, '$1');
  text = text.replace(/~~([^~]+)~~/g, '$1');

  // 9. Horizontal rules
  text = text.replace(/^\s*[-*_]{3,}\s*$/gm, '──────────────────────────────');

  return text.trim();
}

/**
 * Builds a concise, clean, single-line preview for collapsed/heads-up
 * notifications (max ~180 chars, clean word boundaries, no raw LaTeX/markdown).
 */
export function formatCollapsedNotification(rawText: string, maxLen = 180): string {
  if (!rawText || !rawText.trim()) return '';

  // Get plain text without markdown or raw LaTeX
  const plain = formatNotificationPlain(rawText);

  // Grab first non-empty line / sentence
  const lines = plain.split('\n').map((l) => l.trim()).filter(Boolean);
  const first = lines[0] || '';

  // If first line starts with a list bullet, include the next line if short
  let preview = first;
  if (lines.length > 1 && preview.length < 60) {
    preview += ` · ${lines[1]}`;
  }

  // Collapse whitespace
  preview = preview.replace(/\s+/g, ' ').trim();

  if (preview.length <= maxLen) return preview;

  // Trim at word boundary
  const sub = preview.slice(0, maxLen);
  const lastSpace = sub.lastIndexOf(' ');
  if (lastSpace > 100) {
    return `${sub.slice(0, lastSpace)}...`;
  }
  return `${sub}...`;
}

/**
 * Returns true when the text contains Markdown formatting, code blocks,
 * or LaTeX / KaTeX math constructs.
 */
export function hasMarkdownOrMath(text: string): boolean {
  if (!text) return false;
  return /(\$\$|\$|\\\(|\\\[|\\frac|\\sqrt|\\[a-zA-Z]+|\*{1,2}[^*]+\*{1,2}|_{1,2}[^_]+_{1,2}|```|`[^`\n]+`|^\s{0,3}[-*+]\s|^\s{0,3}\d+\.\s|^\s{0,3}>\s|^\s{0,3}#{1,6}\s|\[[^\]]+\]\([^)]+\)|~~[^~]+~~)/m.test(
    text,
  );
}
