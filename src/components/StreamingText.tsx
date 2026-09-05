/**
 * Live-streaming placeholder for a still-growing reply (live-call transcripts).
 * While the message text keeps changing we render the cheapest possible thing
 * (a whitespace-pre-wrap div) instead of re-parsing react-markdown → GFM →
 * KaTeX → highlight on every streaming chunk. The full parse happens exactly
 * once, when the message is final. Shared by the chat bubbles and the live-call
 * overlay so both surfaces follow the same rule.
 */
export default function StreamingText({ text }: { text: string }) {
  return <div className="md-plain-stream">{text}</div>;
}