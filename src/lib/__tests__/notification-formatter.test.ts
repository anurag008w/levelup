import { describe, it, expect } from 'vitest';
import {
  resolveLatexToUnicode,
  renderLatexFormulasInText,
  formatNotificationHtml,
  formatNotificationPlain,
  formatCollapsedNotification,
  hasMarkdownOrMath,
} from '../notification-formatter';

describe('notification-formatter', () => {
  describe('LaTeX Math Translation', () => {
    it('converts common and complex fractions to Unicode without leaking \\frac', () => {
      expect(resolveLatexToUnicode('\\frac{1}{2}')).toBe('½');
      expect(resolveLatexToUnicode('\\frac{3}{4}')).toBe('¾');
      expect(resolveLatexToUnicode('\\frac{a}{b}')).toBe('a / b');
      expect(resolveLatexToUnicode('\\frac{x + y}{2z}')).toBe('(x + y) / (2z)');
      expect(resolveLatexToUnicode('\\frac{-b \\pm \\sqrt{b^2 - 4ac}}{2a}')).toBe('(-b ± √(b² - 4ac)) / (2a)');
    });

    it('converts exponents, superscripts, and subscripts', () => {
      expect(resolveLatexToUnicode('x^2 + y^2 = z^2')).toBe('x² + y² = z²');
      expect(resolveLatexToUnicode('x^{n+1}')).toBe('xⁿ⁺¹');
      expect(resolveLatexToUnicode('x_1 + x_2')).toBe('x₁ + x₂');
      expect(resolveLatexToUnicode('T_{max}')).toBe('Tₘₐₓ');
      expect(resolveLatexToUnicode('e^{-x^2}')).toBe('e⁻ˣ²');
    });

    it('converts square roots and nth roots', () => {
      expect(resolveLatexToUnicode('\\sqrt{16}')).toBe('√(16)');
      expect(resolveLatexToUnicode('\\sqrt[3]{x}')).toBe('³√(x)');
      expect(resolveLatexToUnicode('\\sqrt[n]{a + b}')).toBe('ⁿ√(a + b)');
    });

    it('converts Greek letters and standard operators', () => {
      expect(resolveLatexToUnicode('\\alpha + \\beta = \\theta')).toBe('α + β = θ');
      expect(resolveLatexToUnicode('\\Delta x \\cdot \\pi')).toBe('Δ x · π');
      expect(resolveLatexToUnicode('A \\pm B \\times C \\div D')).toBe('A ± B × C ÷ D');
      expect(resolveLatexToUnicode('x \\le y \\ge z \\ne 0 \\approx 1')).toBe('x ≤ y ≥ z ≠ 0 ≈ 1');
      expect(resolveLatexToUnicode('\\sum_{i=1}^{n} i')).toBe('∑ᵢ₌₁ⁿ i');
      expect(resolveLatexToUnicode('\\int_{0}^{\\infty} f(x) dx')).toBe('∫₀∞ f(x) dx');
    });

    it('strips LaTeX wrappers like \\text, \\mathbf, \\left, \\right', () => {
      expect(resolveLatexToUnicode('\\text{Speed} = \\frac{\\text{dist}}{\\text{time}}')).toBe('Speed = dist / time');
      expect(resolveLatexToUnicode('\\left( \\frac{a}{b} \\right)')).toBe('(a / b)');
    });

    it('processes inline math and display math inside full text', () => {
      const input = 'Equation $E = mc^2$ is famous.\n\n$$\\frac{-b \\pm \\sqrt{b^2 - 4ac}}{2a}$$\n\nEnd.';
      const output = renderLatexFormulasInText(input);
      expect(output).not.toContain('\\frac');
      expect(output).not.toContain('$$');
      expect(output).not.toContain('$E');
      expect(output).toContain('E = mc²');
      expect(output).toContain('(-b ± √(b² - 4ac)) / (2a)');
    });
  });

  describe('Markdown Notification Formatting (HTML)', () => {
    it('formats bold, italic, and strikethrough', () => {
      const html = formatNotificationHtml('This is **bold** and *italic* and ~~deleted~~.');
      expect(html).toContain('<b>bold</b>');
      expect(html).toContain('<i>italic</i>');
      expect(html).toContain('<s>deleted</s>');
    });

    it('formats headings into prominent bold headers', () => {
      const html = formatNotificationHtml('# Main Title\n## Sub Title');
      expect(html).toContain('<b>MAIN TITLE</b>');
      expect(html).toContain('<b>Sub Title</b>');
    });

    it('formats bullet and numbered lists legibly', () => {
      const input = '- First point\n- Second point\n  - Sub point\n1. Step one\n2. Step two';
      const html = formatNotificationHtml(input);
      expect(html).toContain('• First point');
      expect(html).toContain('• Second point');
      expect(html).toContain('  ◦ Sub point');
      expect(html).toContain('1. Step one');
      expect(html).toContain('2. Step two');
    });

    it('formats code blocks with clear framing and monospace font', () => {
      const input = '```typescript\nconst a = 1;\nconst b = 2;\nreturn a + b;\n```';
      const html = formatNotificationHtml(input);
      expect(html).toContain('<tt>');
      expect(html).toContain('typescript');
      expect(html).toContain('│ const a = 1;');
      expect(html).toContain('│ const b = 2;');
    });

    it('formats inline code with monospace tags', () => {
      const html = formatNotificationHtml('Run `npm run build` now.');
      expect(html).toContain('<tt>npm run build</tt>');
    });

    it('formats links with sensible fallback showing URL', () => {
      const html = formatNotificationHtml('Check out [LevelUp](https://levelup.app) for details.');
      expect(html).toContain('<a href="https://levelup.app"><b>LevelUp</b></a> (https://levelup.app)');

      // If text is already the url, don't duplicate
      const html2 = formatNotificationHtml('Visit [https://levelup.app](https://levelup.app)');
      expect(html2).toContain('<a href="https://levelup.app">https://levelup.app</a>');
    });

    it('formats blockquotes with quote indicators', () => {
      const html = formatNotificationHtml('> Stay hungry, stay foolish.');
      expect(html).toContain('▎ <i>Stay hungry, stay foolish.</i>');
    });
  });

  describe('Plain Text & Collapsed Previews', () => {
    it('produces clean plain text without HTML tags for web notifications', () => {
      const input = '**Note:** The formula is $x^2 + y^2 = r^2$. See [site](https://test.com).';
      const plain = formatNotificationPlain(input);
      expect(plain).not.toContain('<b>');
      expect(plain).not.toContain('<a href');
      expect(plain).toContain('Note:');
      expect(plain).toContain('x² + y² = r²');
      expect(plain).toContain('site (https://test.com)');
    });

    it('generates a concise collapsed preview without raw markdown or LaTeX', () => {
      const input = '## Derivation of Formula\n\nHere is the formula: $$\\frac{a}{b}$$\n\nAnd some **bold** text.';
      const collapsed = formatCollapsedNotification(input);
      expect(collapsed).not.toContain('##');
      expect(collapsed).not.toContain('$$');
      expect(collapsed).not.toContain('\\frac');
      expect(collapsed.length).toBeLessThanOrEqual(185);
    });
  });

  describe('Detection: hasMarkdownOrMath', () => {
    it('detects LaTeX and markdown constructs accurately', () => {
      expect(hasMarkdownOrMath('Just plain text')).toBe(false);
      expect(hasMarkdownOrMath('Cost is $50')).toBe(true);
      expect(hasMarkdownOrMath('Formula $E = mc^2$')).toBe(true);
      expect(hasMarkdownOrMath('Fraction \\frac{1}{2}')).toBe(true);
      expect(hasMarkdownOrMath('**Bold text**')).toBe(true);
      expect(hasMarkdownOrMath('`code`')).toBe(true);
      expect(hasMarkdownOrMath('- list item')).toBe(true);
      expect(hasMarkdownOrMath('# Heading')).toBe(true);
      expect(hasMarkdownOrMath('[link](http://example.com)')).toBe(true);
    });
  });
});
