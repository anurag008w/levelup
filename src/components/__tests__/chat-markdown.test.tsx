import { describe, expect, it } from 'vitest';
import { detectFileDoc, looksLikeMarkdown, normalizeLatexDelimiters, unwrapMarkdownFence } from '../markdown-utils';

describe('markdown-utils', () => {
  it('looksLikeMarkdown detects headings, lists, tables and math', () => {
    expect(looksLikeMarkdown('# heading')).toBe(true);
    expect(looksLikeMarkdown('- item')).toBe(true);
    expect(looksLikeMarkdown('| a | b |')).toBe(true);
    expect(looksLikeMarkdown('$$x^2$$')).toBe(true);
    expect(looksLikeMarkdown('plain text only')).toBe(false);
    expect(looksLikeMarkdown('')).toBe(false);
  });

  it('unwrapMarkdownFence strips wrapping fences only', () => {
    expect(unwrapMarkdownFence('```md\n# Hi\n```')).toBe('# Hi');
    expect(unwrapMarkdownFence('```markdown\n# Hi\n```\n')).toBe('# Hi');
    expect(unwrapMarkdownFence('```python\nx=1\n```')).toBe('```python\nx=1\n```');
    expect(unwrapMarkdownFence('no fence')).toBe('no fence');
  });

  it('detectFileDoc flags real generated documents (H1 title + real length) but not ordinary structured chat replies', () => {
    const trig = 'sin^2(x) + cos^2(x) = 1. This identity holds for every real x and is one of the most used relations in trigonometry, appearing constantly across calculus, physics and engineering derivations worth remembering by heart.\n';
    const doc = `# Formula Sheet\n\n## Trigonometry\n\n${trig}${trig}\n## Calculus\n\nDerivative and integral formulas used across JEE Main and Advanced, covering power rule, product rule, quotient rule, chain rule and the standard integral table.\n\n## Algebra\n\nQuadratic formula, binomial theorem and standard identities used throughout JEE-level algebra problems.\n`;
    expect(doc.length).toBeGreaterThan(500);
    const card = detectFileDoc(doc);
    expect(card).not.toBeNull();
    expect(card?.name).toBe('formula-sheet.md');

    // The exact bug reported: a step-by-step chat answer with ## subheadings
    // (Problem / Step-by-Step Solution / Step 1 / Step 2 / Step 3) must NOT
    // turn into a downloadable file card — it has no H1 title, it's a reply.
    const stepByStep = `## Problem\n\nEvaluate the integral I = the integral from 0 to pi of x sin(x) over 1 + cos^2(x) dx.\n\n## Step-by-Step Solution\n\n### Step 1: King's Property apply karo\n\nDefinite integration ki property: integral a to b of f(x) dx equals integral a to b of f(a+b-x) dx. Isko use karke hum equation ko rewrite kar sakte hain taaki x sin(x) ka term simplify ho jaaye.\n\n### Step 2: Equation add karo\n\n2I equals the integral of pi sin(x) over 1 + cos^2(x) dx from 0 to pi, so I equals pi/2 times that same integral. Numerator simplify karne ke baad hum ek clean expression tak pahunchte hain.\n\n### Step 3: Substitution method\n\nLet t = cos(x), so dt = -sin(x) dx. Limits change karo aur integral ko t ke terms mein solve karo taaki final closed-form answer mil jaaye.\n`;
    expect(stepByStep.length).toBeGreaterThan(500);
    expect(detectFileDoc(stepByStep)).toBeNull();

    expect(detectFileDoc('too short')).toBeNull();
    expect(detectFileDoc('# One heading\n\nonly one section, but still quite short overall so it will never pass anyway')).toBeNull();
    expect(detectFileDoc('no heading at all, just a long chat reply that goes on for a while and repeats itself many times to be longer than five hundred characters so it can properly test the minimum length threshold without accidentally tripping the heading-based document detector logic here, which needs both a real H1 title near the top and several sections or a table before it treats a reply as a downloadable document instead of a normal chat message bubble.')).toBeNull();
  });

  it('normalizeLatexDelimiters converts \\(...\\) and \\[...\\] to $...$/$$...$$ so remark-math can parse them', () => {
    expect(normalizeLatexDelimiters('Solve \\(x^2 + 1\\) here')).toBe('Solve $x^2 + 1$ here');
    expect(normalizeLatexDelimiters('\\[\\int_0^1 x\\,dx\\]')).toBe('$$\\int_0^1 x\\,dx$$');
    expect(normalizeLatexDelimiters('plain text, no math')).toBe('plain text, no math');
    // Leaves code fences / inline code untouched even if they contain literal \( \)
    expect(normalizeLatexDelimiters('`\\(not math\\)`')).toBe('`\\(not math\\)`');
    expect(normalizeLatexDelimiters('```\\(also not math\\)```')).toBe('```\\(also not math\\)```');
    // Unclosed delimiters (mid-stream) are left as-is rather than corrupted
    expect(normalizeLatexDelimiters('\\(unclosed')).toBe('\\(unclosed');
  });
});

// Note: ChatMarkdown component rendering tests are skipped in SSR environment
// because rehype-highlight and rehype-katex require browser APIs.
// These components work correctly in the browser/client environment.
