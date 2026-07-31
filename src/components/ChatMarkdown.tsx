import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import 'katex/dist/katex.min.css';
import type { Components } from 'react-markdown';

const components: Components = {
  a: ({ node: _node, ...props }) => (
    <a {...props} target="_blank" rel="noreferrer" style={{ color: 'var(--color-l)', textDecoration: 'underline' }} />
  ),
  p: ({ node: _node, ...props }) => <p className="mb-2 leading-relaxed last:mb-0" {...props} />,
  ul: ({ node: _node, ...props }) => <ul className="mb-1.5 list-disc space-y-0.5 pl-5" {...props} />,
  ol: ({ node: _node, ...props }) => <ol className="mb-1.5 list-decimal space-y-0.5 pl-5" {...props} />,
  li: ({ node: _node, ...props }) => <li className="leading-relaxed" {...props} />,
  strong: ({ node: _node, ...props }) => <strong className="font-bold text-text" {...props} />,
  em: ({ node: _node, ...props }) => <em className="italic" {...props} />,
  code: ({ node: _node, className, children, ...props }) => {
    const inline = !className;
    return inline ? (
      <code className="rounded bg-peak/10 px-1 py-0.5 font-mono text-[0.85em]" style={{ color: 'var(--color-peak)' }} {...props}>
        {children}
      </code>
    ) : (
      <code
        className="block overflow-x-auto rounded-md bg-black/40 px-3 py-2 font-mono text-[0.85em] leading-relaxed"
        style={{ color: '#d6e2ff' }}
        {...props}
      >
        {children}
      </code>
    );
  },
  pre: ({ node: _node, children }) => <pre className="mb-2 overflow-hidden rounded-lg border border-border shadow-inner">{children}</pre>,
  blockquote: ({ node: _node, ...props }) => (
    <blockquote className="mb-1.5 border-l-2 border-peak/40 pl-2 text-muted" {...props} />
  ),
  h1: ({ node: _node, ...props }) => <h1 className="mb-1 font-display text-base font-bold" {...props} />,
  h2: ({ node: _node, ...props }) => <h2 className="mb-1 font-display text-sm font-bold" {...props} />,
  h3: ({ node: _node, ...props }) => <h3 className="mb-1 font-display text-[13px] font-bold" {...props} />,
  table: ({ node: _node, ...props }) => (
    <div className="mb-2 overflow-x-auto rounded-lg border border-border">
      <table className="w-full border-collapse text-xs" {...props} />
    </div>
  ),
  th: ({ node: _node, ...props }) => (
    <th className="border-b border-r border-border bg-peak/10 px-2 py-1.5 text-left font-bold" {...props} />
  ),
  td: ({ node: _node, ...props }) => <td className="border-b border-r border-border px-2 py-1.5 align-top" {...props} />,
  hr: ({ node: _node, ...props }) => <hr className="my-3 border-border" {...props} />,
};

export default function ChatMarkdown({ text }: { text: string }) {
  return (
    <div className="text-[13px] leading-relaxed text-text [&_.katex-display]:overflow-x-auto [&_.katex-display]:overflow-y-hidden [&_.katex-display]:rounded-lg [&_.katex-display]:border [&_.katex-display]:border-border [&_.katex-display]:bg-black/20 [&_.katex-display]:px-2 [&_.katex-display]:py-2">
      <ReactMarkdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[rehypeKatex]} components={components}>
        {text}
      </ReactMarkdown>
    </div>
  );
}
